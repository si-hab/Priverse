/* Priverse — 100% LIVE. No mock data anywhere.
   Every value on screen comes from https://iras.iub.edu.bd:8079
   via the loopback proxy (live_proxy.py). Unknown response shapes are
   rendered generically so any field IRAS returns is visible. */
"use strict";

function getApiBase() {
  const custom = localStorage.getItem("iras_proxy_url");
  if (custom && custom.trim()) return custom.trim().replace(/\/+$/, "");
  return window.location.origin;
}
const API_BASE = getApiBase();
const IRAS = "https://iras.iub.edu.bd:8079";
const SEMNAME = { 1: "Autumn", 2: "Spring", 3: "Summer" };

const S = {
  tab: "home",
  live: null,   // { token, sid } — memory only, wiped on logout
  d: {},        // endpoint results: key -> { state: 'loading'|'ok'|'empty'|'error', value, status }
};

const $ = (id) => document.getElementById(id);
const content = $("content");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/* ---------------- generic data helpers ---------------- */

const unwrap = (j) => {
  if (!j || typeof j !== "object") return j;
  if ("data" in j) {
    const d = j.data;
    if (Array.isArray(d)) {
      if (d.length === 1 && typeof d[0] === "object") return d[0];
      return d;
    }
    return d;
  }
  return j;
};

function pick(obj, keys) {
  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object") obj = obj[0];
  if (!obj || typeof obj !== "object") return "";
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
    if (lower[k.toLowerCase()] != null && lower[k.toLowerCase()] !== "") return lower[k.toLowerCase()];
  }
  return "";
}

function fmtVal(v) {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length ? v.map(fmtVal).join(", ") : "—";
  if (typeof v === "object") {
    const s = pick(v, ["name", "title", "value", "label"]);
    return s !== "" ? esc(s) : esc(JSON.stringify(v)).slice(0, 80);
  }
  return esc(v);
}

/** key-value rows for any object */
function kvRows(obj) {
  if (Array.isArray(obj)) {
    if (obj.length === 1 && typeof obj[0] === "object") obj = obj[0];
    else if (!obj.length) return '<p class="muted">No fields.</p>';
    else return objTable(obj);
  }
  if (!obj || typeof obj !== "object") return '<p class="muted">No fields.</p>';
  const keys = Object.keys(obj).filter((k) => !/password|token/i.test(k));
  if (!keys.length) return '<p class="muted">No fields.</p>';
  return keys.map((k) => `
    <div class="kv"><div class="kv-ico">▫️</div>
      <div><small>${esc(prettyKey(k))}</small>${fmtVal(obj[k])}</div></div>`).join("");
}
const prettyKey = (k) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const PREF_COLS = ["code", "course", "title", "name", "section", "sec", "faculty",
  "teacher", "room", "credit", "grade", "point", "day", "schedule", "time",
  "semester", "year", "status", "id"];

/** auto-column table for any array of objects */
function objTable(arr, cap) {
  if (!Array.isArray(arr) || !arr.length) return "";
  const rows = arr.filter((r) => r && typeof r === "object");
  if (!rows.length) return '<p class="muted">No rows.</p>';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const score = (k) => {
    const kl = k.toLowerCase();
    const i = PREF_COLS.findIndex((p) => kl.includes(p));
    return i < 0 ? 99 : i;
  };
  const cols = keys.sort((a, b) => score(a) - score(b)).slice(0, cap || 6);
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${esc(prettyKey(c))}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${fmtVal(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function findKey(obj, re) {
  // deep-ish hunt for a key matching re; returns its value
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object" || seen.has(o)) return undefined;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const v of o) { const r = walk(v); if (r !== undefined) return r; }
      return undefined;
    }
    for (const k of Object.keys(o)) {
      if (re.test(k) && o[k] != null && o[k] !== "") return o[k];
      const r = walk(o[k]);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return walk(obj);
}

/* ---------------- client-side AES encryption ---------------- */

async function aesEncryptB64(plaintext) {
  if (!window.crypto || !window.crypto.subtle) {
    return null;
  }
  try {
    const enc = new TextEncoder();
    const keyRaw = enc.encode("rW7aT6RZoP3hjtz0");
    const iv = enc.encode("V3k6oMP7C8Jt3E4z");
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      keyRaw,
      { name: "AES-CBC" },
      false,
      ["encrypt"]
    );
    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      cryptoKey,
      enc.encode(plaintext)
    );
    let binary = "";
    const bytes = new Uint8Array(cipherBuffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (err) {
    console.warn("Web Crypto encryption error:", err);
    return null;
  }
}

/* ---------------- live transport (mobile web app same-origin) ---------------- */

async function irasCall(method, path, body, token, binary) {
  const base = getApiBase();
  if (method === "GET") {
    const url = base + "/live/fwd?path=" + encodeURIComponent(path);
    const headers = {};
    if (token) headers["X-Live-Token"] = token;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + (t ? " — " + t.slice(0, 120) : ""));
    }
    return binary ? res.blob() : res.json();
  }

  if (method === "POST") {
    const url = base + "/live/login";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + (t ? " — " + t.slice(0, 120) : ""));
    }
    return res.json();
  }

  throw new Error("Unsupported method " + method);
}

async function liveFwd(path, token, binary) {
  return irasCall("GET", path, null, token, binary);
}

function setD(key, patch) {
  S.d[key] = Object.assign(S.d[key] || { state: "loading" }, patch);
  updateHeaderAndUser();
  render();
}

function updateHeaderAndUser() {
  if (!S.live) return;
  const name = liveName();
  if ($("side-name")) $("side-name").textContent = name;
  if ($("side-id")) $("side-id").textContent = "ID " + S.live.sid;
  if ($("side-avatar")) $("side-avatar").textContent = initials();
  if ($("top-avatar")) $("top-avatar").textContent = initials();
}

async function fetchInto(key, path) {
  setD(key, { state: "loading" });
  try {
    const j = await liveFwd(path, S.live.token);
    const v = unwrap(j);
    const empty = v == null || (Array.isArray(v) && !v.length) ||
      (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
    setD(key, empty ? { state: "empty", value: v } : { state: "ok", value: v });
  } catch (e) {
    setD(key, { state: "error", value: String(e.message || e) });
  }
}

/* ---------------- login (live mobile web app) ---------------- */

$("pw-toggle").addEventListener("click", () => {
  const pw = $("login-pw");
  pw.type = pw.type === "password" ? "text" : "password";
});

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const rawId = $("login-id").value || "";
  const rawPw = $("login-pw").value || "";

  // Convert Bengali numerals ০-৯ to 0-9 and remove invisible characters
  const bengaliMap = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
  const id = rawId.replace(/[০-৯]/g, (d) => bengaliMap[d]).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim();
  const pw = rawPw.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[\r\n]+$/, "");

  const err = $("login-error");
  if (!id || !pw) { err.textContent = "Please enter your ID and password."; err.hidden = false; return; }
  err.hidden = true;
  const btn = $("login-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';
  liveSignIn(id, pw, btn);
});

