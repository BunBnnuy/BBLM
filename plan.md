# BBLM Security Remediation Plan

## Purpose

This plan fixes the security and reliability findings from the repository review. The phases define dependency gates. Workstreams inside the same wave can run in parallel when they follow the file ownership rules below.

This document is an implementation plan. It does not authorize a release or deployment.

## Current baseline

- Electron uses context isolation and disables Node.js integration.
- Local pages have a Content Security Policy.
- All project JavaScript files pass `node --check`.
- No automated test, lint, or CI scripts exist.
- The current dependency audit reports 8 production findings: 7 high and 1 moderate.
- The full dependency audit reports 32 findings, including build dependencies.
- The most urgent defects are custom-protocol path traversal, unconstrained recursive file operations, and unvalidated privileged IPC.

## Delivery rules

- Make small commits that contain one security control or one migration step.
- Do not combine dependency upgrades with behavior changes.
- Do not use `npm audit fix --force`.
- Do not remove or move a source file until the replacement operation commits successfully.
- Treat renderer values, metadata, database values, protocol parameters, filenames, URLs, and archive contents as untrusted.
- Add a failing regression test before each vulnerability fix when practical.
- Keep denied URLs, tokens, query strings, user paths, and page contents out of production logs.

## Parallel execution map

Use one Luna sub-agent per workstream. Each agent must edit only its owned files and must return a short handoff containing changed files, tests run, known limitations, and compatibility risks. Agents must not rewrite another agent's files to resolve conflicts; the integration agent resolves conflicts after the wave completes.

### Wave A — independent foundation work

These workstreams can start at the same time.

| Workstream | Agent scope | Owned files | Depends on | Handoff gate |
|---|---|---|---|---|
| A1. Baseline and dependency audit | Add scripts, lint rules, CI, and capture dependency findings. Do not upgrade runtime behavior. | `package.json`, `package-lock.json`, `eslint.config.js`, `.github/workflows/ci.yml` | None | `npm ci` works; audit output is recorded. |
| A2. Filesystem policy | Implement path validation, root containment, junction checks, filename rules, and asset-ID allocation. | `src/security/pathPolicy.js`, `test/pathPolicy.test.js` | None | Traversal and junction tests pass. |
| A3. Network and protocol policy | Implement HTTPS/private-address checks, redirect and byte limits, shared HTTP client, and strict protocol parsers. | `src/security/networkPolicy.js`, `src/httpClient.js`, `src/protocol.js`, `test/networkPolicy.test.js`, `test/protocol.test.js` | None | URL, redirect, and protocol tests pass. |
| A4. Atomic storage primitives | Implement atomic JSON writes, staging directories, transaction primitives, cleanup, and logger redaction. | `src/atomicFs.js`, `src/assetTransaction.js`, `src/logger.js`, `test/atomicFs.test.js`, `test/logger.test.js` | None | Failure-injection and redaction tests pass. |
| A5. Archive worker | Implement archive preflight, extraction limits, worker process, cancellation, and cleanup. Do not edit `main.js`. | `src/archiveScanner.js`, `src/scannerWorker.js`, `test/archiveScanner.test.js` | None | Bomb, traversal, timeout, and cancellation tests pass. |

### Wave B — feature migrations

Start these workstreams after the relevant Wave A handoffs are accepted. They can run in parallel with each other.

