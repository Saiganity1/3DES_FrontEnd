# CIT Inventory Web (Static HTML/JS)

Static web UI that talks to the Django API.

## Local run

```powershell
py -m http.server 5173
```

Open:
- `http://127.0.0.1:5173`

Set the API base URL in the page (or edit `config.js`).

## Deploy to Render (Static Site)

Create a Render **Static Site** from this repo:
- Publish directory: `.`
- Build command: *(empty)*

After deploying, set the API URL:
- either in the UI (saved in browser)
- or by editing `config.js` and redeploying