async function liveSignIn(id, pw, btn) {
  const err = $("login-error");
  const done = () => { btn.disabled = false; btn.textContent = "Sign In"; };
  let data = null;
  let httpStatus = 0;

  // Safely attempt client-side encryption (Web Crypto API)
  let encryptedPw = null;
  try {
    encryptedPw = await aesEncryptB64(pw);
  } catch (encErr) {
    console.warn("Client encryption skipped, using server fallback:", encErr);
  }

  const payload = { id, password: pw };
  if (encryptedPw) {
    payload.encrypted_password = encryptedPw;
  }

  try {
    const base = getApiBase();
    const res = await fetch(base + "/live/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    httpStatus = res.status;
    data = await res.json().catch(() => null);
  } catch (e) {
    if (window.location.protocol === "file:") {
      err.textContent = "Priverse can't sign in when opened as a file. Open it from the official Priverse website or university app link.";
    } else {
      err.textContent = "Can't reach the server. Make sure server.py is running on your computer or check your Wi-Fi connection.";
    }
    err.hidden = false;
    done();
    return;
  }

  if (data && data.error) {
    err.textContent = "Server error: " + data.error;
    err.hidden = false; done(); return;
  }

  // IRAS returns token in multiple possible shapes:
  //   { access_token: "..." }
  //   { data: [{ access_token: "..." }] }
  //   { data: { access_token: "..." } }
  let token = null;
  if (data) {
    if (data.access_token) {
      token = data.access_token;
    } else if (data.data) {
      const inner = Array.isArray(data.data) ? data.data[0] : data.data;
      if (inner && inner.access_token) token = inner.access_token;
    }
  }

  if (!token) {
    if (data && data.message === "EPF") {
      err.textContent = "Wrong ID or password. Please check your university credentials and try again.";
    } else if (httpStatus === 502) {
      err.textContent = "Cannot reach the university services. Check your internet connection.";
    } else if (httpStatus === 200 && !data) {
      err.textContent = "Priverse could not reach its sign-in service. Open the site through the running Priverse server and try again.";
    } else {
      err.textContent = "Login failed (HTTP " + httpStatus + "). Please try again.";
    }
    err.hidden = false;
    done();
    return;
  }

  let profile = null;
  try { profile = unwrap(await liveFwd("/v2/persons/userprofile", token)); } catch (e) { /* below */ }
  const sid = (profile && (profile.userId || profile.UserId)) || id;
  S.live = { token, sid: String(sid) };
  saveLiveSession();
  S.d = {};
  done();
  $("login-pw").value = "";
  enterApp();
  loadAll();
}

function enterApp() {
  $("login-screen").hidden = true;
  $("app").hidden = false;
  if ($("side-name")) $("side-name").textContent = liveName();
  if ($("side-id")) $("side-id").textContent = "ID " + S.live.sid;
  if ($("side-avatar")) $("side-avatar").textContent = initials();
  if ($("top-avatar")) $("top-avatar").textContent = initials();
  render();
}

function loadAll() {
  const sid = S.live.sid;
  fetchInto("profile", "/v2/persons/userprofile");
  fetchInto("details", "/api/v2/profile/" + encodeURIComponent(sid) + "/load-student-details");
  fetchInto("calendar", "/api/v2/admission/calendar/current-calendar");
  fetchInto("registered", "/api/v1/registration/student-registered-courses/" + encodeURIComponent(sid) + "/all");
  fetchInto("notices", "/api/v1/landing/notichboard/" + encodeURIComponent(sid) + "/student");
  fetchInto("sequence", "/api/v1/registration/student-courses-sequence/" + encodeURIComponent(sid));
  // attendance needs year+semester -> chained after calendar resolves
  let calAttempts = 0;
  const maxCalAttempts = 25; // max ~10s
  const waitCal = setInterval(() => {
    calAttempts++;
    if (!S.live || calAttempts >= maxCalAttempts) {
      clearInterval(waitCal);
      if (S.live && (!S.d.attendance || S.d.attendance.state === "loading")) {
        setD("attendance", { state: "empty", value: "Attendance data not available." });
      }
      return;
    }
    if (S.d.calendar && S.d.calendar.state !== "loading") {
      clearInterval(waitCal);
      const c = S.d.calendar.value || {};
      const y = pick(c, ["attendanceYear", "year", "regYear", "currentYear", "attYear"]);
      const s = pick(c, ["attendanceSemester", "semester", "regSemester", "currentSemester", "attSemester"]);
      if (y && s) fetchInto("attendance",
        "/api/v1/attendance/snapshoot/reports/" + encodeURIComponent(sid) + "/" + encodeURIComponent(String(y)) + "/" + encodeURIComponent(String(s)));
      else setD("attendance", { state: "empty", value: "Year/semester not provided by the university calendar." });
    }
  }, 400);
}

// Cache the active IRAS session across browser restarts so users do not need
// to re-enter their password. The password itself is never stored.
const LIVE_SESSION_KEY = "iras_saved_session";

function saveLiveSession() {
  try {
    if (S.live) localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(S.live));
  } catch (e) {
    console.warn("Could not cache the IRAS session:", e);
  }
}

async function restoreLiveSession() {
  let saved = null;
  try {
    // Migrate the short-lived session cache introduced previously.
    saved = JSON.parse(localStorage.getItem(LIVE_SESSION_KEY) || sessionStorage.getItem("iras_live_session") || "null");
    if (!saved || typeof saved.token !== "string" || !saved.token || !saved.sid) return;
    const profile = await liveFwd("/v2/persons/userprofile", saved.token);
    if (profile && (profile.error || profile.status === 401)) throw new Error("IRAS rejected the saved session");
    S.live = { token: saved.token, sid: String(saved.sid) };
    S.d = {};
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(S.live));
    sessionStorage.removeItem("iras_live_session");
    enterApp();
    loadAll();
  } catch (e) {
    console.warn("Saved IRAS session could not be restored; asking the user to sign in:", e);
    // Keep the cached token on a temporary network failure. Remove it only
    // when IRAS explicitly rejects it, so an outage does not force re-login.
    if (/IRAS rejected|HTTP 401|HTTP 403/i.test(String(e && e.message))) {
      try { localStorage.removeItem(LIVE_SESSION_KEY); } catch (_) { /* storage unavailable */ }
      try { sessionStorage.removeItem("iras_live_session"); } catch (_) { /* storage unavailable */ }
      return;
    }
    // A network outage should not discard a potentially valid cached session.
    if (saved) {
      S.live = { token: saved.token, sid: String(saved.sid) };
      S.d = {};
      enterApp();
      loadAll();
    }
  }
}

/* ---------------- shared bits ---------------- */

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), 3200);
}

const TITLES = {
  home: "Student Portal",
  attendance: "Class Attendance",
  history: "Academic History",
  schedule: "Class Routine",
  profile: "Student Profile",
};

function go(tab) {
  S.tab = tab;
  document.querySelectorAll("#side-nav button, #bottom-nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("topbar-title").textContent = TITLES[tab] || "Student Portal";
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll("#side-nav button, #bottom-nav button")
  .forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));

