// BBLM web shim — only active when Electron preload did not create window.api.
// Electron keeps its IPC bridge. Browsers get a fetch-based bridge with the
// same method names so renderer/*.js keeps working.
(function () {
  if (window.api) return; // Electron mode — do nothing.

  window.__BBLM_WEB__ = true;

  // The library view is public. Downloads, settings and the other actions need
  // the access token. Open the page as /?token=SECRET once: the shim keeps the
  // token for this tab and sends it back as a header.
  const TOKEN_KEY = 'bblmWebToken';
  const URL_TOKEN = (() => {
    try { return new URLSearchParams(window.location.search).get('token') || ''; }
    catch { return ''; }
  })();
  const WEB_TOKEN = (() => {
    let stored = '';
    try { stored = sessionStorage.getItem(TOKEN_KEY) || ''; } catch { stored = ''; }
    const value = URL_TOKEN || stored;
    if (URL_TOKEN) {
      try { sessionStorage.setItem(TOKEN_KEY, URL_TOKEN); } catch { /* private mode */ }
      // Keep the token out of the address bar and the browser history.
      try { window.history.replaceState(null, '', window.location.pathname + window.location.hash); }
      catch { /* older browsers */ }
    }
    return value;
  })();

  // Set when /api/health says the server wants a token. Updated on load.
  let webTokenRequired = Boolean(WEB_TOKEN);

  function authHeaders(headers) {
    if (WEB_TOKEN) headers['x-bblm-token'] = WEB_TOKEN;
    return headers;
  }

  function unauthorizedError() {
    const err = new Error('Access token required. Click 🔒 Unlock in the top bar.');
    err.status = 401;
    err.tokenRequired = true;
    return err;
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: authHeaders({ Accept: 'application/json' }) });
    if (res.status === 401) throw unauthorizedError();
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ('Request failed: ' + url));
    return data;
  }

  async function sendJson(method, url, body) {
    const headers = authHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' });
    const res = await fetch(url, { method, headers, body: JSON.stringify(body || {}) });
    if (res.status === 401) throw unauthorizedError();
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ('Request failed: ' + url));
    return data;
  }

  // Free Items live updates: the server keeps an event queue per scan.
  // The shim polls it and forwards to renderer subscribers.
  const fiProgressSubs = new Set();
  const fiFoundSubs = new Set();
  let fiPollTimer = null;
  let fiCursor = 0;

  async function pollFreeEvents() {
    try {
      const data = await getJson('/api/free-items/events?since=' + fiCursor);
      fiCursor = data.cursor;
      let finished = false;
      for (const e of data.events || []) {
        if (e.type === 'progress') {
          fiProgressSubs.forEach((cb) => { try { cb(e.data); } catch {} });
          if (e.data && (e.data.phase === 'done' || e.data.phase === 'error')) finished = true;
        } else if (e.type === 'found') {
          fiFoundSubs.forEach((cb) => { try { cb(e.data); } catch {} });
        }
      }
      if (finished || !data.running) stopFreePoll();
    } catch {
      // Server away — retry on next tick.
    }
  }

  function startFreePoll() {
    if (fiPollTimer) return;
    // Skip replay of old scans: start from the current cursor.
    getJson('/api/free-items/events?since=9007199254740991')
      .then((data) => { fiCursor = data.cursor; })
      .catch(() => {})
      .finally(() => {
        if (!fiPollTimer) fiPollTimer = setInterval(pollFreeEvents, 2000);
      });
  }

  function stopFreePoll() {
    if (fiPollTimer) { clearInterval(fiPollTimer); fiPollTimer = null; }
  }

  const noopSubscribe = () => () => {};
  const emptyList = async () => [];
  const emptyObj = async () => ({});
  const okFalse = async () => ({ ok: false, error: 'not-available-in-web' });

  // ── Access token UI ─────────────────────────────────────────────────────────
  // The library page loads without a token. When the user presses Download or
  // opens Settings, the server answers 401 and this dialog asks for the token.
  let unlockOverlay = null;
  let unlockError = null;
  let unlockButton = null;

  function setUnlockButtonLabel() {
    if (!unlockButton) return;
    const unlocked = Boolean(WEB_TOKEN);
    unlockButton.textContent = unlocked ? '🔓 Unlocked' : '🔒 Unlock';
    unlockButton.title = unlocked
      ? 'This tab uses the access token. Open the dialog to lock it again.'
      : 'Enter the access token to download, change settings, or use Free Items.';
  }

  function closeUnlockDialog() {
    if (unlockOverlay) unlockOverlay.style.display = 'none';
  }

  function openUnlockDialog() {
    if (!unlockOverlay) buildUnlockDialog();
    if (!unlockOverlay) return false;
    if (unlockError) unlockError.textContent = '';
    unlockOverlay.style.display = 'flex';
    const input = document.getElementById('web-lock-input');
    if (input) { input.value = ''; input.focus(); }
    return true;
  }

  async function tryToken(value) {
    const res = await fetch('/api/config', {
      headers: { Accept: 'application/json', 'x-bblm-token': value },
    });
    if (res.status === 401) return false;
    return res.ok;
  }

  async function submitUnlock(input) {
    const value = input.value.trim();
    if (!value) { unlockError.textContent = 'Enter the access token.'; return; }
    unlockError.textContent = 'Checking…';
    let ok = false;
    try { ok = await tryToken(value); } catch { ok = false; }
    if (!ok) {
      unlockError.textContent = 'That token is not correct. Read it in Settings → Integrations → Remote Access.';
      return;
    }
    saveTokenAndReload(value);
  }

  // Keeps the token for this tab, then reloads without ?token= in the address so
  // a stale value in the address bar cannot win over the saved one.
  function saveTokenAndReload(token) {
    if (token) {
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
    }
    let clean = '/';
    try { clean = window.location.pathname || '/'; } catch { clean = '/'; }
    window.location.replace(clean);
  }

  function buildUnlockDialog() {
    if (!document.body) return;
    const overlay = document.createElement('div');
    overlay.className = 'web-lock-overlay';
    overlay.id = 'web-lock-overlay';
    overlay.style.display = 'none';

    const modal = document.createElement('form');
    modal.className = 'web-lock-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'web-lock-title');

    const title = document.createElement('h2');
    title.id = 'web-lock-title';
    title.textContent = 'Unlock the web library';
    modal.appendChild(title);

    const text = document.createElement('p');
    text.textContent = 'The library view is open. Downloads, settings and the other actions need the access token from the desktop app.';
    modal.appendChild(text);

    const label = document.createElement('label');
    label.htmlFor = 'web-lock-input';
    label.textContent = 'Access token';
    modal.appendChild(label);

    const input = document.createElement('input');
    input.type = 'password';
    input.id = 'web-lock-input';
    input.autocomplete = 'current-password';
    input.placeholder = 'Access token';
    modal.appendChild(input);

    const error = document.createElement('p');
    error.className = 'web-lock-error';
    error.id = 'web-lock-error';
    modal.appendChild(error);
    unlockError = error;

    const actions = document.createElement('div');
    actions.className = 'web-lock-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeUnlockDialog);
    actions.appendChild(cancel);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn-primary';
    submit.textContent = 'Unlock';
    actions.appendChild(submit);
    modal.appendChild(actions);

    if (WEB_TOKEN) {
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.className = 'btn-ghost web-lock-forget';
      forget.textContent = 'Lock this tab again';
      forget.addEventListener('click', () => {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
        let clean = '/';
        try { clean = window.location.pathname || '/'; } catch { clean = '/'; }
        window.location.replace(clean);
      });
      modal.appendChild(forget);
    }

    modal.addEventListener('submit', (event) => { event.preventDefault(); submitUnlock(input); });
    overlay.appendChild(modal);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeUnlockDialog(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.style.display !== 'none') closeUnlockDialog();
    });
    document.body.appendChild(overlay);
    unlockOverlay = overlay;
  }

  function addUnlockButton() {
    if (unlockButton) return;
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const button = document.createElement('button');
    button.className = 'btn-ghost';
    button.id = 'btn-web-unlock';
    button.addEventListener('click', () => openUnlockDialog());
    topbar.insertBefore(button, topbar.querySelector('#btn-settings'));
    unlockButton = button;
    setUnlockButtonLabel();
  }

  async function initWebLock() {
    let tokenRequired = false;
    try {
      const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      const data = await res.json();
      tokenRequired = Boolean(data && data.tokenRequired);
    } catch { tokenRequired = Boolean(WEB_TOKEN); }
    webTokenRequired = tokenRequired;
    if (!tokenRequired) return;
    if (WEB_TOKEN) {
      // A stored or pasted token can be stale. Drop it once so every request
      // starts clean and the Unlock button shows the truth.
      let ok = false;
      try { ok = await tryToken(WEB_TOKEN); } catch { ok = false; }
      if (!ok) {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
        let clean = '/';
        try { clean = window.location.pathname || '/'; } catch { clean = '/'; }
        window.location.replace(clean);
        return;
      }
    }
    addUnlockButton();
  }

  // Saves "marked safe" / "marked unsafe" for a scan alert. Returns false when
  // the server rejects the change so the caller can keep the alert open.
  async function markMalwareAck(assetId, markedSafe) {
    if (!assetId) return false;
    try {
      const data = await sendJson(
        'POST',
        '/api/assets/' + encodeURIComponent(assetId) + '/malware-acknowledge',
        { markedSafe: Boolean(markedSafe) }
      );
      return Boolean(data && data.ok);
    } catch (err) {
      console.warn('[web] malware acknowledgement failed:', err.message);
      // The answer changes the asset, so a locked page asks for the token.
      if (err.tokenRequired) openUnlockDialog();
      return false;
    }
  }

  window.api = {
    // Working in web mode step 1.
    getAssets: () => getJson('/api/assets'),
    getAssetScanOutput: (assetId) => getJson(`/api/assets/${encodeURIComponent(assetId)}/scan-output`),
    getConfig: () => getJson('/api/config'),
    getWebServerStatus: async () => ({
      enabled: true,
      running: true,
      port: Number(window.location.port) || 80,
      tokenConfigured: webTokenRequired,
      urls: [window.location.origin + '/'],
      error: '',
    }),
    setWebServer: async () => window.api.getWebServerStatus(),
    openWebLibrary: async () => { window.location.reload(); return true; },

    // Access token for downloads, settings and the other actions.
    hasWebToken: () => Boolean(WEB_TOKEN),
    getWebToken: () => WEB_TOKEN,
    getWebLock: () => ({ tokenRequired: webTokenRequired, unlocked: Boolean(WEB_TOKEN) }),
    requestUnlock: () => openUnlockDialog(),

    // Safe stubs so the UI loads. Each becomes real in a later step.
    getBoothItems: emptyList,
    getHiddenAssets: emptyList,
    getAllTags: emptyList,
    getQueue: async () => ({ active: null, pending: [] }),
    getFoundFreeItems: () => getJson('/api/free-items/found'),
    getDownloadedFreeItems: () => getJson('/api/free-items/downloaded'),
    getLibraryItemIds: () => getJson('/api/free-items/library-ids'),
    getTranslationStatus: async () => ({ running: false }),
    getReleaseNotes: async () => ({ notes: '', isNew: false }),
    getFreeItemsConfig: () => getJson('/api/free-items/config'),
    getSchemeStatus: emptyObj,
    scannerGetResults: emptyList,
    scannerGetFolder: async () => '',
    originFinderState: emptyObj,
    getUnityProjects: emptyList,
    getUnityImportEntries: emptyList,
    getAllTags2: emptyList,

    setConfig: emptyObj,
    setFreeItemsConfig: async (config) => { await sendJson('PUT', '/api/free-items/config', config); return true; },
    setMonitor: async () => false,
    setScheme: async () => false,
    acknowledgeReleaseNotes: async () => true,
    pickFolder: async () => null,
    pickFiles: async () => null,
    importAsset: okFalse,
    updateAsset: okFalse,
    deleteAsset: okFalse,
    hideAsset: async () => false,
    unhideAsset: async () => false,
    openAssetFolder: async () => false,
    openBoothFolder: async () => false,
    openExternal: (url) => { try { window.open(url, '_blank', 'noopener'); } catch {} return Promise.resolve(true); },
    openEditModal: async () => false,
    openImportModal: async () => false,
    addFileToAsset: okFalse,
    setWindowTitle: async () => false,
    setAssetTags: okFalse,
    closeModal: () => {},
    refreshLibrary: () => {},
    copyToClipboard: async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } },
    scrapeImages: emptyList,
    waitForFile: okFalse,
    createShowcaseSnapshot: okFalse,
    publishShowcase: okFalse,
    malwareScanNow: okFalse,
    malwareScanAll: okFalse,
    // Scan popup answers persist to the asset's meta.json like the desktop app
    // does, so a marked item does not ask again on the next page load.
    malwareMarkSafe: (assetId) => markMalwareAck(assetId, true),
    malwareMarkUnsafe: (assetId) => markMalwareAck(assetId, false),
    scannerScan: okFalse,
    scannerCancel: async () => false,
    scannerImportAsset: okFalse,
    scannerSaveResults: async () => false,
    scannerClearResults: async () => false,
    originFinderStart: emptyObj,
    originFinderSearchOne: emptyObj,
    originFinderPause: emptyObj,
    startFreeScan: async () => { await sendJson('POST', '/api/free-items/scan', {}); startFreePoll(); return true; },
    stopFreeScan: async () => { try { await sendJson('POST', '/api/free-items/stop', {}); } catch {} stopFreePoll(); return true; },
    downloadFreeItem: (deeplinkUrl) => sendJson('POST', '/api/free-items/download', { url: deeplinkUrl }),
    // Booth item link → the desktop app resolves and downloads it.
    webDownload: (url) => sendJson('POST', '/api/download', { url }),
    webDownloadStatus: (id) => getJson('/api/download/status' + (id ? '?id=' + encodeURIComponent(id) : '')),
    keepFreeItem: async () => false,
    deleteFreeItem: async () => false,
    getUnityProjects2: emptyList,
    focusUnityProject: async () => false,
    importToUnity: okFalse,
    revealUnityCompanion: async () => false,
    cancelQueueItem: async () => false,

    // Event subscriptions — no live push yet. Return unsubscribe fn.
    onImportData: noopSubscribe,
    onModalFileDetected: noopSubscribe,
    onRefreshLibrary: noopSubscribe,
    onTranslationStatus: noopSubscribe,
    onTitleTranslated: noopSubscribe,
    onDownloadProgress: noopSubscribe,
    onAssetDownloadProgress: noopSubscribe,
    onQueueUpdate: noopSubscribe,
    onFreeItemsProgress: (cb) => { fiProgressSubs.add(cb); return () => { fiProgressSubs.delete(cb); }; },
    onFreeItemDownloaded: noopSubscribe,
    onFreeItemFound: (cb) => { fiFoundSubs.add(cb); return () => { fiFoundSubs.delete(cb); }; },
    onScannerProgress: noopSubscribe,
    onOriginFinderUpdate: noopSubscribe,
    onMalwareScanProgress: noopSubscribe,
    onMalwareScanFlagged: noopSubscribe,
  };

  // Ask the server whether it wants a token, then show the top-bar button.
  initWebLock();
})();