| Workstream | Agent scope | Owned files | Depends on | Handoff gate |
|---|---|---|---|---|
| B1. Asset-manager migration | Apply path policy, network client, atomic writes, collision handling, and rollback to asset imports and updates. | `src/assetManager.js`, `src/fileWatcher.js`, `test/assetManager.test.js` | A2, A3, A4 | Existing assets remain unchanged after injected failures. |
| B2. Main-process integration | Apply protocol parsing, secure downloads, path policy, transactions, worker scanner, pending import intents, and redacted logging. | `main.js` | A1, A2, A3, A4, A5 | Queue, scanner, protocol, and cancellation integration tests pass. |
| B3. Electron boundary | Add sender validation, window roles, sandbox settings, navigation and popup restrictions, Booth auth allowlists, and external URL validation. | `preload.js`, `preload-modal.js`, Electron window/IPC sections of `main.js` | A3 | Unauthorized sender and navigation tests pass. |
| B4. Renderer safety | Replace untrusted HTML construction, validate image URLs, remove unsafe handlers, and align CSP. | `renderer/*.js`, `renderer/*.html`, `renderer/styles.css` | A3, B3 API contract | Hostile DOM fixtures and visual smoke tests pass. |
| B5. Companion contract | Align the userscript with the canonical import-intent protocol and add expiry, matching, and compatibility behavior. | `companion/RSLimMan.user.js`, protocol documentation in `README.md`, `test/protocol.test.js` | A3 | Warm/cold launch and intent-matching tests pass. |

### Wave C — integration and release verification

These tasks must run after Waves A and B are merged into the working tree.

| Workstream | Agent scope | Owned files | Depends on | Handoff gate |
|---|---|---|---|---|
| C1. Cross-workstream tests | Add Electron smoke tests, renderer fixtures, scanner-worker integration tests, and regression tests for all findings. | `test/`, test fixtures, CI additions only | B1-B5 | Full test suite passes on Windows. |
| C2. Dependency remediation | Upgrade direct dependencies one at a time, refresh lockfile, classify remaining advisories, and verify packaged startup. | `package.json`, `package-lock.json`, `docs/security-audit.md` | A1, B1-B4 | No unexplained high or critical runtime advisory remains. |
| C3. Final security review | Review the merged diff for path escapes, IPC role gaps, unsafe URL flows, logging leaks, and unowned files. Do not make broad refactors. | Review only; edits require integration-agent approval | C1, C2 | Findings are closed or explicitly accepted. |

### Parallel merge protocol

1. The coordinator creates one branch or worktree per workstream when possible.
2. Agents first add or update tests for their owned behavior.
3. Agents implement only within their ownership boundaries.
4. The coordinator merges Wave A in this order: A2, A3, A4, A5, then A1.
5. The coordinator merges Wave B in this order: B1, B2, B3, B4, B5. `main.js` is the shared integration file; only the coordinator resolves conflicts there.
6. After each merge, run syntax checks and the workstream tests before starting the next merge.
7. C1-C3 run only after no unresolved merge conflict remains.

### Shared-file rule

`main.js`, `package.json`, `package-lock.json`, and `test/protocol.test.js` are shared-risk files. At most one agent may edit each of these files at a time. Other agents must return a patch proposal or helper module instead of editing the shared file.

## Phase 0: Establish the verification baseline

### Work

- Add Node.js and npm requirements to `package.json`. Verify the actual minimum version from all direct dependencies before selecting it.
- Add scripts for `test`, `lint`, `audit:prod`, and `check`.
- Add ESLint with rules that detect unsafe promises, unused code, and accidental global values.
- Add a Windows CI workflow that runs `npm ci`, lint, tests, the production audit, and a non-publishing build.
- Record the initial `npm audit`, `npm audit --omit=dev`, and `npm outdated` results in the implementation pull request.
- Add a small packaged-application startup smoke test.

### Files

- `package.json`
- `package-lock.json`
- `eslint.config.js`
- `.github/workflows/ci.yml`
- `test/`

### Completion gate

- A clean checkout can run `npm ci` and the baseline checks.
- CI reports current failures clearly before later phases change behavior.
- Build artifacts are not published by CI.

## Phase 1: Contain every filesystem path

### Work

Create `src/security/pathPolicy.js` with these responsibilities:

