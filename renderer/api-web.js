// BBLM web shim — only active when Electron preload did not create window.api.
// Electron keeps its IPC bridge. Browsers get a fetch-based bridge with the
// same method names so renderer/*.js keeps working.
(function () {
  if (window.api) return; // Electron mode — do nothing.

  window.__BBLM_WEB__ = true;

  // Shared token for internet use: open the UI as /?token=SECRET.
  // The token is sent back as a header and never stored.
  const WEB_TOKEN = (() => {
    try { return new URLSearchParams(window.location.search).get('token') || ''; }
    catch { return ''; }
  })();

  async function getJson(url) {
    const headers = { Accept: 'application/json' };
    if (WEB_TOKEN) headers['x-bblm-token'] = WEB_TOKEN;
    const res = await fetch(url, { headers });
    if (res.status === 401) throw new Error('Unauthorized: check the ?token= value.');
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ('Request failed: ' + url));
    return data;
  }

  async function sendJson(method, url, body) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (WEB_TOKEN) headers['x-bblm-token'] = WEB_TOKEN;
    const res = await fetch(url, { method, headers, body: JSON.stringify(body || {}) });
    if (res.status === 401) throw new Error('Unauthorized: check the ?token= value.');
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

  function withToken(url) {
    if (!WEB_TOKEN || !url || !url.startsWith('/api/')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(WEB_TOKEN);
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
      return false;
    }
  }

  window.api = {
    // Working in web mode step 1.
    getAssets: async () => {
      const assets = await getJson('/api/assets');
      if (!WEB_TOKEN || !Array.isArray(assets)) return assets;
      return assets.map((a) => (a && a.thumbnailUrl ? { ...a, thumbnailUrl: withToken(a.thumbnailUrl) } : a));
    },
    getConfig: () => getJson('/api/config'),
    getWebServerStatus: async () => ({
      enabled: true,
      running: true,
      port: Number(window.location.port) || 80,
      tokenConfigured: Boolean(WEB_TOKEN),
      urls: [window.location.origin + '/'],
      error: '',
    }),
    setWebServer: async () => window.api.getWebServerStatus(),
    openWebLibrary: async () => { window.location.reload(); return true; },

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
})();
