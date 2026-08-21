# Changelog

All notable changes to BB's LibMan are documented here.

This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.4.0] — 2026-08-21

### Added

- **Malware scanning** — imported `.unitypackage`, `.zip`, `.rar`, and `.7z` files are scanned in the background with the [vrchat-scanner](https://github.com/vicentefelipechile/vrchat-scanner) CLI, which is downloaded and kept up to date automatically. Flagged assets show a warning modal with the scan output, and can be marked safe or unsafe. A **⚠ Threat** filter lets you browse the library by scan result. Assets already in your library are swept one at a time whenever the computer has been idle for a few minutes, and a **Scan All Assets Now** button in Settings runs the whole library on demand. Scanning (and the idle backlog sweep) can each be turned off in Settings.
- **Unity project import** — right-click any asset with an archive or `.unitypackage` file and choose **Add to project** to copy selected files straight into an open Unity project, including files nested inside archives. A companion Editor script (`companion/unity/BBLM_Importer.unitypackage`, installed once per project via Settings → Unity Import) lets BB's LibMan detect which Unity projects are currently open and drop packages in for Unity to import automatically.
- **Release notes popup** — shows a summary of what changed after an auto-update, pulled straight from this changelog. Revisit it anytime from Settings → About → **Show Release Notes**.
- **Adult content flag and filter** — items marked adult by the Booth API are tagged as such; a **🔞 Show All** toggle in the library header hides or reveals them.

### Changed

- The Library, Booth Free Items, and Library Scanner tabs now share one header bar, with search and tag/threat filters grouped together above the asset grid.

---

## [1.3.0] — 2026-08-20

### Added

- **Automatic updates** — the app now checks GitHub Releases on launch, downloads updates silently in the background, and installs them on the next quit.
- **Grid / List view toggle** for the Booth Free Items tab, remembered across sessions.

### Fixed

- **Booth Free Items scanning failed with "Invalid IP address: undefined".** The shared HTTPS client's custom DNS resolver didn't handle the calling convention Node uses for Happy Eyeballs (`autoSelectFamily`, on by default since Node 18.13/20), which requests an array of addresses; it received a bare string instead and tried to connect to `undefined`.
- **Free item downloads were silently rejected.** Real Booth deeplinks include `order_id`, `variation_id`, and `client` query parameters that the strict protocol parser didn't allow, so every genuine download link was dropped before it reached the queue.
- **Free item downloads could hang for a full minute and then time out.** The hidden Booth sign-in window only queued a download when Booth's page issued an HTTP redirect to the `booth-library-manager://` scheme; a same-page JS navigation to that scheme was ignored entirely.

### Security

- Hardened filesystem, network, protocol-parsing, and Electron/IPC boundaries against path traversal, SSRF/DNS rebinding, malformed protocol input, and unvalidated privileged messages. Asset imports and metadata writes are now transactional (staged, atomic, rollback-on-failure), and archive scanning runs in a sandboxed worker with strict size/time/nesting limits. See `plan.md` for the full scope.

### Changed

- Quieted noisy debug logging (Booth Library Manager DB reads, protocol payload dumps) from the console.

---

## [1.2.2] — 2026-08-12

Bug-fix release focused on the import pipeline.

### Fixed

- **Multi-file imports lost their fetched metadata.** When importing several files at once, the title and thumbnail retrieved by **Fetch data** were discarded — cards were saved with the raw `.zip` filename as their name and no thumbnail at all. The batch importer was passing the filename as the asset name and hardcoding the thumbnail to empty, so nothing fetched from the page ever reached `meta.json`. Tags were unaffected, which is why partially-correct cards appeared.
- **Multi-file imports overwrote each other.** Files sharing an origin URL resolve to the same asset folder, but each file re-ran the full import, rewriting `meta.json` every time and clobbering the previous file's metadata and file list. Files sharing an origin are now appended to a single asset instead.
- **Import dialog sometimes refused to open until the app was restarted.** A closed or crashed dialog could leave behind a stale window reference; every later attempt to open the dialog then silently focused a dead window and did nothing. The reference is now validated before reuse and cleared if the window fails to load or its render process is gone.
- **Drop overlay could get stuck on screen.** Dragging a file into the window, hovering the *Add to Existing* zone long enough to arm it, then dragging back out left the overlay open indefinitely, since the cancel path was suppressed once that mode engaged. The overlay now clears when the drag ends, with a 10-second failsafe.

### Changed

- **Auto-fetch is no longer limited to single-file imports.** A multi-file import that arrives with a known origin URL now fetches the page data automatically.
- **The asset name field is visible for multi-file imports.** It was previously hidden, leaving the fetched name invisible and uneditable.
- Multi-file imports **with** an origin URL now merge into one asset rather than creating one asset per file. Files with no origin URL are still imported separately, as before.

---

## [1.2.1] — 2026-07-12

### Changed

- Moved the Booth source badge from the bottom-right to the bottom-left of the card thumbnail.

### Added

- Hover-only **↗ open origin link** button in the card's bottom-right corner, opening the item's original listing in the browser without leaving the app.

---

## [1.2.0] — 2026-06-16

### Added

- **Library Scanner** tab — scan any folder recursively for archives and Unity packages already on disk, with paginated results, one-click import, Copy All, live progress, and cancellation.
- Desktop **notifications toggle** in Settings for completed and failed downloads.
- **Enable / disable toggle** for the Free Items feature, preserving its settings while off.

---

## [1.1.0] — 2026-06-09

### Added

- **Booth Free Items** tab — automatic scanning of Booth.pm for ¥0 VRChat items, including detection of partially-free items via per-variation price checks, price-range display, one-click download with remembered login session, and live "In Library" detection.

---

## [1.0.1] — 2026-06-07

### Added

- Two-zone **drag & drop** (Add New / Add to Existing) with card drop targets.
- **Download queue** with per-card progress bars and a footer indicator.
- **Tag system** with Booth JSON API integration and a searchable filter panel.
- Card **glow animation** on modification.
- **Pagination** (10 / 30 / 50 items per page).

---

## [1.0.0] — 2026-06-05

Initial release.

[1.4.0]: https://github.com/BunBnnuy/BBLM/releases/tag/v1.4.0
[1.3.0]: https://github.com/BunBnnuy/BBLM/releases/tag/v1.3.0
[1.2.2]: https://github.com/BunBnnuy/BBLM/releases/tag/v1.2.2
[1.2.1]: https://github.com/BunBnnuy/BBLM/releases/tag/v1.2.1
[1.2.0]: https://github.com/BunBnnuy/BBLM/releases/tag/v1.2.0
[1.1.0]: https://github.com/BunBnnuy/BBLM/releases/tag/v1.1.0
[1.0.1]: https://github.com/BunBnnuy/BBLM/releases/tag/1.0.1
[1.0.0]: https://github.com/BunBnnuy/BBLM/releases/tag/1.0.0