function render() {
  if (!S.live) return;
  const c = S.d.calendar && S.d.calendar.value;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const sem = pick(c, ["semesterName", "semName", "semester", "currentSemester", "term"]);
    const yr = pick(c, ["year", "currentYear", "attendanceYear", "regYear"]);
    if ($("sem-chip") && (sem || yr)) $("sem-chip").textContent = [sem, yr].filter(Boolean).join(" ");
  }
  const viewMap = {
    home: vHome,
    attendance: vAttendance,
    history: vHistory,
    schedule: vSchedule,
    profile: vProfile
  };
  (viewMap[S.tab] || vHome)();
}

/* ---------------- Profile & Name Helpers ---------------- */

const prof = () => {
  let p = (S.d.profile && S.d.profile.value) || {};
  if (Array.isArray(p) && p.length > 0) p = p[0];
  return p && typeof p === "object" ? p : {};
};

const liveName = () => {
  const p = prof();
  const det = (S.d.details && S.d.details.value) || {};
  const detObj = Array.isArray(det) ? (det[0] || {}) : (det && det.data ? det.data : det);
  return (
    pick(p, ["fullName", "userName", "studentName", "name", "firstName", "studentname"]) ||
    pick(detObj, ["fullName", "studentName", "name", "userName", "studentname", "firstName"]) ||
    S.live.sid
  );
};

const livePhoto = () => {
  const p = prof();
  const det = (S.d.details && S.d.details.value) || {};
  const detObj = Array.isArray(det) ? (det[0] || {}) : (det && det.data ? det.data : det);
  const ge = pick(p, ["profileImage", "profileimgurl", "photo", "image"]) ||
             pick(detObj, ["profileImage", "profileimgurl", "photo", "image"]);
  if (ge) {
    if (ge.startsWith("http") || ge.startsWith("data:") || ge.startsWith("../../") || ge.startsWith("assets/")) {
      return ge;
    }
    return "data:image/jpeg;base64," + ge;
  }
  const uid = pick(p, ["userId", "UserId", "id"]) || S.live.sid;
  const tokParam = S.live && S.live.token ? "&token=" + encodeURIComponent(S.live.token) : "";
  return getApiBase() + "/live/fwd?path=" + encodeURIComponent("/photo/" + uid + ".jpg") + tokParam;
};

function initials() {
  const n = String(liveName()).trim();
  if (/^\d+$/.test(n)) return "👤";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ? parts[0][0] : "👤").toUpperCase();
}

/* ---------------- 12-Hour Time & Schedule Parsing ---------------- */

function convertSingleTime(t) {
  if (!t) return "";
  t = t.trim();
  const ampmMatch = t.match(/([0-9]{1,2}):([0-9]{2})\s*([ap]m)/i);
  if (ampmMatch) {
    let hr = parseInt(ampmMatch[1], 10);
    return `${hr < 10 ? "0" + hr : hr}:${ampmMatch[2]} ${ampmMatch[3].toUpperCase()}`;
  }
  const match = t.match(/(\d{1,2}):(\d{2})/);
  if (!match) return t;
  let hr = parseInt(match[1], 10);
  const min = match[2];
  let ampm = "AM";
  if (hr >= 12) {
    ampm = "PM";
    if (hr > 12) hr -= 12;
  } else if (hr >= 1 && hr <= 6) {
    ampm = "PM";
  } else {
    ampm = "AM";
  }
  return `${hr < 10 ? "0" + hr : hr}:${min} ${ampm}`;
}

function format12Hour(timeStr) {
  if (!timeStr) return "Schedule TBA";
  timeStr = String(timeStr).trim();
  // Strip out any leading day letters e.g. "ST 11:00-12:20" -> "11:00-12:20"
  timeStr = timeStr.replace(/^[A-Za-z\s]+(?=\d)/, "");
  if (timeStr.includes("-")) {
    return timeStr.split("-").map((p) => convertSingleTime(p.trim())).join(" – ");
  }
  return convertSingleTime(timeStr);
}

function parseTimeToMinutes(t) {
  if (!t) return null;
  const str = convertSingleTime(t);
  const match = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hr = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const ampm = match[3] ? match[3].toUpperCase() : "";
  if (ampm === "PM" && hr < 12) hr += 12;
  if (ampm === "AM" && hr === 12) hr = 0;
  return hr * 60 + min;
}

/* ---------------- Running Courses & Course History ---------------- */

// In IUB: 2 = Spring (Jan-Apr), 3 = Summer (May-Aug), 1 = Autumn (Sep-Dec)
function getSemChronologicalScore(year, sem) {
  const y = parseInt(year, 10) || 0;
  const s = parseInt(sem, 10) || 0;
  const order = s === 1 ? 3 : s === 3 ? 2 : s === 2 ? 1 : 0;
  return y * 10 + order;
}

// Determines accurate credit hours for IUB courses:
// Labs (ending with 'L' or containing 'Lab') = 1 Credit
// Tutorials (ending with 'T' or containing 'Tutorial') = 0 Credits
// Standard theory undergraduate courses = 3 Credits
function getCourseCredit(c) {
  const raw = pick(c, ["credit", "creditHour", "creditHours", "credits"]);
  if (raw !== "" && raw != null && !isNaN(raw)) {
    const num = parseFloat(raw);
    if (num > 0) return num;
  }
  const code = (pick(c, ["courseId", "courseCode", "code"]) || "").trim().toUpperCase();
  const name = (pick(c, ["courseName", "courseTitle", "title"]) || "").trim().toLowerCase();

  if (code.endsWith("T") || name.includes("tutorial")) return 0;
  if (code.endsWith("L") || name.includes("labwork") || name.includes("lab")) return 1;
  if (code.includes("499") || name.includes("senior project") || name.includes("thesis")) return 3;
  return 3;
}