- `validateAssetId(value)` accepts only 1-120 ASCII characters from `[a-zA-Z0-9._-]`.
- Reject `.`, `..`, separators, absolute paths, drive and UNC paths, device paths, control characters, alternate data streams, reserved Windows names, and trailing dots or spaces.
- `resolveInsideRoot(root, ...segments)` uses `path.resolve()` and `path.relative()` to prove containment.
- Resolve and verify the real root. Recheck existing targets with `realpath` so junctions and symbolic links cannot escape the root.
- `resolveExistingAssetDir(root, assetId)` rejects asset directories that are links or junctions.
- `resolveAssetFile(root, assetId, relativeName)` permits a direct filename only.
- Validate metadata paths such as `meta.thumbnail` before use.

Apply the policy to:

- All functions in `src/assetManager.js` that read, write, move, open, or delete files.
- `DownloadQueue._run` in `main.js`.
- `add-file-to-asset`, `open-asset-folder`, `keep-free-item`, and all free-item metadata paths in `main.js`.
- `waitForFile` in `src/fileWatcher.js`.
- Scanner roots and temporary paths.

Add `allocateAssetId(root, candidate)`:

- Reserve internal names such as `.bblm-staging` and `_temp_downloads`.
- Return the candidate only when it is unused.
- Allocate deterministic suffixes such as `-2` and `-3` on collision.
- Never merge with or overwrite an existing asset implicitly.

### Tests

- Traversal with both separator types and mixed separators.
- Drive, UNC, device, alternate-data-stream, reserved, empty, and overlong names.
- Root prefix confusion such as `C:\lib` and `C:\library-evil`.
- Junction or symbolic-link escape.
- Malicious `meta.thumbnail` values.
- Valid direct-child paths.
- Concurrent same-origin imports receive different asset IDs.

### Completion gate

- No external asset ID, filename, or metadata-relative path reaches `path.join()` directly.
- No read, write, move, open, or recursive delete can escape the configured root.
- Existing assets cannot be overwritten by a new import unless an explicit validated update targets them.

## Phase 2: Replace custom-protocol parsing

### Work

Create `src/protocol.js` with a strict parser for each supported protocol contract.

For Booth and VRoid downloads:

- Limit the full URL to 8 KiB.
- Parse with `new URL()` and compare the exact normalized scheme.
- Require the expected action and parameters.
- Reject missing or duplicate security-sensitive parameters.
- Require a numeric, length-limited `item_id`.
- Parse `dlurl` as a second URL and require HTTPS.
- Reject credentials, control characters, malformed escapes, and unknown fields.
- Do not convert custom protocols to HTTPS with string replacement.

For filenames:

- Add `sanitizeExternalFilename()`.
- Reject separators, absolute paths, colons, device names, alternate data streams, control characters, trailing dots or spaces, and excessive length.
- Require a supported extension where the protocol supplies a download filename.
- Use the supplied name only as a display or final filename.
- Use a random ID and `.part` suffix for temporary storage.

Resolve the companion mismatch:

- Select one lowercase scheme, recommended as `bunslm://`.
- Update `main.js`, `companion/RSLimMan.user.js`, settings, and the README together.
- Define `bunslm://import` as an import-intent protocol, not a direct-download protocol.
- Store pending import intents for a short period and match them to completed downloads by safe filename.
- Handle duplicate filenames in FIFO order.
- Remove unused schemes, or keep a documented compatibility alias for one release only.

### Tests

- Unknown and mixed-case schemes.
- Missing, duplicate, unknown, or oversized parameters.
- HTTP download URLs, URL credentials, bad percent encoding, and control characters.
- Traversal filenames, unsupported extensions, and invalid item IDs.
- Warm and cold application launches.
- Matching, expired, duplicate, and nonmatching import intents.

### Completion gate

- Protocol input cannot select a filesystem path.
- Only valid HTTPS download URLs enter the queue.
- Warm and cold launches produce the same result.
- Full protocol URLs are never logged.

## Phase 3: Use one secure network client

### Work

Create `src/security/networkPolicy.js` and `src/httpClient.js`.

The shared client must:

