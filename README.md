# BB's LibMan

<p align="center">
  <img src="assets/icon.png" width="80" alt="BB's LibMan" />
</p>

<p align="center">
  A desktop library manager for 3D models, VRChat avatars, and game assets — with deep Booth integration.
  <br />
  Built with Electron. Windows 10/11.
</p>

---

## Features

### 🗂 Library
- Browse all imported assets with thumbnail previews
- Switch between **Grid**, **List with thumbnail**, and **Compact** (no thumbnail) view modes
- Search assets by name and sort by date or alphabetically
- **Pagination** — configurable page size (10, 30, or 50 items per page)
- Asset counter in the toolbar showing total count, with a hover breakdown of local vs Booth items
- Modified cards **glow** briefly to highlight which asset was just changed or added

### 🏷 Tag System
- Assets can have multiple tags — local assets get tags from the import dialog, Booth items get them from their database
- When scraping a Booth URL, all item tags are fetched automatically from the Booth JSON API
- **Tag filter** — click the ⌖ Tags button to open a searchable tag panel; select one or more tags to filter the library (AND logic)
- Click any tag pill on a card to instantly filter by that tag
- Tags are editable at any time from the Edit dialog with autocomplete suggestions

### 📥 Importing Assets
- **Downloads Monitor** — watches your downloads folder and automatically opens the import dialog when a supported file is detected
- **Drag & Drop** — drag a file onto the window to choose between two actions:
  - **Add New Asset** (left zone) — opens the import dialog
  - **Add to Existing Asset** (right zone) — hover for 500ms to activate card drop targets, then drop the file directly onto any card to add it to that asset's folder without any dialog
- **URL Scraping** — paste a Booth URL to automatically fetch the asset name, tags, and thumbnail via the Booth JSON API; other sites use HTML scraping
- Thumbnails are downloaded and transcoded to 500×500 PNG at import time

### 🛍 Booth Library Manager Integration
- Connect your local [Booth Library Manager](https://booth.pm) database to display all your Booth purchases alongside your own imported assets
- Booth items show their original thumbnails with a Booth badge overlay
- Booth item tags are read directly from the BLM database (`booth_item_tag_relations`)
- Clicking a Booth item opens its local download folder (if configured)
- Hide individual Booth items independently of your local library

### 🔗 URL Protocol Handlers
Register BB's LibMan as the default handler for custom URL schemes, enabling fully automatic one-click importing from external apps:

| Scheme | App |
|---|---|
| `booth-library-manager://` | Booth Library Manager |
| `vroid.closet://` | VRoid Closet |
| `BunsLM://` | Custom / companion scripts |

When a supported link is triggered, BB's LibMan:
1. Immediately scrapes the Booth page for name, tags, and thumbnail — the asset card appears in the library right away
2. Downloads the file in the background with a per-card progress bar
3. Moves the file into the asset folder and marks the card complete
4. Shows a system notification when done

Multiple links triggered in quick succession are handled by a **download queue** — one download runs at a time, with a footer indicator showing the active download progress and how many items are waiting.

### ✏️ Asset Management
- **Single click** — opens the Edit dialog to update name, origin URL, tags, or thumbnail
- **Double click** — opens the asset folder in Explorer
- **Right-click** — context menu with Edit, Hide, and Delete options
- **Hide** — remove an asset from the library view without deleting it; restore it from Settings → Hidden Assets
- **Delete** — permanently delete an asset and all its files

### 🖥 System Tray
- Minimizing or closing the window sends the app to the system tray
- The app keeps running in the background, monitoring downloads
- Double-click the tray icon or use the right-click menu to restore or quit

---

## Supported Asset Sites

Smart folder naming extracts store and asset slugs from known URLs:

| Site | Folder format |
|---|---|
| Gumroad (`*.gumroad.com/i/<asset>`) | `storename.asset` |
| Jinxxy (`jinxxy.com/<store>/<asset>`) | `storename.asset` |
| Booth.pm and others | `asset-slug` |

---

## Supported File Types

Archives, Unity packages, and common 3D formats are detected automatically by the downloads monitor:

`zip` `rar` `7z` `tar` `gz` `unitypackage` `uasset` `blend` `fbx` `obj` `max` `ma` `mb` `stl` `gltf` `glb` `usd` `usda` `usdc` `abc` `dae`

---

## Requirements

- [Node.js](https://nodejs.org) v18 or later
- Windows 10 / 11

---

## Installation

```bash
# Clone the repo
git clone https://github.com/BunBnnuy/BBLM.git
cd BBLM

# Install dependencies
npm install
```

---

## Running

### Development (debug mode)
Launches the app with the Node.js inspector on port **5858**.

```bash
npm run dev
```

Attach the main-process debugger at `chrome://inspect` → Configure → `localhost:5858`.

### Production
```bash
npm start
```

---

## Building a Distributable

Produces a Windows NSIS installer in `dist/`.

```bash
npm run build
```

> **Note:** The first build downloads the Electron binary if it isn't cached — this may take a few minutes.

---

## First-Time Setup

1. Launch the app
2. Click **⚙ Settings**
3. Set your **Root Folder** — all imported assets are organised here
4. Set your **Downloads Folder** — where your browser saves files (defaults to `~/Downloads`)
5. Enable the **Downloads Monitor** toggle
6. Click **Save Settings**

From now on, whenever a supported file finishes downloading the import dialog opens automatically.

### Optional: Booth Library Manager
1. In Settings, enable **Include Booth Library Manager**
2. Set your **Booth LM Download Folder** (where Booth Library Manager saves files)
3. Save — your Booth purchases will appear in the library alongside your local assets

### Optional: URL Protocol Handlers
In Settings → **URL Schemes**, toggle on any scheme to register BB's LibMan as the default handler. After enabling, clicking download links in Booth Library Manager or VRoid Closet will trigger a fully automatic import — no dialogs needed.

---

## Project Structure

```
├── main.js                  # Electron main process + download queue
├── preload.js               # Context bridge (main ↔ renderer)
├── src/
│   ├── assetManager.js      # Import, update, delete, shell creation, meta.json
│   ├── downloadsMonitor.js  # fs.watch + file stability poller
│   ├── fileWatcher.js       # One-shot file wait (manual import)
│   └── scraper.js           # Booth JSON API + HTML scraper (title, images, tags)
├── renderer/
│   ├── index.html / app.js          # Main library view + pagination + tag filter
│   ├── modal.html / modal.js        # Import / edit dialog with tag editor
│   ├── settings.html / settings.js  # Settings page
│   └── styles.css
├── assets/
│   ├── icon.png
│   └── booth.png
└── companion/
    └── RSLimMan.user.js     # Tampermonkey companion script (optional)
```

---

## Asset Folder Structure

Each imported asset gets its own folder inside the root folder:

```
<root>/
└── storename.asset-slug/
    ├── asset-file.zip       # The original downloaded file
    ├── thumbnail.png        # 500×500 PNG thumbnail
    └── meta.json            # Name, origin URL, import date, tags, download status
```

---

## Open Source

BB's LibMan is built on:

- [Electron](https://www.electronjs.org/) — MIT
- [electron-store](https://github.com/sindresorhus/electron-store) — MIT
- [sql.js](https://github.com/sql-js/sql.js) — MIT
- [sharp](https://sharp.pixelplumbing.com/) — Apache-2.0
- [cheerio](https://cheerio.js.org/) — MIT
- [electron-builder](https://www.electron.build/) — MIT

---

<p align="center">Made with ♥ for R.S. by BunBnnuy</p>