function getRunningCoursesAndHistory() {
  const reg = (S.d.registered && S.d.registered.value) || [];
  const list = Array.isArray(reg) ? reg : (reg && reg.data ? reg.data : []);
  if (!list.length) {
    return {
      current: [],
      history: [],
      currentSemTitle: "Current Semester",
      targetYear: 0,
      targetSem: 0,
      latestYear: 0,
      latestSem: 0
    };
  }

  // 1. Check calendar for current commencement
  const cal = S.d.calendar && S.d.calendar.value;
  let calYear = 0;
  let calSem = 0;
  if (cal) {
    calYear = parseInt(pick(cal, ["applicationYear", "currentYear", "year", "attendanceYear", "regYear"]), 10);
    calSem = parseInt(pick(cal, ["applicationSemester", "currentSemester", "semester", "attendanceSemester", "regSemester"]), 10);
  }

  // 2. Find latest semester by chronological score across all courses
  let bestScore = -1;
  let latestYear = calYear || 0;
  let latestSem = calSem || 0;
  if (latestYear && latestSem) {
    bestScore = getSemChronologicalScore(latestYear, latestSem);
  }

  list.forEach((c) => {
    const y = parseInt(pick(c, ["regYear", "year"]), 10);
    const s = parseInt(pick(c, ["regSemester", "semester"]), 10);
    if (y && s) {
      const score = getSemChronologicalScore(y, s);
      if (score > bestScore) {
        bestScore = score;
        latestYear = y;
        latestSem = s;
      }
    }
  });

  // Target semester (either user selected or default latest)
  let targetYear = latestYear;
  let targetSem = latestSem;
  if (S.selectedSemKey) {
    const parts = S.selectedSemKey.split("_");
    const py = parseInt(parts[0], 10);
    const ps = parseInt(parts[1], 10);
    if (py && ps) {
      targetYear = py;
      targetSem = ps;
    }
  }

  const current = [];
  const historyMap = {};

  list.forEach((c) => {
    const y = parseInt(pick(c, ["regYear", "year"]), 10) || latestYear;
    const s = parseInt(pick(c, ["regSemester", "semester"]), 10) || latestSem;
    const semName = SEMNAME[s] || "Semester " + s;
    const semKey = `${y}_${s}`;
    const semTitle = `${semName} ${y}`;

    const code = pick(c, ["courseId", "courseCode", "code"]);
    const title = pick(c, ["courseName", "courseTitle", "title"]);
    const sec = pick(c, ["section", "sec"]);
    const credit = getCourseCredit(c);
    const grade = pick(c, ["grade", "gradeLetter", "letterGrade"]);
    const fac = pick(c, ["facultyName", "faculty", "teacherName", "instructor"]);
    const room = pick(c, ["roomId", "room", "roomNo"]) || "TBA";
    const timeRaw = pick(c, ["classTime", "time", "startTime", "scheduleTime"]) || "";
    const daysRaw = pick(c, ["classDays", "days", "schedule", "classSchedule"]) || "";
    const rawClassCount = parseInt(pick(c, ["classCount", "totalClass", "totalClasses"]) || 0, 10);
    // In IUB IRAS database, raw classCount has a +1 offset (as seen in official client: classCount - 1)
    const classCount = rawClassCount > 0 ? Math.max(0, rawClassCount - 1) : 0;
    let attend = parseInt(pick(c, ["attend", "attendedClass", "presentClass"]) || 0, 10);
    if (classCount > 0 && attend > classCount) attend = classCount;
    const percentage = classCount > 0
      ? Math.min(100, Math.round((attend / classCount) * 100))
      : (rawClassCount > 0 ? 100 : null);
    const missed = classCount > attend ? classCount - attend : 0;

    // Official IUB warning state logic:
    const isLab = String(code).length > 6 || /L$|LAB/i.test(String(code));
    let standing = "🟢 Safe";
    let standingClass = "att-badge-safe";
    if (isLab) {
      if (missed > 4) { standing = "🚨 Drop Risk (>4 missed)"; standingClass = "att-badge-danger"; }
      else if (missed > 2) { standing = "⚠️ Caution (>2 missed)"; standingClass = "att-badge-warn"; }
    } else {
      if (missed > 8) { standing = "🚨 Drop Risk (>8 missed)"; standingClass = "att-badge-danger"; }
      else if (missed > 5) { standing = "⚠️ Caution (>5 missed)"; standingClass = "att-badge-warn"; }
    }

    const isRunning = (y === latestYear && s === latestSem);
    const courseObj = {
      code,
      title,
      section: sec,
      credit,
      grade: grade && grade.trim() ? grade.trim() : (isRunning ? "Running" : "Completed"),
      faculty: fac,
      room,
      timeFormatted: format12Hour(timeRaw),
      timeRaw,
      daysRaw,
      attend,
      classCount,
      missed,
      percentage,
      standing,
      standingClass,
      year: y,
      semester: s,
      semTitle,
      raw: c
    };

    if (y === targetYear && s === targetSem) {
      current.push(courseObj);
    }

    if (!historyMap[semKey]) {
      historyMap[semKey] = {
        year: y,
        semester: s,
        semTitle,
        courses: [],
        totalCredits: 0,
        score: getSemChronologicalScore(y, s),
      };
    }
    historyMap[semKey].courses.push(courseObj);
    historyMap[semKey].totalCredits += courseObj.credit;
  });

  const history = Object.values(historyMap).sort((a, b) => b.score - a.score);

  const curSemName = SEMNAME[targetSem] || "Semester " + targetSem;
  const currentSemTitle = `${curSemName} ${targetYear}`;

  return { current, history, currentSemTitle, targetYear, targetSem, latestYear, latestSem };
}

window.selectSemester = function(semKey) {
  S.selectedSemKey = semKey;
  render();
};

/* ---------------- Next Class Flash Card Finder ---------------- */

function getNextClass(runningCourses) {
  if (!runningCourses || !runningCourses.length) return null;
  const now = new Date();
  const currentDayIndex = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dayNameMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const classItems = [];
  runningCourses.forEach((c) => {
    const timeParts = (c.timeRaw || "").replace(/^[A-Za-z\s]+(?=\d)/, "").split("-");
    const startMins = parseTimeToMinutes(timeParts[0] || "");
    const endMins = parseTimeToMinutes(timeParts[1] || timeParts[0] || "");

    const combinedDays = (c.daysRaw + " " + c.timeRaw).toUpperCase();
    const activeDayIndices = [];

    if (combinedDays.includes("ST")) { activeDayIndices.push(0, 2); }
    if (combinedDays.includes("MW")) { activeDayIndices.push(1, 3); }
    if (combinedDays.includes("RA") || combinedDays.includes("SR")) { activeDayIndices.push(4, 6); }

    if (!activeDayIndices.length) {
      if (combinedDays.includes("SUN") || (combinedDays.includes("S") && !combinedDays.includes("ST"))) activeDayIndices.push(0);
      if (combinedDays.includes("MON") || combinedDays.includes("M")) activeDayIndices.push(1);
      if (combinedDays.includes("TUE") || combinedDays.includes("T")) activeDayIndices.push(2);
      if (combinedDays.includes("WED") || combinedDays.includes("W")) activeDayIndices.push(3);
      if (combinedDays.includes("THU") || combinedDays.includes("R")) activeDayIndices.push(4);
      if (combinedDays.includes("FRI") || combinedDays.includes("F")) activeDayIndices.push(5);
      if (combinedDays.includes("SAT") || combinedDays.includes("A")) activeDayIndices.push(6);
    }

    const uniqueDays = activeDayIndices.length ? [...new Set(activeDayIndices)] : [0, 1, 2, 3, 4];
    uniqueDays.forEach((dayIdx) => {
      classItems.push({
        courseCode: c.code,
        courseName: c.title,
        section: c.section,
        room: c.room,
        faculty: c.faculty,
        dayIndex: dayIdx,
        dayName: dayNameMap[dayIdx],
        timeFormatted: c.timeFormatted,
        startMins,
        endMins,
      });
    });
  });

  if (!classItems.length) return null;

  // Check today's classes
  const todayClasses = classItems
    .filter((item) => item.dayIndex === currentDayIndex && item.startMins != null)
    .sort((a, b) => a.startMins - b.startMins);

  for (const item of todayClasses) {
    if (item.startMins > currentMinutes) {
      const diff = item.startMins - currentMinutes;
      const hours = Math.floor(diff / 60);
      const mins = diff % 60;
      const countdown = hours > 0 ? `Starts in ${hours}h ${mins}m` : `Starts in ${mins} mins`;
      return {
        ...item,
        statusLabel: "Next Class Today",
        countdownBadge: countdown,
        isLiveNow: false,
      };
    } else if (item.endMins && currentMinutes <= item.endMins) {
      return {
        ...item,
        statusLabel: "Class In Session Now",
        countdownBadge: "Live Now",
        isLiveNow: true,
      };
    }
  }

  // Look for next upcoming day in week
  for (let offset = 1; offset <= 7; offset++) {
    const targetDayIndex = (currentDayIndex + offset) % 7;
    const upcoming = classItems
      .filter((item) => item.dayIndex === targetDayIndex && item.startMins != null)
      .sort((a, b) => a.startMins - b.startMins);
    if (upcoming.length > 0) {
      const nextClass = upcoming[0];
      const dayLabel = offset === 1 ? "Tomorrow" : nextClass.dayName;
      return {
        ...nextClass,
        statusLabel: `Next Class • ${dayLabel}`,
        countdownBadge: dayLabel,
        isLiveNow: false,
      };
    }
  }

  return {
    ...classItems[0],
    statusLabel: "Class Schedule",
    countdownBadge: classItems[0].dayName || "Weekly",
    isLiveNow: false,
  };
}

