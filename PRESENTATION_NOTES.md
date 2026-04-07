# CIT Inventory — Frontend Presentation Notes

This repo is the **static frontend** (HTML/CSS/JS) for the Laboratory Equipment Inventory.

If you’re presenting the full system (frontend + backend):
- Backend repo: https://github.com/Saiganity1/3DES_BackEnd

---

## What this frontend does

- Displays the UA-themed login/register UI.
- Stores JWT tokens after login.
- Calls the backend REST API for:
  - items, categories, accounts, activity feed
- Renders tables/cards and shows toasts.

---

## Where things are

- index.html: `index.html`
  - Page layout (header + auth + app)
  - SSITE logo left, UA logo right, title centered
- styles.css: `styles.css`
  - Theme variables + auth layout + header layout + modal rules
- app.js: `app.js`
  - App logic (auth, API calls, rendering, role-based UI)
- config.js: `config.js`
  - API base URL (window.API_BASE_URL)

---

## Key UI requirements (branding)

- Header uses a 3-column grid so:
  - SSITE stays left
  - Title stays centered
  - UA stays right

---

## Security note (presentation)

Sensitive item fields (location/serial/notes) are stored encrypted in the DB by the backend.
- The default item list is not meant to expose decrypted sensitive fields.
- A dedicated decrypt endpoint exists on the backend and is permission-gated.