- Accept HTTPS only for untrusted input.
- Reject URL credentials.
- Resolve all IPv4 and IPv6 addresses.
- Block loopback, private, link-local, unspecified, multicast, carrier-grade NAT, documentation, test, and IPv4-mapped private addresses.
- Bind the validated DNS result to the request lookup so DNS rebinding cannot change the destination after validation.
- Revalidate every redirect and limit redirects to five.
- Remove sensitive and origin-specific headers on cross-origin redirects.
- Enforce connect, header, idle, and total timeouts.
- Enforce byte limits while streaming, even when `Content-Length` is missing or false.
- Create partial files exclusively and delete them on all errors or cancellations.
- Stop error-page capture after a small fixed number of bytes.
- Validate response content types for HTML, images, and downloadable assets.

Initial named limits:

- HTML: 5 MiB and 30 seconds total.
- Thumbnail source: 20 MiB and 30 seconds total.
- Asset archive: 10 GiB by default, with connect and idle timeouts.
- Error snippet: 512 bytes.

Use exact host and path allowlists for Booth listing, API, and authenticated download operations. Use the public-HTTPS policy for general user-selected sites.

Migrate and then remove the duplicate request code in:

- `main.js` `downloadWithProgress`.
- `src/assetManager.js` `downloadFile`.
- `src/scraper.js` `fetchHtml`.
- `src/boothFreeScraper.js` `fetchHtml`.

### Tests

- Direct and redirected requests to loopback, private, link-local, and IPv4-mapped addresses.
- Public first hop that redirects to a private address.
- DNS result changes between validation and connection.
- Redirect loops and too many redirects.
- Oversized fixed and chunked responses.
- Stalled connection, stalled body, cancellation, and write failure.
- Removal of every partial file after failure.

### Completion gate

- Every untrusted network request uses the shared client.
- Every request has redirect, byte, and timeout limits.
- No failed request leaves a partial file.

## Phase 4: Harden Electron windows and IPC

### Work

Create central Electron security helpers in `src/security/electronPolicy.js`.

- Wrap every `ipcMain.handle` and `ipcMain.on` registration with sender validation.
- Check both the expected `webContents` instance and the exact canonical local page URL.
- Reject unexpected frames, subframes, destroyed windows, and null sender frames.
- Define a channel-to-window role matrix.
- Keep destructive, configuration, queue, scanner, and external-open APIs in the main role.
- Keep import and edit operations in the modal role.
- Mark shared operations explicitly.

Split the preload bridge:

- `preload-main.js` exposes only APIs needed by the main, settings, free-items, and scanner views.
- `preload-modal.js` exposes only APIs needed by the import/edit modal.
- Event subscription wrappers pass data only and return an unsubscribe function.
- Remove unused bridge methods and handlers after call-site verification.

Harden local windows:

- Explicitly enable `sandbox`, `contextIsolation`, and `webSecurity`.
- Explicitly disable Node.js integration, insecure content, and webviews.
- Permit only the exact index-to-settings navigation required by the main window.
- Deny all unexpected navigation and all new windows.
- Add an application-level deny-by-default guard for new web contents.

Harden the Booth authentication window:

- Validate the initial URL before window creation.
- Require exact HTTPS Booth hosts, expected paths, expected client parameter, bounded length, and no credentials.
- Give the remote window no preload.
- Sandbox it and deny popups and permission requests.
- Validate every navigation and redirect with parsed hosts and paths.
- Accept only exact expected custom-protocol callbacks.
- Record the real login chain before adding any additional exact hosts.

Restrict `open-external`:

- Require a validated sender.
- Permit absolute HTTPS URLs only.
- Reject credentials, control characters, excessive length, HTTP, `file:`, `javascript:`, and custom protocols.

### Tests

- IPC role matrix, exact local URLs, and subframe rejection.
- Remote navigation and popup denial.
- A remote page cannot invoke privileged IPC.
- Main and modal windows cannot invoke each other's restricted channels.
- Index/settings navigation, modal import/edit, and drag/drop still work with sandboxing.
- Booth host-confusion inputs such as `booth.pm.evil` and user-info forms.
- Unexpected Booth redirects, schemes, and popups fail closed.