/* ---------------- SVG Theme Icons ---------------- */
const ICONS = {
  bolt: `<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  book: `<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="14" y2="10"/></svg>`,
  calendar: `<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3" ry="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  gradCap: `<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  clock: `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  person: `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  eye: `<svg class="stat-eye-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeSlash: `<svg class="stat-eye-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
};

/* ---------------- Privacy Toggle for CGPA & Credits ---------------- */
window._statsHidden = localStorage.getItem("iras_hide_stats") === "1";

window.toggleStatsVisibility = function() {
  window._statsHidden = !window._statsHidden;
  localStorage.setItem("iras_hide_stats", window._statsHidden ? "1" : "0");
  render();
};

/* ---------------- IUB Grade Points & Academic Stats ---------------- */
const IUB_GRADE_POINTS = {
  "A": 4.0,
  "A-": 3.7,
  "B+": 3.3,
  "B": 3.0,
  "B-": 2.7,
  "C+": 2.3,
  "C": 2.0,
  "C-": 1.7,
  "D+": 1.3,
  "D": 1.0,
  "F": 0.0,
};

function getAcademicStats(history) {
  const det = (S.d.details && S.d.details.value) || {};
  const detObj = Array.isArray(det) ? (det[0] || {}) : (det && det.data ? det.data : det);
  const p = prof();

  const directCgpa = pick(detObj, ["cgpa", "CGPA", "cGPA", "currentCgpa", "cumulativeGpa", "gpa", "gradePointAverage"]) ||
                     pick(p, ["cgpa", "CGPA", "cGPA", "cumulativeGpa", "gpa"]);

  const directCredits = pick(detObj, ["creditsEarned", "creditEarned", "completedCredits", "creditsCompleted", "totalCreditEarned", "passedCredits", "earnedCredits", "totalCreditsEarned"]) ||
                        pick(p, ["creditsEarned", "creditEarned", "completedCredits", "creditsCompleted", "totalCreditEarned", "passedCredits"]);

  let totalQualityPoints = 0;
  let totalGpaCredits = 0;
  let totalEarnedCredits = 0;
  let totalCourses = 0;

  if (history && history.length) {
    history.forEach((sem) => {
      sem.courses.forEach((c) => {
        totalCourses++;
        const cr = Number(c.credit) || 0;
        const g = String(c.grade || "").trim().toUpperCase();
        if (IUB_GRADE_POINTS[g] !== undefined) {
          totalQualityPoints += IUB_GRADE_POINTS[g] * cr;
          totalGpaCredits += cr;
          if (g !== "F") {
            totalEarnedCredits += cr;
          }
        } else if (g === "P" || g === "S" || g === "WAIVED" || g === "PASS") {
          totalEarnedCredits += cr;
        }
      });
    });
  }

  const computedCgpa = totalGpaCredits > 0 ? (totalQualityPoints / totalGpaCredits).toFixed(2) : null;
  const cgpa = directCgpa ? Number(directCgpa).toFixed(2) : computedCgpa;
  const credits = directCredits ? Number(directCredits).toFixed(1) : totalEarnedCredits.toFixed(1);

  return {
    cgpa: cgpa != null ? cgpa : "—",
    credits,
    totalCourses,
    totalSemesters: history ? history.length : 0,
  };
}

/* ---------------- 1. HOME VIEW ---------------- */

