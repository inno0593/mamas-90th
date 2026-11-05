# Mama's 90th

Event site and travel & lodging sign-up for Mama's 90th birthday (Tagaytay outing Feb 21–23, birthday Feb 25, 2027).

- **Site:** `index.html` + `assets/`, hosted on GitHub Pages.
- **Responses:** a Google Sheet. `backend/Code.gs` runs inside it as an Apps Script web app; the site reads everyone with GET and saves one person at a time with POST.
- **Config:** `config.js` holds the web app URL.

## One-time Google setup

1. Make a new Google Sheet ([sheets.new](https://sheets.new)) and name it something like "Mama's 90th sign-up".
2. **Extensions → Apps Script.** Replace everything in `Code.gs` with the contents of `backend/Code.gs`.
3. Next to **Files**, click **+ → Script**, name it `Seed`, and paste in `backend/Seed.gs`. That's the 30 people from the old spreadsheet. It's kept out of git because it has everyone's details.
4. Click **Save**, then **Deploy → New deployment**. Click the gear and pick **Web app**. Set *Execute as*: **Me**, *Who has access*: **Anyone**. Then click **Deploy**.
5. Authorize it. Google will say it "hasn't verified this app" because it's your own script: click **Advanced → Go to … (unsafe) → Allow**.
6. Copy the **Web app URL** (it ends in `/exec`) into `config.js`.

The first visit creates the **Sign-Up** tab (same columns as the old sheet, plus a hidden ID), loads the seed, and adds a **Summary** tab with totals.

You can edit rows straight in the sheet too. The site picks up those changes, and if someone saves over a row that changed since they opened it, the site asks them to redo their edit instead of overwriting.

## Changing the backend later

After editing the script: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

## Local preview

```bash
node dev/server.mjs
```

That opens http://localhost:8090. It runs the real `backend/Code.gs` against an in-memory fake sheet, seeded from `backend/Seed.gs`.

## Link preview image

`assets/og-image.png` is the picture shown when the link is shared in iMessage and other chats. Its design lives in `dev/og-image.html`. After editing that file, re-render it:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=8000 --screenshot="$PWD/assets/og-image.png" "file://$PWD/dev/og-image.html"
```

Chats cache previews, so a link that was already sent keeps its old preview. A link shared for the first time picks up the new one, and adding something like `?v=2` to the end makes it count as new.

## Adding event details

The event info lives in `index.html` under `<section id="details">`. The lodging choices and event nights are at the top of `assets/app.js`. The lodging list must match `LODGING` in `backend/Code.gs`.