### Completion gate

- Every IPC channel uses the central sender guard.
- Each local window has a least-privilege preload.
- No remote window has an application preload.
- All windows deny navigation and new windows except for documented exact cases.
- `shell.openExternal` receives validated HTTPS URLs only.

## Phase 5: Remove unsafe renderer HTML construction

### Work

- Replace data-bearing `innerHTML` templates with `createElement`, `textContent`, `replaceChildren`, `dataset`, and property assignment.
- Set image `src` properties only after URL validation.
- Replace inline `onerror` attributes with event listeners.
- Clamp progress values before using them in styles.
- Use `CSS.escape()` or a node map instead of interpolating asset IDs into selectors.
- Treat asset names, tags, dates, IDs, URLs, database values, archive names, and filenames as untrusted.

Migrate these files:

- `renderer/app.js`
- `renderer/freeItems.js`
- `renderer/modal.js`
- `renderer/scanner.js`
- `renderer/settings.js`

After DOM migration, use one consistent CSP:

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' file: data: https:; connect-src 'none'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'
```

- Remove `http:` from the modal image policy.
- Move inline styles to `renderer/styles.css`, then remove `'unsafe-inline'` from `style-src`.

### Tests

- Render hostile names, tags, URLs, image fields, archive paths, quotes, and markup.
- Confirm that hostile values create text only and do not create injected attributes or nodes.
- Confirm that no inline handler runs.
- Confirm that normal pages produce no CSP errors.
- Perform visual regression checks for grid, list, modal, settings, free items, and scanner views.

### Completion gate

- Untrusted values do not enter an HTML parser.
- No inline event handlers remain.
- Normal flows work with the final CSP.

## Phase 6: Make asset operations transactional

### Work

Create `src/atomicFs.js` and `src/assetTransaction.js`.

- Write JSON to a unique sibling temporary file with exclusive creation.
- Flush and close it, then replace `meta.json` atomically.
- Stage new imports under `<root>/.bblm-staging/<UUID>`.
- Copy source files into staging. Do not delete the source yet.
- Download and process thumbnails in staging.
- Write metadata in staging.
- Commit by renaming the complete staging directory to a uniquely reserved final directory.
- Remove the original source only after commit.
- On failure, remove only files created by that transaction.
- Clean old validated staging directories at startup.
- Process thumbnail updates to a new file and replace the old file only after Sharp succeeds.
- Give file collisions a deterministic new name such as `name (2).ext`.
- Ensure queue cancellation deletes only a shell created by that queue job.

Apply atomic metadata writes to all direct metadata changes in `main.js` and `src/assetManager.js`.

### Tests

- Inject failure at copy, thumbnail conversion, metadata write, rename, and source deletion.
- Cancel before and during download.
- Simulate restart with stale staging data.
- Verify that existing assets remain unchanged after every failed operation.
- Verify cross-volume imports and concurrent imports.

### Completion gate

- Failure or cancellation causes no source-data loss.
- A partial import never appears as a complete asset.
- Existing assets are not changed by a failed new import.
- No stale temporary file remains after recovery cleanup.

## Phase 7: Isolate and limit archive scanning

### Work

- Move policy and listing logic to `src/archiveScanner.js`.
- Move filesystem and 7-Zip work to `src/scannerWorker.js`.
- Run the worker with `child_process.fork()` and run 7-Zip with asynchronous `spawn()` and `windowsHide: true`.
- Track and terminate the worker and active 7-Zip process on cancellation.
- Preflight each archive with `7z l -slt`.
- Reject encrypted entries, traversal paths, absolute paths, drive/UNC/device paths, links, and reparse points.
- Recheck actual extracted files and byte totals after extraction.

Initial named limits:

- Nesting depth: 3.
- Entries per archive: 5,000.
- Expanded bytes per entry: 512 MiB.
- Expanded bytes per archive: 2 GiB.
- `pathname` file: 64 KiB.
- Time per archive: 60 seconds.
- Time per scan: 10 minutes.
- Top-level archives: 10,000.

### Tests

- Traversal archive entries.
- Excess nesting, entries, expanded bytes, and `pathname` size.
- Encrypted archives, links, timeout, cancellation, and cleanup.
- Cancellation completes within two seconds.

### Completion gate

- Archive processing never blocks the Electron main process.
- A scan cannot exceed the configured time, depth, count, or size limits.
- Cancellation terminates active work and removes temporary data.

## Phase 8: Upgrade and triage dependencies

### Work

- Upgrade `sharp` to 0.35.0 or newer first because remote image input reaches it.
- Upgrade other direct runtime packages one at a time.
- Upgrade Electron next and run the Electron smoke suite.
- Upgrade electron-builder last and verify the Windows installer.
- Regenerate the lockfile with a normal `npm install`.
- For every remaining advisory, record whether it is runtime or development only, its reachable code path, current mitigation, owner, and review date.

### Completion gate

- `npm ci` succeeds from a clean checkout.
- The production audit has no high or critical findings.
- The full audit has no unexplained high or critical findings.
- The application starts, imports an asset, scans a safe fixture, and builds an installer.

## Phase 9: Logging and privacy

### Work

Create `src/logger.js`.

- Production logs contain event IDs, status, and counts only.
- Debug details require explicit `BBLM_DEBUG=1`.
- Redact URL query, hash, credentials, tokens, and control characters.
- Reduce local paths to a basename or safe logical identifier.
- Do not log full protocol URLs, download URLs, Booth database rows, user paths, response bodies, or authentication redirects.
- Return a safe generic renderer error with a correlation ID.
- Do not persist logs by default.

### Tests

- Feed tokenized URLs, Windows user paths, credentials, queries, and control characters into every logger level.
- Confirm that captured production logs contain none of the sensitive input.

### Completion gate

- Normal logs contain no credentials, tokens, URL queries, user directories, database rows, or response bodies.
- Diagnostic failures can still be correlated without revealing private data.

## Final integration and release gate

Run these workflows on a clean Windows checkout:

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run audit:prod`
5. `npm run build -- --publish never`
6. Packaged application startup test
7. Manual import and edit
8. Cross-volume import
9. Downloads monitor and drag/drop
10. Booth and VRoid protocol handling
11. Booth sign-in and free-item download
12. Safe scanner fixture and cancellation
13. Hostile metadata and DOM regression fixtures