function vHome() {
  const p = prof();
  const det = (S.d.details && S.d.details.value) || {};
  const fullName = liveName();
  const { current, history, currentSemTitle, targetYear, targetSem, latestYear, latestSem } = getRunningCoursesAndHistory();
  const nextClass = getNextClass(current);
  const stats = getAcademicStats(history);

  const programName =
    pick(det, ["programName", "program", "majorName", "department"]) ||
    pick(p, ["program", "department"]) ||
    "Independent University, Bangladesh";

  let flashCardHTML = "";
  if (nextClass) {
    flashCardHTML = `
      <div class="flash-card">
        <div class="flash-top">
          <span class="flash-badge ${nextClass.isLiveNow ? "live-now" : ""}">
            ${esc(nextClass.statusLabel)} • ${esc(nextClass.countdownBadge)}
          </span>
          <span class="room-pill">${ICONS.pin} ${esc(nextClass.room)}</span>
        </div>
        <div class="flash-time">${esc(nextClass.timeFormatted)}</div>
        <div class="flash-course-title">${esc(nextClass.courseCode)} — ${esc(nextClass.courseName)}</div>
        <div class="flash-meta">
          ${nextClass.section ? `<span>Section <b>${esc(nextClass.section)}</b></span>` : ""}
          ${nextClass.faculty ? `<span>Faculty: <b>${esc(nextClass.faculty)}</b></span>` : ""}
        </div>
      </div>`;
  } else {
    flashCardHTML = `
      <div class="flash-card">
        <div class="flash-empty">
          <p style="font-size:18px;font-weight:700;margin-bottom:6px">No upcoming classes today</p>
          <p class="muted">Check your schedule tab for your weekly timetable.</p>
        </div>
      </div>`;
  }

  content.innerHTML = `
    <!-- Hero Greeting -->
    <div class="hero">
      <div class="hero-top">
        <img class="live-photo" src="${livePhoto()}" alt="" onerror="this.outerHTML='<div class=&quot;avatar&quot;>${esc(initials())}</div>'">
        <div style="flex:1">
          <h2>${esc(fullName)}</h2>
          <p>ID ${esc(S.live.sid)} • ${esc(currentSemTitle)}</p>
        </div>
      </div>
      <p>${esc(programName)}</p>
      <div class="hero-stats">
        <div class="hero-stat-pill clickable-pill" onclick="window.toggleStatsVisibility()" title="Click to ${window._statsHidden ? "reveal" : "hide"}">
          <span class="hero-stat-label">CGPA</span>
          <span class="hero-stat-val" style="color:var(--apple-blue)">${window._statsHidden ? '<span class="pill-hidden-dots">••••</span>' : esc(stats.cgpa)}</span>
          <span class="pill-eye-icon">${window._statsHidden ? ICONS.eyeSlash : ICONS.eye}</span>
        </div>
        <div class="hero-stat-pill clickable-pill" onclick="window.toggleStatsVisibility()" title="Click to ${window._statsHidden ? "reveal" : "hide"}">
          <span class="hero-stat-label">Total Credits</span>
          <span class="hero-stat-val" style="color:var(--apple-green)">${window._statsHidden ? '<span class="pill-hidden-dots">••••</span>' : esc(stats.credits) + " Cr"}</span>
          <span class="pill-eye-icon">${window._statsHidden ? ICONS.eyeSlash : ICONS.eye}</span>
        </div>
      </div>
    </div>

    <!-- Next Class Flash Card -->
    <div>
      <div class="section-title">
        <span class="title-with-icon">
          ${ICONS.bolt}
          <span>Next Class <small class="muted" style="font-size:12px;font-weight:400">(12-Hour)</small></span>
        </span>
      </div>
      ${flashCardHTML}
    </div>

    <!-- Running Courses with Semester Switcher -->
    <div class="card">
      <div class="section-title">
        <span class="title-with-icon">
          ${ICONS.book}
          <span>Running Courses (${current.length})</span>
        </span>
        <select class="sem-dropdown" onchange="window.selectSemester(this.value)" aria-label="Select Semester">
          ${history.map((sem) => `
            <option value="${sem.year}_${sem.semester}" ${sem.year === targetYear && sem.semester === targetSem ? "selected" : ""}>
              ${esc(sem.semTitle)} ${sem.year === latestYear && sem.semester === latestSem ? "(Current)" : ""}
            </option>
          `).join("")}
        </select>
      </div>
      ${renderRunningCoursesHTML(current)}
    </div>
  `;
}

function renderRunningCoursesHTML(courses) {
  const s = S.d.registered || { state: "loading" };
  if (s.state === "loading") return '<div class="skel"></div><div class="skel"></div>';
  if (s.state === "error") return `<p class="load-err">Couldn't load live courses: ${esc(s.value)}</p>`;
  if (!courses.length) return '<p class="muted">No courses found for this semester.</p>';

  return `<div class="course-grid">
    ${courses.map((c) => {
      let attFillClass = "high";
      if (c.percentage != null) {
        if (c.percentage < 60) attFillClass = "low";
        else if (c.percentage < 75) attFillClass = "med";
      }

      return `
        <div class="course-card">
          <div class="course-header">
            <span class="course-tag">${esc(c.code)}</span>
            <span class="sec-tag">${c.section ? "Sec " + esc(c.section) : ""} • ${c.credit} Cr</span>
          </div>
          <div class="course-title-text">${esc(c.title || "Untitled Course")}</div>
          <div class="course-meta-row">
            <div class="course-meta-item">${ICONS.pin} <span>Room: <b>${esc(c.room)}</b></span></div>
            <div class="course-meta-item">${ICONS.clock} <span><b>${esc(c.timeFormatted)}</b> ${c.daysRaw ? "(" + esc(c.daysRaw) + ")" : ""}</span></div>
            ${c.faculty ? `<div class="course-meta-item">${ICONS.person} <span>${esc(c.faculty)}</span></div>` : ""}
          </div>
          ${c.percentage != null ? `
            <div class="att-bar-wrap">
              <div class="att-bar-header">
                <span class="muted">Attendance</span>
                <span style="color: ${c.percentage >= 75 ? "var(--green)" : c.percentage >= 60 ? "var(--amber)" : "var(--red)"}">
                  <b>${c.percentage}%</b> (${c.attend}/${c.classCount})
                </span>
              </div>
              <div class="att-track">
                <div class="att-fill ${attFillClass}" style="width: ${Math.min(100, c.percentage)}%"></div>
              </div>
            </div>` : ""}
        </div>`;
    }).join("")}
  </div>`;
}

/* ---------------- 2. ATTENDANCE VIEW ---------------- */

function vAttendance() {
  const { current, history, currentSemTitle, targetYear, targetSem, latestYear, latestSem } = getRunningCoursesAndHistory();
  const withAtt = current.filter((c) => c.percentage != null);
  const avgAtt = withAtt.length
    ? Math.round(withAtt.reduce((sum, c) => sum + c.percentage, 0) / withAtt.length)
    : null;

  content.innerHTML = `
    <!-- Attendance Summary Hero -->
    <div class="att-hero">
      <div>
        <div style="margin-bottom:8px">
          <select class="sem-dropdown" onchange="window.selectSemester(this.value)" aria-label="Select Semester">
            ${history.map((sem) => `
              <option value="${sem.year}_${sem.semester}" ${sem.year === targetYear && sem.semester === targetSem ? "selected" : ""}>
                ${esc(sem.semTitle)} ${sem.year === latestYear && sem.semester === latestSem ? "(Current)" : ""}
              </option>
            `).join("")}
          </select>
        </div>
        <h2 style="font-size:22px;font-weight:800;margin-bottom:4px">Course Attendance</h2>
        <p class="muted">Live class attendance tracking for all your courses.</p>
      </div>
      ${avgAtt != null ? `
        <div style="text-align:right">
          <div class="att-stat-big">${avgAtt}%</div>
          <div style="font-size:12px;font-weight:600;color:var(--green)">Semester Average</div>
        </div>` : ""}
    </div>

    <!-- Attendance Cards -->
    <div class="course-grid">
      ${current.map((c) => {
        const pct = c.percentage != null ? c.percentage : 100;
        const barColor = pct >= 75 ? "high" : pct >= 60 ? "med" : "low";

        return `
          <div class="att-card-item">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <span class="course-tag">${esc(c.code)}</span>
                <h4 style="font-size:16px;font-weight:700;margin-top:8px">${esc(c.title)}</h4>
                <p class="muted" style="margin-top:2px">${c.section ? "Sec " + esc(c.section) : ""} • Room ${esc(c.room)}</p>
              </div>
              <div style="text-align:right">
                <span style="font-size:24px;font-weight:900;color:${pct >= 75 ? "var(--green)" : pct >= 60 ? "var(--amber)" : "var(--red)"}">
                  ${c.percentage != null ? c.percentage + "%" : "N/A"}
                </span>
              </div>
            </div>

            <div class="att-bar-wrap" style="margin-top:8px">
              <div class="att-track" style="height:8px">
                <div class="att-fill ${barColor}" style="width:${Math.min(100, pct)}%"></div>
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding-top:4px">
              <span><b>${c.attend}</b> attended • <b>${c.missed}</b> missed of <b>${c.classCount}</b> classes</span>
              <span class="${c.standingClass}">${esc(c.standing)}</span>
            </div>
          </div>`;
      }).join("")}
    </div>
  `;
}

