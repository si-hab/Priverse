#!/usr/bin/env python3
"""
Priverse Student Portal Server
Unified static file server + university services proxy on port 8080.
Binds to 0.0.0.0 so both your Mac and your Mobile Phone (on same Wi-Fi) can access it.
No extensions needed. Zero dummy data.
"""

import os
import sys
import json
import socket
import subprocess
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

PORT = int(os.environ.get("PORT", 8080))
IRAS_BASE = "https://iras.iub.edu.bd:8079"
ORIGIN = "https://irasv1.iub.edu.bd"
AES_KEY_HEX = "rW7aT6RZoP3hjtz0".encode().hex()
AES_IV_HEX = "V3k6oMP7C8Jt3E4z".encode().hex()
MAX_BODY = 64 * 1024
DIR = os.path.dirname(os.path.abspath(__file__))


def aes_encrypt_b64(plaintext: str) -> str:
    p = subprocess.run(
        ["openssl", "enc", "-aes-128-cbc", "-a", "-A",
         "-K", AES_KEY_HEX, "-iv", AES_IV_HEX],
        input=plaintext.encode(), capture_output=True, timeout=10)
    if p.returncode != 0:
        raise RuntimeError("encryption failed")
    return p.stdout.decode().strip()


def iras_request(method, path, body=None, token=None):
    headers = {
        "Accept": "application/pdf, application/octet-stream, */*" if path.rstrip("/").endswith("/transcript") else "application/json",
        "Origin": ORIGIN,
        "Referer": ORIGIN + "/",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(IRAS_BASE + path, method=method, headers=headers)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=25) as r:
            return r.status, r.headers.get_content_type(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get_content_type() or "application/json", e.read()
    except Exception as e:
        return 502, "application/json", json.dumps({"error": str(e)}).encode()


def normalize_id(raw_id: str) -> str:
    bengali = "০১২৩৪৫৬৭৮৯"
    ascii_d = "0123456789"
    cleaned = raw_id.translate(str.maketrans(bengali, ascii_d))
    cleaned = "".join(c for c in cleaned if c.isprintable() and not c.isspace() and c not in "\u200b\u200c\u200d\ufeff\u200e\u200f")
    return cleaned.strip()


def normalize_pw(raw_pw: str) -> str:
    pw = raw_pw.rstrip("\r\n")
    pw = "".join(c for c in pw if c not in "\u200b\u200c\u200d\ufeff\u200e\u200f")
    return pw


class AppHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def log_message(self, format, *args):
        # Log request without bodies or secrets
        if len(args) >= 1:
            print(f"[{self.log_date_time_string()}] {self.address_string()} {args[0]}")

    def _send(self, code, ctype, payload: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if self.path == "/live/login":
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send(400, "application/json", b'{"error":"bad payload"}')
            try:
                data = json.loads(self.rfile.read(length))
            except Exception:
                return self._send(400, "application/json", b'{"error":"invalid json"}')

            raw_id = str(data.get("id") or "").strip()
            raw_pw = str(data.get("password") or "")
            client_enc = str(data.get("encrypted_password") or "").strip()
            if not raw_id or (not raw_pw and not client_enc):
                return self._send(400, "application/json", b'{"error":"id and password required"}')

            clean_user = normalize_id(raw_id)
            print(f"[LOGIN] ID={clean_user!r}, PwLen={len(raw_pw)}, ClientEnc={'yes' if client_enc else 'no'}")

            def try_direct(uid, enc_pwd, label=""):
                """Send pre-encrypted password directly to IRAS."""
                c, ct, p = iras_request("POST", "/v3/account/token", {"email": uid, "password": enc_pwd})
                ok = c == 200 and b'"access_token"' in p
                print(f"  [{label}] uid={uid!r} -> {'SUCCESS' if ok else 'EPF'}")
                return c, ct, p

            def try_server_enc(uid, pwd, label=""):
                """Encrypt on server and send to IRAS."""
                try:
                    enc_pwd = aes_encrypt_b64(pwd)
                    return try_direct(uid, enc_pwd, label)
                except Exception as ex:
                    print(f"  [{label}] ERROR: {ex}")
                    return 500, "application/json", json.dumps({"error": str(ex)}).encode()

            code, ctype, payload = None, None, None

            # Strategy 1: Use client-side encrypted password (browser Web Crypto = same as official IRAS)
            if client_enc:
                code, ctype, payload = try_direct(clean_user, client_enc, "client-enc")

                # If EPF with client enc, also try email-format ID
                if code == 200 and b'"access_token"' not in payload:
                    if clean_user.isdigit() and len(clean_user) == 7:
                        c2, ct2, p2 = try_direct(f"{clean_user}@iub.edu.bd", client_enc, "client-enc+email")
                        if c2 == 200 and b'"access_token"' in p2:
                            code, ctype, payload = c2, ct2, p2

            # Strategy 2: Fallback to server-side encryption if client enc failed or wasn't sent
            if code is None or (code == 200 and b'"access_token"' not in payload):
                clean_pass = normalize_pw(raw_pw)
                if clean_pass:
                    c3, ct3, p3 = try_server_enc(clean_user, clean_pass, "server-enc")
                    if code is None or (c3 == 200 and b'"access_token"' in p3):
                        code, ctype, payload = c3, ct3, p3

                    # Also try email-format with server enc
                    if code == 200 and b'"access_token"' not in payload:
                        if clean_user.isdigit() and len(clean_user) == 7:
                            c4, ct4, p4 = try_server_enc(f"{clean_user}@iub.edu.bd", clean_pass, "server-enc+email")
                            if c4 == 200 and b'"access_token"' in p4:
                                code, ctype, payload = c4, ct4, p4

            print(f"[LOGIN RESULT] ID={clean_user!r}, Status={code}, IRAS={payload.decode('utf-8', errors='ignore').strip()[:80]}")
            return self._send(code, ctype, payload)

        return self._send(404, "application/json", b'{"error":"not found"}')

    def do_GET(self):
        if self.path.startswith("/live/fwd"):
            # Token from header OR query param (for <img> tags that cannot send custom headers)
            token = (self.headers.get("X-Live-Token", "")
                     or self.headers.get("Authorization", "").replace("Bearer ", ""))
            parsed = parse_qs(urlparse(self.path).query)
            if not token:
                token = parsed.get("token", [""])[0]

            path = unquote(parsed.get("path", [""])[0])
            if not path.startswith("/") or ".." in path:
                return self._send(400, "application/json", b'{"error":"bad path"}')
            code, ctype, payload = iras_request("GET", path, token=token[:4096])
            return self._send(code, ctype, payload)

        # Serve static files for mobile app
        return super().do_GET()


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    ip = get_lan_ip()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), AppHandler)
    print("=" * 60)
    print("🚀 Priverse Student Portal is running!")
    print(f"📱 Mobile Phone (same Wi-Fi): http://{ip}:{PORT}")
    print(f"💻 Mac / PC:                   http://localhost:{PORT}")
    print("✨ No browser extensions required!")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