Release is permitted only when:

- All phase completion gates pass.
- No path operation can escape its approved root.
- No renderer or remote page can call an unauthorized IPC channel.
- All remote requests use the shared network policy.
- Failed imports, downloads, and scans leave no partial data.
- Production audit results contain no high or critical finding.
- Installer signing and update behavior are reviewed separately before public distribution.

## Suggested commit sequence

1. `test: add security regression baseline`
2. `security: add filesystem containment policy`
3. `security: validate protocol inputs and filenames`
4. `security: centralize network policy and request limits`
5. `security: validate IPC senders and harden windows`
6. `security: split least-privilege preload bridges`
7. `security: remove untrusted HTML construction`
8. `reliability: make asset imports transactional`
9. `security: isolate and limit archive scanning`
10. `build: update vulnerable dependencies`
11. `security: redact sensitive logs`
12. `test: add packaged security and compatibility gates`

## Compatibility risks to verify

- Sandbox behavior for drag/drop and `webUtils.getPathForFile`.
- Windows path case, junction, and canonical file URL handling.
- The current Booth authentication host and redirect chain.
- Old saved HTTP origin URLs after HTTPS-only external-link enforcement.
- Third-party thumbnail hosts after CSP and network policy changes.
- Visual layout after inline styles are moved to CSS.
- Cross-volume imports after transaction changes.
- Existing companion-script users during protocol migration.
