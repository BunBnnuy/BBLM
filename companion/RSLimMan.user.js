// ==UserScript==
// @name         RSLimMan Companion
// @namespace    https://github.com/rslimman
// @version      1.0.0
// @description  Detects asset downloads on watched domains and triggers RSLimMan
// @author       RSLimMan
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Watched domains (kept in sync with app settings via GM storage) ──
  // Default list — the app writes to GM storage when you save settings.
  // You can also edit this array directly as a fallback.
  const DEFAULT_DOMAINS = [
    'fab.com',
    'gumroad.com',
    'artstation.com',
    'itch.io',
    'cgtrader.com',
    'turbosquid.com',
    'booth.pm',
  ];

  function getWatchedDomains() {
    const stored = GM_getValue('watchedDomains', null);
    if (stored) {
      try { return JSON.parse(stored); } catch {}
    }
    return DEFAULT_DOMAINS;
  }

  function currentDomainMatches() {
    const host = location.hostname.replace(/^www\./, '');
    return getWatchedDomains().some(d => host === d || host.endsWith('.' + d));
  }

  if (!currentDomainMatches()) return;

  // ── Intercept fetch/XHR to detect when the download response finishes ──
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : String(args[0]));
    const response = await _fetch.apply(this, args);

    const contentDisposition = response.headers.get('content-disposition') || '';
    const contentType = response.headers.get('content-type') || '';
    const isFileDownload = contentDisposition.includes('attachment') ||
      /\.(zip|rar|7z|tar|gz|blend|fbx|obj|unitypackage|uasset|mb|ma|max|stl|gltf|glb|usd|abc|pdf|exe|msi)(\?|$)/i.test(url);

    if (isFileDownload) {
      console.log('[RSLimMan] Download started (fetch):', url);
      const clone = response.clone();
      clone.blob().then(() => {
        console.log('[RSLimMan] Download finished (fetch):', url);
      }).catch((err) => {
        console.warn('[RSLimMan] Download fetch stream error:', err);
      });
    }

    return response;
  };

  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._rslimman_url = url;
    return _xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const url = this._rslimman_url || '';
    const isFileDownload = /\.(zip|rar|7z|tar|gz|blend|fbx|obj|unitypackage|uasset|mb|ma|max|stl|gltf|glb|usd|abc|pdf|exe|msi)(\?|$)/i.test(url);
    if (isFileDownload) {
      console.log('[RSLimMan] Download started (XHR):', url);
      this.addEventListener('load', () => {
        const cd = this.getResponseHeader('content-disposition') || '';
        if (isFileDownload || cd.includes('attachment')) {
          console.log('[RSLimMan] Download finished (XHR):', url);
        }
      });
    }
    return _xhrSend.apply(this, args);
  };

  // ── Intercept clicks on download/purchase links ──
  function buildProtocolUrl(originUrl, fileName) {
    const params = new URLSearchParams({ originUrl, file: fileName });
    return 'rslimman://import?' + params.toString();
  }

  function guessFileName(href) {
    try {
      const url = new URL(href, location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      if (last.includes('.')) return decodeURIComponent(last);
    } catch {}
    return '';
  }

  function isDownloadLink(el) {
    if (el.tagName !== 'A') return false;
    const href = el.href || '';
    const download = el.hasAttribute('download');
    const rel = (el.rel || '').toLowerCase();

    if (download) return true;

    // Common patterns: direct file URLs or download endpoints
    const fileExt = /\.(zip|rar|7z|tar|gz|blend|fbx|obj|unitypackage|uasset|mb|ma|max|stl|gltf|glb|usd|abc|pdf|exe|msi)(\?|$)/i;
    if (fileExt.test(href)) return true;

    // Download keyword in URL path
    if (/\/download(s)?\//i.test(href)) return true;

    return false;
  }

  function triggerImport(originUrl, fileName) {
    const protocolUrl = buildProtocolUrl(originUrl, fileName);
    console.log('[RSLimMan] Triggering import:', protocolUrl);

    // Create a hidden anchor and click it to invoke the protocol
    const a = document.createElement('a');
    a.href = protocolUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    GM_notification({
      title: 'RSLimMan',
      text: 'Opening import dialog for: ' + (fileName || 'unknown file'),
      timeout: 3000,
    });
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link || !isDownloadLink(link)) return;

    const downloadUrl = link.href;
    const fileName = guessFileName(downloadUrl);
    const originUrl = location.href;

    console.log('[RSLimMan] Download link clicked:', downloadUrl);

    // Small delay so the browser starts the download first
    setTimeout(() => triggerImport(originUrl, fileName), 500);
  }, true);

  // ── Also watch for dynamically injected download buttons ──
  const observer = new MutationObserver(() => {
    // Nothing to do proactively — click handler covers dynamic elements
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
