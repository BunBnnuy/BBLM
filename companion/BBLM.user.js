// ==UserScript==
// @name         BB's LibMan Companion
// @namespace    https://github.com/BunBnnuy/BBLM
// @version      1.0.0
// @description  Send free BOOTH items to BB's LibMan
// @author       BB's LibMan
// @match        https://booth.pm/*
// @match        https://*.booth.pm/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'bblm-free-download-button';
  const STYLE_ID = 'bblm-free-download-style';
  const SCHEME_CLIENT = 'client=booth-library-manager';

  function normalizeDeeplink(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value, window.location.href);
      if (url.protocol !== 'https:') return '';
      if (url.hostname !== 'booth.pm' && !url.hostname.endsWith('.booth.pm')) return '';
      if (!url.pathname.includes('/deeplink')) return '';
      if (!url.search.includes(SCHEME_CLIENT)) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function findFreeDeeplinks() {
    const urls = [];
    const add = (value) => {
      const url = normalizeDeeplink(value);
      if (url && !urls.includes(url)) urls.push(url);
    };

    for (const element of document.querySelectorAll('[data-dropdown-items]')) {
      let entries;
      try {
        entries = JSON.parse(element.getAttribute('data-dropdown-items') || '[]');
      } catch {
        continue;
      }
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry) continue;
        add(entry.deeplinkDownloadableUrl);
        add(entry.deeplinkUrl);
      }
    }

    return urls;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483000;
        max-width: min(360px, calc(100vw - 40px));
        padding: 12px 18px;
        border: 0;
        border-radius: 999px;
        background: #e8467c;
        color: #fff;
        font: 600 14px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
      }
      #${BUTTON_ID}:hover:not(:disabled) { filter: brightness(1.08); }
      #${BUTTON_ID}:disabled { opacity: .7; cursor: default; }
    `;
    document.head.appendChild(style);
  }

  function mountButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const deeplinks = findFreeDeeplinks();
    if (deeplinks.length === 0) return;

    addStyles();
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = "Download with BB's LibMan";
    button.title = "Send this free item to BB's LibMan";
    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "Opening BB's LibMan...";
      window.location.href = deeplinks[0];
      setTimeout(() => {
        if (!document.contains(button)) return;
        button.disabled = false;
        button.textContent = "Download with BB's LibMan";
      }, 8000);
    });
    document.body.appendChild(button);
  }

  let mountTimer = null;
  function scheduleMount() {
    if (mountTimer) return;
    mountTimer = setTimeout(() => {
      mountTimer = null;
      mountButton();
    }, 200);
  }

  scheduleMount();
  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
