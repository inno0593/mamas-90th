# Mama's 90th

Event site and travel & lodging sign-up for Mama's 90th birthday (Tagaytay outing Feb 21–23, birthday Feb 25, 2027).

- **Site:** `index.html` + `assets/`, hosted on GitHub Pages.
- **Responses:** a Google Sheet. `backend/Code.gs` runs inside it as an Apps Script web app. Every request is a POST that carries the family password: one kind reads everyone, the other saves one person.
- **Config:** `config.js` holds the web app URL. The password is not in this repo.

## Family password

The page opens on a password screen, and the backend only sends the sign-up list to requests with the right password. Each device remembers it after the first time.

- **Set or change it:** in Apps Script, **⚙️ Project Settings → Script Properties**, property `SITE_PASSWORD`. A change applies straight away, with no redeploy, and everyone is asked for the new password on their next visit.
- Capital letters and spaces don't matter, so `Lola 2027` and `lola2027` both work.
- After 30 wrong tries within 10 minutes, the site refuses everyone (even the right password) until 10 minutes pass with no wrong tries. That keeps anyone from guessing at it quickly.
- **What it doesn't hide:** anything written into `index.html` (dates, places, the FAQ) is in the page code and this public repo, and the link preview shows the dates. Put private details like addresses or room assignments in the sheet, not in `index.html`.

## One-time Google setup

1. Make a new Google Sheet ([sheets.new](https://sheets.new)) and name it something like "Mama's 90th sign-up".
2. **Extensions → Apps Script.** Replace everything in `Code.gs` with the contents of `backend/Code.gs`.
3. Next to **Files**, click **+ → Script**, name it `Seed`, and paste in `backend/Seed.gs`. That's the 30 people from the old spreadsheet. It's kept out of git because it has everyone's details.
4. Click **⚙️ Project Settings**, scroll to **Script Properties**, and add the property `SITE_PASSWORD` with the family password as its value.
5. Click **Save**, then **Deploy → New deployment**. Click the gear and pick **Web app**. Set *Execute as*: **Me**, *Who has access*: **Anyone**. Then click **Deploy**.
6. Authorize it. Google will say it "hasn't verified this app" because it's your own script: click **Advanced → Go to … (unsafe) → Allow**.
7. Copy the **Web app URL** (it ends in `/exec`) into `config.js`.

The first visit creates the **Sign-Up** tab (same columns as the old sheet, plus a hidden ID), loads the seed, and adds a **Summary** tab with totals.

You can edit rows straight in the sheet too. The site picks up those changes, and if someone saves over a row that changed since they opened it, the site asks them to redo their edit instead of overwriting.

## Changing the backend later

After editing the script: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

Don't use **New deployment** for an update. It makes a second URL, and the first one keeps running the old code. The old URL is in this repo's history, and before the password existed it handed the list to anyone.

## Local preview

```bash
node dev/server.mjs
```

That opens http://localhost:8090. It runs the real `backend/Code.gs` against an in-memory fake sheet, seeded from `backend/Seed.gs`, so nothing you do there touches the real sheet. The password is `family`. Start it with `SITE_PASSWORD=something` to use another, or `SITE_PASSWORD=` to see the "not set up yet" message.

After changing `assets/app.js` or `assets/styles.css`, bump the `?v=` number where `index.html` loads them, so visitors don't get a cached old file with the new page.

## Link preview image

`assets/og-image.png` is the picture shown when the link is shared in iMessage and other chats. Its design lives in `dev/og-image.html`. After editing that file, re-render it:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=8000 --screenshot="$PWD/assets/og-image.png" "file://$PWD/dev/og-image.html"
```

Chats cache previews, so a link that was already sent keeps its old preview. A link shared for the first time picks up the new one, and adding something like `?v=2` to the end makes it count as new.

## Adding event details

The event info lives in `index.html` under `<section id="details">`. The lodging choices and event nights are at the top of `assets/app.js`. The lodging list must match `LODGING` in `backend/Code.gs`.