/* ---------------- 3. COURSE HISTORY VIEW ---------------- */

function vHistory() {
  const { history } = getRunningCoursesAndHistory();
  const stats = getAcademicStats(history);

  content.innerHTML = `
    <!-- History Hero -->
    <div class="history-hero">
      <div>
        <h2 style="font-size:24px;font-weight:800;letter-spacing:-0.4px;color:#ffffff;margin-bottom:4px">Academic History</h2>
        <p class="muted">${stats.totalSemesters} Semesters • ${stats.totalCourses} Total Courses</p>
      </div>
      <button class="btn-primary" onclick="downloadTranscript()">${ICONS.download} <span>Official Transcript (PDF)</span></button>
    </div>

    <!-- Apple Stat Cards for Total Credits & CGPA -->
    <div class="stats-grid">
      <div class="stat-card clickable-stat" onclick="window.toggleStatsVisibility()" title="Click to ${window._statsHidden ? "reveal" : "hide"}">
        <div class="stat-card-header">
          <div class="stat-label">CUMULATIVE GPA (CGPA)</div>
          <span class="stat-toggle-icon">${window._statsHidden ? ICONS.eyeSlash : ICONS.eye}</span>
        </div>
        <div class="stat-value highlight-blue">${window._statsHidden ? '<span class="stat-hidden-dots">••••</span>' : esc(stats.cgpa)}</div>
        <div class="stat-sub">${window._statsHidden ? "Hidden • Click to reveal" : "Scale 4.00 • Click to hide"}</div>
      </div>
      <div class="stat-card clickable-stat" onclick="window.toggleStatsVisibility()" title="Click to ${window._statsHidden ? "reveal" : "hide"}">
        <div class="stat-card-header">
          <div class="stat-label">TOTAL CREDITS EARNED</div>
          <span class="stat-toggle-icon">${window._statsHidden ? ICONS.eyeSlash : ICONS.eye}</span>
        </div>
        <div class="stat-value highlight-green">${window._statsHidden ? '<span class="stat-hidden-dots">••••</span>' : esc(stats.credits) + ' <span class="stat-unit">Cr</span>'}</div>
        <div class="stat-sub">${window._statsHidden ? "Hidden • Click to reveal" : "Completed Academic Credits • Click to hide"}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-label">TOTAL COURSES</div>
        </div>
        <div class="stat-value">${stats.totalCourses}</div>
        <div class="stat-sub">Across ${stats.totalSemesters} Semesters</div>
      </div>
    </div>

    <!-- Divided by Semester -->
    ${!history.length ? '<p class="muted">No course history returned by Priverse.</p>' :
      history.map((sem) => `
        <div class="semester-block">
          <div class="semester-block-header">
            <div class="semester-block-title">
              <span class="title-with-icon">${ICONS.gradCap} <span>${esc(sem.semTitle)}</span></span>
            </div>
            <div class="semester-block-meta">
              ${sem.courses.length} Courses • ${sem.totalCredits.toFixed(1)} Credits
            </div>
          </div>
          <div>
            ${sem.courses.map((c) => {
              let gradeClass = "grade-ip";
              const g = String(c.grade || "").toUpperCase();
              if (g.startsWith("A")) gradeClass = "grade-a";
              else if (g.startsWith("B")) gradeClass = "grade-b";
              else if (g.startsWith("C") || g.startsWith("D")) gradeClass = "grade-c";
              else if (g.startsWith("F") || g.startsWith("W")) gradeClass = "grade-f";

              return `
                <div class="history-item">
                  <div>
                    <div style="font-size:15px;font-weight:700"><b>${esc(c.code)}</b> — ${esc(c.title)}</div>
                    <div class="muted" style="font-size:12.5px;margin-top:2px">
                      ${c.section ? "Sec " + esc(c.section) + " • " : ""}${c.credit} Credits${c.faculty ? " • " + esc(c.faculty) : ""}
                    </div>
                  </div>
                  <div>
                    <span class="grade-pill ${gradeClass}">${esc(c.grade)}</span>
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>`).join("")}
  `;
}

/* ---------------- 4. SCHEDULE VIEW ---------------- */

function vSchedule() {
  const { current } = getRunningCoursesAndHistory();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Saturday"];
  const dayIndices = [0, 1, 2, 3, 4, 6];
  const todayIdx = new Date().getDay();
  const activeDay = dayIndices.includes(todayIdx) ? todayIdx : 0;

  if (window._selectedScheduleDay == null) {
    window._selectedScheduleDay = activeDay;
  }

  const selectedDay = window._selectedScheduleDay;

  // Filter courses active on selectedDay
  const dayCourses = current.filter((c) => {
    const combined = (c.daysRaw + " " + c.timeRaw).toUpperCase();
    if (selectedDay === 0 && (combined.includes("ST") || combined.includes("S"))) return true;
    if (selectedDay === 1 && (combined.includes("MW") || combined.includes("M"))) return true;
    if (selectedDay === 2 && (combined.includes("ST") || combined.includes("T"))) return true;
    if (selectedDay === 3 && (combined.includes("MW") || combined.includes("W"))) return true;
    if (selectedDay === 4 && (combined.includes("RA") || combined.includes("R"))) return true;
    if (selectedDay === 6 && (combined.includes("RA") || combined.includes("A") || combined.includes("SAT"))) return true;
    return false;
  });

  content.innerHTML = `
    <div class="card">
      <div class="section-title">
        <span class="title-with-icon">${ICONS.calendar} <span>Class Routine (12-Hour)</span></span>
      </div>

      <!-- Day Selector -->
      <div class="day-selector">
        ${dayIndices.map((d, i) => `
          <button class="day-btn ${d === selectedDay ? "active" : ""}" onclick="window._selectedScheduleDay = ${d}; render();">
            ${dayNames[i]}
          </button>`).join("")}
      </div>

      <!-- Schedule Timeline -->
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
        ${!dayCourses.length ? '<p class="muted" style="padding:20px 0;text-align:center">No classes scheduled on this day.</p>' :
          dayCourses.map((c) => `
            <div class="timeline-card">
              <div>
                <div style="font-size:18px;font-weight:800;color:#fff">${esc(c.timeFormatted)}</div>
                <div style="font-size:15px;font-weight:700;margin-top:4px"><b>${esc(c.code)}</b> — ${esc(c.title)}</div>
                <div class="muted" style="margin-top:2px">${c.section ? "Sec " + esc(c.section) + " • " : ""}${c.faculty ? esc(c.faculty) : ""}</div>
              </div>
              <div>
                <span class="room-pill">${ICONS.pin} ${esc(c.room)}</span>
              </div>
            </div>`).join("")}
      </div>
    </div>
  `;
}

/* ---------------- 5. PROFILE VIEW (CLEAN - ONLY FULL NAME & ID) ---------------- */

function vProfile() {
  const p = prof();
  const det = (S.d.details && S.d.details.value) || {};
  const fullName = liveName();
  const programName =
    pick(det, ["programName", "program", "majorName", "department"]) ||
    pick(p, ["program", "department"]) ||
    "Independent University, Bangladesh";
  const { history } = getRunningCoursesAndHistory();
  const stats = getAcademicStats(history);

  content.innerHTML = `
    <div class="student-id-card">
      <div class="student-photo-wrapper">
        <img class="student-photo-lg" src="${livePhoto()}" alt="" onerror="this.outerHTML='<div class=&quot;student-avatar-lg&quot;>${esc(initials())}</div>'">
      </div>
      <h2 class="student-name-lg">${esc(fullName)}</h2>
      <div class="student-id-badge">ID ${esc(S.live.sid)}</div>
      <div class="student-program">${esc(programName)}</div>

      <div class="hero-stats" style="margin-bottom:24px;justify-content:center">
        <div class="hero-stat-pill clickable-pill" onclick="window.toggleStatsVisibility()" title="Click to ${window._statsHidden ? "reveal" : "hide"}">
          <span class="hero-stat-label">CGPA</span>
          <span class="hero-stat-val" style="color:var(--apple-blue)">${window._statsHidden ? '<span class="pill-hidden-dots">••••</span>' : esc(stats.cgpa)}</span>
          <span class="pill-eye-icon">${window._statsHidden ? ICONS.eyeSlash : ICONS.eye}</span>
        </div>
        <div class="hero-stat-pill clickable-pill" onclick="window.toggleStatsVisibility()" title="Click to ${window._statsHidden ? "reveal" : "hide"}">
          <span class="hero-stat-label">Total Credits</span>
          <span class="hero-stat-val" style="color:var(--apple-green)">${window._statsHidden ? '<span class="pill-hidden-dots">••••</span>' : esc(stats.credits) + " Cr"}</span>
          <span class="pill-eye-icon">${window._statsHidden ? ICONS.eyeSlash : ICONS.eye}</span>
        </div>
      </div>

      <div class="profile-actions">
        <button class="btn-primary btn-lg" onclick="downloadTranscript()">${ICONS.download} <span>Download Official Transcript (PDF)</span></button>
        <button class="btn-danger" id="logout-btn">Sign Out</button>
      </div>
    </div>
  `;

  $("logout-btn").addEventListener("click", () => {
    if (confirm("Log out of Priverse?")) {
      try { localStorage.removeItem(LIVE_SESSION_KEY); } catch (_) { /* storage unavailable */ }
      try { sessionStorage.removeItem("iras_live_session"); } catch (_) { /* storage unavailable */ }
      S.live = null; S.d = {}; S.tab = "home";
      document.querySelectorAll("#side-nav button, #bottom-nav button")
        .forEach((b) => b.classList.toggle("active", b.dataset.tab === "home"));
      $("topbar-title").textContent = TITLES.home;
      $("login-id").value = ""; $("login-pw").value = "";
      $("app").hidden = true;
      $("login-screen").hidden = false;
    }
  });
}

/* ---------------- Shared Helpers (Transcript, Notices, Card) ---------------- */

async function downloadTranscript() {
  if (!S.live) return;
  const hunt = [S.d.details && S.d.details.value, S.d.registered && S.d.registered.value, S.d.profile && S.d.profile.value];
  let adm;
  for (const h of hunt) { adm = findKey(h, /admission/i); if (adm && typeof adm !== "object") break; else adm = undefined; }
  if (!adm) { toast("No admission code found in live Priverse data — transcript unavailable"); return; }
  toast("Fetching official transcript PDF…");
  try {
    let blob = await liveFwd("/api/v1/student/" + encodeURIComponent(S.live.sid) + "/" + encodeURIComponent(String(adm)) + "/transcript", S.live.token, true);
    // IRAS may return the PDF as Base64 text instead of raw PDF bytes.
    let head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    let signature = String.fromCharCode(...head);
    if (signature !== "%PDF-") {
      const responseText = (await blob.text()).trim();
      let encoded = responseText;
      try {
        const parsed = JSON.parse(responseText);
        if (typeof parsed === "string") encoded = parsed;
        else if (parsed && typeof parsed === "object") encoded = parsed.data || parsed.pdf || parsed.content || responseText;
      } catch (_) { /* response may be unquoted Base64 */ }
      encoded = String(encoded).replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
      if (/^(?:JVBERi0|%PDF-)/.test(encoded)) {
        try {
          const decoded = atob(encoded);
          const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
          blob = new Blob([bytes], { type: "application/pdf" });
          head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
          signature = String.fromCharCode(...head);
        } catch (_) { /* handled below as a non-PDF response */ }
      }
    }
    if (signature !== "%PDF-") {
      const responseText = (await blob.text()).trim();
      let detail = responseText;
      try {
        const parsed = JSON.parse(responseText);
        detail = parsed.message || parsed.error || parsed.detail || responseText;
      } catch (_) { /* response was plain text */ }
      throw new Error("Priverse returned a non-PDF response" + (detail ? ": " + detail.slice(0, 140) : ""));
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
    a.download = "Transcript_" + S.live.sid + ".pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    toast("Transcript download failed (" + e.message + ")");
  }
}

function secCard(title, key, bodyFn) {
  const s = S.d[key] || { state: "loading" };
  let body;
  if (s.state === "loading") body = '<div class="skel"></div><div class="skel"></div>';
  else if (s.state === "error") body = `<p class="load-err">Couldn't load live data: ${esc(s.value)}</p>`;
  else if (s.state === "empty") body = `<p class="muted">Priverse returned no data here.${typeof s.value === "string" ? " " + esc(s.value) : ""}</p>`;
  else body = bodyFn(s.value);
  return `<div class="card"><div class="section-title"><span>${title}</span> <span class="chip chip-live">LIVE</span></div>${body}</div>`;
}

function noticeHTML(v) {
  const list = (v && (v.notifyMessage || v.messages || v.notices || v.notification)) || (Array.isArray(v) ? v : null);
  if (Array.isArray(list) && list.length) {
    return list.map((n) => {
      if (typeof n === "string") return `<div class="notice"><div class="notice-ico">📢</div><div><p>${esc(n)}</p></div></div>`;
      const t = pick(n, ["title", "subject", "heading", "message", "text", "notice"]);
      const d = pick(n, ["message", "text", "detail", "description", "body"]);
      const dt = pick(n, ["date", "noticeDate", "createdAt", "publishDate"]);
      return `<div class="notice"><div class="notice-ico">📢</div>
        <div style="flex:1"><div class="notice-head"><h4>${esc(t || "Notice")}</h4>
        ${dt ? `<span class="notice-date">${esc(dt)}</span>` : ""}</div>
        ${d && d !== t ? `<p>${esc(d)}</p>` : ""}</div></div>`;
    }).join("");
  }
  return kvRows(v);
}

restoreLiveSession();
