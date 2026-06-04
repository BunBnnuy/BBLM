# BB's LibMan

A desktop library manager for 3D model and game asset downloads. Built with Electron.

![BB's LibMan icon](assets/icon.png)

## Features

- **Downloads monitor** — watches your downloads folder and auto-opens the import dialog when a supported file finishes downloading
- **Page scraping** — fetches the asset name and cover images from the origin URL
- **Thumbnail transcoding** — resizes the selected image to 500×500 PNG
- **Smart folder naming** — extracts store/asset names from Gumroad, Jinxxy, and Booth.pm URLs
- **Library grid** — browse assets with thumbnail previews, sortable by date or name
- **Cross-drive support** — safely moves files across different drives (e.g. C: → D:)

## Supported asset sites

| Site | Folder format |
|---|---|
| Gumroad (`*.gumroad.com/i/<asset>`) | `storename.asset` |
| Jinxxy (`jinxxy.com/<store>/<asset>`) | `storename.asset` |
| Booth.pm and others | `asset-slug` |

## Supported file types

Compressed archives, Unity packages, and common 3D formats are detected automatically:

`zip` `rar` `7z` `tar` `gz` `unitypackage` `uasset` `blend` `fbx` `obj` `max` `ma` `mb` `stl` `gltf` `glb` `usd` `usda` `usdc` `abc` `dae`

---

## Requirements

- [Node.js](https://nodejs.org) v18 or later
- Windows 10/11 (primary target)

---

## Installation

```bash
# Clone the repo
git clone <repo-url>
cd BBLM

# Install dependencies
npm install
```

---

## Running

### Development (debug mode)
Opens the app with the Node.js inspector on port **5858** and renderer DevTools attached.

```bash
npm run dev
```

Attach the main-process debugger at `chrome://inspect` → Configure → `localhost:5858`.

### Production
```bash
npm start
```

---

## Building a distributable

Produces a Windows NSIS installer in `dist/`.

```bash
npm run build
```

> **Note:** The first build will download the Electron binary if it isn't cached. This can take a few minutes depending on your connection.

---

## First-time setup

1. Launch the app with `npm run dev` or `npm start`
2. Click **⚙ Settings**
3. Set your **Root Folder** — all imported assets will be organised here
4. Set your **Downloads Folder** — where your browser saves files (defaults to `~/Downloads`)
5. Enable the **Downloads Monitor** toggle
6. Click **Save Settings**

From now on, whenever a supported file finishes downloading the import dialog opens automatically.

---

## Project structure

```
├── main.js                  # Electron main process
├── preload.js               # Context bridge (main ↔ renderer)
├── src/
│   ├── assetManager.js      # File move, folder naming, thumbnail save, meta.json
│   ├── downloadsMonitor.js  # fs.watch + stability poller
│   ├── fileWatcher.js       # One-shot file wait (used by manual import)
│   └── scraper.js           # Cheerio-based page scraper (title + images)
├── renderer/
│   ├── index.html / app.js          # Library grid view
│   ├── modal.html / modal.js        # Import dialog
│   ├── settings.html / settings.js  # Settings page
│   └── styles.css
├── assets/
│   └── icon.png
└── companion/
    └── RSLimMan.user.js     # Tampermonkey script (optional, work in progress)
```

---

## Asset folder structure

Each imported asset gets its own folder inside the root folder:

```
<root>/
└── storename.asset-slug/
    ├── asset-file.zip       # The downloaded file
    ├── thumbnail.png        # 500×500 PNG thumbnail
    └── meta.json            # Name, origin URL, import date
```
