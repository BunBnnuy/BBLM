// Web mode only. A browser cannot download from Booth: it has no Booth session
// and no access to the library folder. This bar sends the item link to the
// desktop app, which resolves the Booth download link and queues the file.
// The page follows the request state while it runs.
(function () {
  if (!window.__BBLM_WEB__) return;
  if (!window.api || typeof window.api.webDownload !== 'function') return;

  const bar = document.getElementById('web-send-bar');
  const input = document.getElementById('web-send-input');
  const button = document.getElementById('web-send-btn');
  const status = document.getElementById('web-send-status');
  if (!bar || !input || !button || !status) return;

  bar.style.display = 'flex';

  const POLL_MS = 1500;
  let pollTimer = null;

  function setStatus(text, kind) {
    status.textContent = text || '';
    status.className = 'web-send-status' + (kind ? ' ' + kind : '');
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function describe(request) {
    switch (request.state) {
      case 'resolving':
        return 'Reading the Booth page…';
      case 'queued':
        return request.parts > 1
          ? `Queued ${request.parts} files in the desktop app.`
          : 'Queued in the desktop app.';
      case 'downloading':
        return `Downloading… ${request.percent || 0}%`;
      case 'done':
        return 'Done. The asset is in your library.';
      case 'error':
        return request.error || 'The download failed.';
      default:
        return 'Waiting for the desktop app…';
    }
  }

  function kindOf(request) {
    if (request.state === 'error') return 'error';
    if (request.state === 'done') return 'done';
    return 'busy';
  }

  async function poll(requestId) {
    try {
      const data = await window.api.webDownloadStatus(requestId);
      const request = data && data.request;
      if (!request) return;
      setStatus(describe(request), kindOf(request));
      if (request.state === 'done') {
        stopPoll();
        button.disabled = false;
        // The new asset appears in the library once the desktop app finishes.
        if (typeof window.loadLibrary === 'function') window.loadLibrary();
      } else if (request.state === 'error') {
        stopPoll();
        button.disabled = false;
      }
    } catch (err) {
      stopPoll();
      button.disabled = false;
      setStatus(err.message, 'error');
    }
  }

  async function send() {
    const value = input.value.trim();
    if (!value) {
      setStatus('Paste a Booth item link first.', 'error');
      return;
    }

    button.disabled = true;
    setStatus('Sending to the desktop app…', 'busy');
    try {
      const result = await window.api.webDownload(value);
      const request = result && result.request;
      if (!request) throw new Error('The desktop app did not accept the link.');
      input.value = '';
      setStatus(describe(request), kindOf(request));
      stopPoll();
      pollTimer = setInterval(() => poll(request.id), POLL_MS);
      poll(request.id);
    } catch (err) {
      button.disabled = false;
      setStatus(err.message, 'error');
      if (err.tokenRequired && typeof window.api.requestUnlock === 'function') window.api.requestUnlock();
    }
  }

  button.addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });
})();
