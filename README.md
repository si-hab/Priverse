# Priverse — IUB Student Portal

A modern mobile-first student portal for **Independent University, Bangladesh**




---

## 📱 Run Locally

1. Run the unified server:
   ```bash
   cd "Iras Project/IrasRedesign"
   python3 server.py
   ```

    
  

3. Sign in with your university ID and password.

---

## 🚀 Deploy on Render

Use **Render Web Service** for this project because it can run the Python
server and serve the frontend from one service.

Recommended settings:

```text
Service type: Web Service
Runtime: Python
Build Command: leave empty
Start Command: python server.py
```

The free Render plan is good for demos and testing. Free services can sleep
after inactivity, so the first visit may take a little time to load.

---

## ✨ Features

- **No browser extensions required** — works on iOS Safari, Android Chrome, Mac, Windows, and Linux.
- **Mobile PWA ready** with bottom navigation bar, safe-area notches, and standalone mode.
- **Same-origin architecture** — avoids all CORS and header restrictions automatically.
- **No password storage** — the password is never saved; an access token is cached in this browser to keep the user signed in until the university service expires or rejects it. Sign out clears the cached token.
- **Live student data** from the university's student services.
