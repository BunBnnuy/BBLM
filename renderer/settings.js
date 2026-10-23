const rootInput = document.getElementById('root-folder');
const translatedTitlesToggle = document.getElementById('translated-titles-toggle');
translatedTitlesToggle.addEventListener('click', () => {
  setSchemeToggle(translatedTitlesToggle, translatedTitlesToggle.getAttribute('aria-checked') !== 'true');
});
const downloadsInput = document.getElementById('downloads-folder');
const saveStatus = document.getElementById('save-status');
const monitorToggle = document.getElementById('monitor-toggle');
const boothToggle = document.getElementById('booth-toggle');
const boothFolderField = document.getElementById('booth-folder-field');
const boothDownloadsInput = document.getElementById('booth-downloads-folder');
const notificationsToggle = document.getElementById('notifications-toggle');
const healthNotifyToggle = document.getElementById('health-notify-toggle');
const schemeBoothToggle = document.getElementById('scheme-booth-toggle');
const schemeBunsToggle = document.getElementById('scheme-buns-toggle');
const schemeVroidToggle = document.getElementById('scheme-vroid-toggle');
const malwareScanToggle = document.getElementById('malware-scan-toggle');
const malwareBacklogToggle = document.getElementById('malware-backlog-toggle');
const malwareScannerStatus = document.getElementById('malware-scanner-status');
const showcasePublishUrl = document.getElementById('showcase-publish-url');
const showcasePublishToken = document.getElementById('showcase-publish-token');
const showcaseStatus = document.getElementById('showcase-status');
const webServerToggle = document.getElementById('web-server-toggle');
const webServerPort = document.getElementById('web-server-port');
const webServerToken = document.getElementById('web-server-token');
const webServerStatus = document.getElementById('web-server-status');
const clearWebTokenButton = document.getElementById('btn-clear-web-token');
const openWebLibraryButton = document.getElementById('btn-open-web-library');
const settingsTabs = Array.from(document.querySelectorAll('.settings-tab'));

function selectSettingsTab(tab) {
  settingsTabs.forEach(candidate => {
    const selected = candidate === tab;
    candidate.classList.toggle('active', selected);
    candidate.setAttribute('aria-selected', String(selected));
    candidate.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(candidate.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
  });
  document.querySelector('.settings-content').scrollTop = 0;
}

settingsTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectSettingsTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % settingsTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = settingsTabs.length - 1;
    selectSettingsTab(settingsTabs[nextIndex]);
    settingsTabs[nextIndex].focus();
  });
});

function setToggleState(enabled) {
  monitorToggle.textContent = enabled ? 'On' : 'Off';
  monitorToggle.setAttribute('aria-checked', String(enabled));
  monitorToggle.classList.toggle('btn-primary', enabled);
  monitorToggle.classList.toggle('btn-ghost', !enabled);
}

function setNotificationsToggle(enabled) {
  notificationsToggle.textContent = enabled ? 'On' : 'Off';
  notificationsToggle.setAttribute('aria-checked', String(enabled));
  notificationsToggle.classList.toggle('btn-primary', enabled);
  notificationsToggle.classList.toggle('btn-ghost', !enabled);
}

function setHealthNotifyToggle(enabled) {
  healthNotifyToggle.textContent = enabled ? 'On' : 'Off';
  healthNotifyToggle.setAttribute('aria-checked', String(enabled));
  healthNotifyToggle.classList.toggle('btn-primary', enabled);
  healthNotifyToggle.classList.toggle('btn-ghost', !enabled);
}

function setSchemeToggle(btn, enabled) {
  btn.textContent = enabled ? 'On' : 'Off';
  btn.setAttribute('aria-checked', String(enabled));
  btn.classList.toggle('btn-primary', enabled);
  btn.classList.toggle('btn-ghost', !enabled);
}

function setMalwareScanToggle(enabled) {
  malwareScanToggle.textContent = enabled ? 'On' : 'Off';
  malwareScanToggle.setAttribute('aria-checked', String(enabled));
  malwareScanToggle.classList.toggle('btn-primary', enabled);
  malwareScanToggle.classList.toggle('btn-ghost', !enabled);
}

function setMalwareBacklogToggle(enabled) {
  malwareBacklogToggle.textContent = enabled ? 'On' : 'Off';
  malwareBacklogToggle.setAttribute('aria-checked', String(enabled));
  malwareBacklogToggle.classList.toggle('btn-primary', enabled);
  malwareBacklogToggle.classList.toggle('btn-ghost', !enabled);
}

function setBoothToggleState(enabled) {
  boothToggle.textContent = enabled ? 'On' : 'Off';
  boothToggle.setAttribute('aria-checked', String(enabled));
  boothToggle.classList.toggle('btn-primary', enabled);
  boothToggle.classList.toggle('btn-ghost', !enabled);
  boothFolderField.style.display = enabled ? 'block' : 'none';
}

function readWebServerPort() {
  const port = Number(webServerPort.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function renderWebServerStatus(status) {
  setSchemeToggle(webServerToggle, status.enabled === true);
  openWebLibraryButton.disabled = status.running !== true;
  if (status.running) {
    const urls = (status.urls || []).join('   •   ');
    webServerStatus.textContent = status.tokenConfigured
      ? `Running: ${urls} — add ?token=… to the address.`
      : `Running: ${urls}`;
    webServerStatus.style.color = '';
  } else if (status.error) {
    webServerStatus.textContent = status.error;
    webServerStatus.style.color = 'var(--accent)';
  } else {
    webServerStatus.textContent = 'Server is off.';
    webServerStatus.style.color = '';
  }
}

// Remote access is owned by the desktop app, so browsers only show its state.
function applyWebModeLock() {
  if (!window.__BBLM_WEB__) return;
  webServerStatus.textContent = 'Managed by the desktop app. Remote access cannot be changed from the browser.';
  webServerStatus.style.color = '';
  webServerToggle.disabled = true;
  webServerPort.disabled = true;
  webServerToken.disabled = true;
  clearWebTokenButton.disabled = true;
  openWebLibraryButton.disabled = true;
}


notificationsToggle.addEventListener('click', () => {
  const next = notificationsToggle.getAttribute('aria-checked') !== 'true';
  setNotificationsToggle(next);
});

healthNotifyToggle.addEventListener('click', () => {
  const next = healthNotifyToggle.getAttribute('aria-checked') !== 'true';
  setHealthNotifyToggle(next);
});

malwareScanToggle.addEventListener('click', () => {
  const current = malwareScanToggle.getAttribute('aria-checked') === 'true';
  setMalwareScanToggle(!current);
});

malwareBacklogToggle.addEventListener('click', () => {
  const current = malwareBacklogToggle.getAttribute('aria-checked') === 'true';
  setMalwareBacklogToggle(!current);
});

document.getElementById('btn-malware-scan-all').addEventListener('click', async () => {
  const statusEl = document.getElementById('malware-scan-all-status');
  const result = await window.api.malwareScanAll();
  if (result.ok) {
    statusEl.textContent = `Queued ${result.queued} asset${result.queued === 1 ? '' : 's'} — scanning one at a time in the background.`;
  } else if (result.error === 'not-available') {
    statusEl.textContent = 'The malware scanner hasn\'t finished downloading yet. Try again in a moment.';
  } else if (result.error === 'no-files') {
    statusEl.textContent = 'Nothing scannable in your library yet.';
  } else {
    statusEl.textContent = 'Could not start scanning.';
  }
});

document.getElementById('scanner-attribution-link').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal('https://github.com/vicentefelipechile/vrchat-scanner');
});

monitorToggle.addEventListener('click', async () => {
  const current = monitorToggle.getAttribute('aria-checked') === 'true';
  const next = !current;
  await window.api.setMonitor(next);
  setToggleState(next);
});

boothToggle.addEventListener('click', () => {
  const current = boothToggle.getAttribute('aria-checked') === 'true';
  setBoothToggleState(!current);
});

schemeBoothToggle.addEventListener('click', async () => {
  const current = schemeBoothToggle.getAttribute('aria-checked') === 'true';
  const next = !current;
  await window.api.setScheme('booth-library-manager', next);
  setSchemeToggle(schemeBoothToggle, next);
});

schemeBunsToggle.addEventListener('click', async () => {
  const current = schemeBunsToggle.getAttribute('aria-checked') === 'true';
  const next = !current;
  await window.api.setScheme('BunsLM', next);
  setSchemeToggle(schemeBunsToggle, next);
});

schemeVroidToggle.addEventListener('click', async () => {
  const current = schemeVroidToggle.getAttribute('aria-checked') === 'true';
  const next = !current;
  await window.api.setScheme('vroid.closet', next);
  setSchemeToggle(schemeVroidToggle, next);
});

webServerToggle.addEventListener('click', async () => {
  const enable = webServerToggle.getAttribute('aria-checked') !== 'true';
  const port = readWebServerPort();
  if (port === null) {
    webServerStatus.textContent = 'Enter a port between 1 and 65535.';
    webServerStatus.style.color = 'var(--accent)';
    return;
  }
  webServerToggle.disabled = true;
  webServerStatus.style.color = '';
  webServerStatus.textContent = enable ? 'Starting…' : 'Stopping…';
  try {
    const status = await window.api.setWebServer({ enabled: enable, port });
    webServerPort.value = String(status.port);
    renderWebServerStatus(status);
  } catch (error) {
    webServerStatus.textContent = `Could not change the server: ${error.message}`;
    webServerStatus.style.color = 'var(--accent)';
  } finally {
    webServerToggle.disabled = false;
  }
});

clearWebTokenButton.addEventListener('click', async () => {
  const status = await window.api.setWebServer({ token: '' });
  webServerToken.value = '';
  webServerToken.placeholder = status.tokenConfigured
    ? 'Access token is configured — leave blank to keep it'
    : 'No access token';
  clearWebTokenButton.disabled = !status.tokenConfigured;
  renderWebServerStatus(status);
});

openWebLibraryButton.addEventListener('click', () => {
  window.api.openWebLibrary();
});

async function loadHiddenAssets() {
  const hiddenList = document.getElementById('hidden-list');
  const hiddenEmpty = document.getElementById('hidden-empty');
  const assets = await window.api.getHiddenAssets();

  // Remove all except the empty placeholder
  Array.from(hiddenList.querySelectorAll('.hidden-row')).forEach(el => el.remove());

  if (assets.length === 0) {
    hiddenEmpty.style.display = '';
    return;
  }
  hiddenEmpty.style.display = 'none';

  for (const asset of assets) {
    const row = document.createElement('div');
    row.className = 'hidden-row';
    row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px 8px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);';

    const thumbSrc = asset.thumbnailUrl
      ? safeImageUrl(asset.thumbnailUrl)
      : asset.thumbnailPath
        ? safeImageUrl(asset.thumbnailPath, true)
        : null;
    const thumb = thumbSrc
      ? `<img src="${escHtml(thumbSrc)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0;" onerror="this.style.display='none'" />`
      : `<div style="width:36px;height:36px;background:var(--surface2);border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;">📦</div>`;
    const sourceBadge = asset.source === 'booth'
      ? `<img src="../assets/booth.png" style="width:16px;height:16px;object-fit:contain;flex-shrink:0;" title="Booth" />`
      : '';

    row.innerHTML = `${thumb}
      <span style="flex:1; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(asset.name)}</span>
      ${sourceBadge}
      <button class="btn-secondary" style="font-size:11px; padding:4px 10px; flex-shrink:0;">Unhide</button>`;

    row.querySelector('button').addEventListener('click', async () => {
      await window.api.unhideAsset(asset.id);
      loadHiddenAssets();
    });

    hiddenList.appendChild(row);
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeImageUrl(value, local = false) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  if (local) return value ? `file://${value.replace(/\\/g, '/')}` : '';
  try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; }
}

async function load() {
  const config = await window.api.getConfig();
  setSchemeToggle(translatedTitlesToggle, config.translatedTitlesEnabled === true);
  document.getElementById('app-version').textContent = `Version ${config.appVersion || ''}`.trim();
  rootInput.value = config.rootFolder || '';
  downloadsInput.value = config.downloadsFolder || '';
  setNotificationsToggle(config.notificationsEnabled !== false);
  setHealthNotifyToggle(config.libraryHealthNotify || false);
  setToggleState(config.monitorEnabled || false);
  setBoothToggleState(config.boothEnabled || false);
  boothDownloadsInput.value = config.boothDownloadsFolder || '';
  setMalwareScanToggle(config.malwareScanEnabled !== false);
  setMalwareBacklogToggle(config.malwareBacklogScanEnabled !== false);
  showcasePublishUrl.value = config.showcasePublishUrl || '';
  showcasePublishToken.placeholder = config.showcaseTokenConfigured
    ? 'Publishing token is configured — leave blank to keep it'
    : 'Enter the private publishing token';
  showcaseStatus.textContent = config.showcaseLastPublishedAt
    ? `Last published ${new Date(config.showcaseLastPublishedAt).toLocaleString()}`
    : 'No snapshot has been published from this app yet.';
  if (config.malwareScannerAvailable) {
    malwareScannerStatus.value = `vrchat-scanner ${config.malwareScannerVersion || ''} — ${config.malwareScannerPath || ''}`.trim();
  } else {
    malwareScannerStatus.value = 'Not installed yet — will download automatically on next launch with internet access.';
  }

  const schemes = await window.api.getSchemeStatus();
  setSchemeToggle(schemeBoothToggle, schemes['booth-library-manager'] || false);
  setSchemeToggle(schemeBunsToggle, schemes['BunsLM'] || false);
  setSchemeToggle(schemeVroidToggle, schemes['vroid.closet'] || false);

  const webStatus = await window.api.getWebServerStatus();
  webServerPort.value = String(webStatus.port);
  webServerToken.value = '';
  webServerToken.placeholder = webStatus.tokenConfigured
    ? 'Access token is configured — leave blank to keep it'
    : 'No access token';
  clearWebTokenButton.disabled = !webStatus.tokenConfigured;
  renderWebServerStatus(webStatus);
  applyWebModeLock();

  loadHiddenAssets();
  loadUnityProjects();
}

// Keep the detected-projects list fresh while Settings is open (heartbeats land every ~5s).
setInterval(loadUnityProjects, 5000);

document.getElementById('btn-pick-root').addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) rootInput.value = folder;
});

document.getElementById('btn-pick-downloads').addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) downloadsInput.value = folder;
});

document.getElementById('btn-pick-booth-downloads').addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) boothDownloadsInput.value = folder;
});

document.getElementById('btn-reveal-unity-companion').addEventListener('click', () => {
  window.api.revealUnityCompanion();
});

async function saveShowcaseSettings() {
  await window.api.setConfig({
    showcasePublishUrl: showcasePublishUrl.value,
    showcasePublishToken: showcasePublishToken.value,
  });
  if (showcasePublishToken.value) {
    showcasePublishToken.value = '';
    showcasePublishToken.placeholder = 'Publishing token is configured — leave blank to keep it';
  }
}

document.getElementById('btn-create-showcase').addEventListener('click', async () => {
  showcaseStatus.textContent = 'Creating a sanitized snapshot…';
  try {
    const result = await window.api.createShowcaseSnapshot();
    showcaseStatus.textContent = `Created ${result.assetCount} public cards at ${result.outputPath}`;
  } catch (error) {
    showcaseStatus.textContent = `Could not create the snapshot: ${error.message}`;
  }
});

document.getElementById('btn-publish-showcase').addEventListener('click', async () => {
  showcaseStatus.textContent = 'Creating and publishing the snapshot…';
  try {
    await saveShowcaseSettings();
    const result = await window.api.publishShowcase();
    showcaseStatus.textContent = `Published ${result.assetCount} public cards.`;
  } catch (error) {
    showcaseStatus.textContent = `Could not publish the snapshot: ${error.message}`;
  }
});

document.getElementById('btn-open-showcase').addEventListener('click', async () => {
  try {
    const value = new URL(showcasePublishUrl.value);
    if (value.protocol !== 'https:') throw new Error('HTTPS is required.');
    value.pathname = value.pathname.replace(/\/api\/publish\/?$/, '') || '/';
    value.search = '';
    value.hash = '';
    await window.api.openExternal(value.href);
  } catch (error) {
    showcaseStatus.textContent = `Could not open the showcase: ${error.message}`;
  }
});

async function loadUnityProjects() {
  const listEl = document.getElementById('unity-projects-list');
  const emptyEl = document.getElementById('unity-projects-empty');
  const projects = await window.api.getUnityProjects();

  Array.from(listEl.querySelectorAll('.unity-project-row')).forEach(el => el.remove());

  if (projects.length === 0) {
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  for (const project of projects) {
    const row = document.createElement('div');
    row.className = 'unity-project-row';
    row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px 8px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); font-size:13px;';
    row.innerHTML = `<span style="color:#4caf50;">●</span> <span style="flex:1;">${escHtml(project.projectName)}</span> <span style="font-size:11px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:260px;">${escHtml(project.projectPath)}</span>`;
    listEl.appendChild(row);
  }
}

document.getElementById('btn-save').addEventListener('click', async () => {
  const webPort = readWebServerPort();
  if (webPort === null) {
    saveStatus.textContent = 'Enter a web server port between 1 and 65535.';
    saveStatus.className = 'status error';
    return;
  }

  await window.api.setConfig({
    rootFolder: rootInput.value,
    translatedTitlesEnabled: translatedTitlesToggle.getAttribute('aria-checked') === 'true',
    downloadsFolder: downloadsInput.value,
    notificationsEnabled: notificationsToggle.getAttribute('aria-checked') === 'true',
    libraryHealthNotify: healthNotifyToggle.getAttribute('aria-checked') === 'true',
    boothEnabled: boothToggle.getAttribute('aria-checked') === 'true',
    boothDownloadsFolder: boothDownloadsInput.value,
    malwareScanEnabled: malwareScanToggle.getAttribute('aria-checked') === 'true',
    malwareBacklogScanEnabled: malwareBacklogToggle.getAttribute('aria-checked') === 'true',
    showcasePublishUrl: showcasePublishUrl.value,
    showcasePublishToken: showcasePublishToken.value,
  });

  // Port and token are applied here, so the running server follows the field.
  const newToken = webServerToken.value;
  const webStatus = await window.api.setWebServer({
    enabled: webServerToggle.getAttribute('aria-checked') === 'true',
    port: webPort,
    ...(newToken ? { token: newToken } : {}),
  });
  webServerToken.value = '';
  webServerToken.placeholder = webStatus.tokenConfigured
    ? 'Access token is configured — leave blank to keep it'
    : 'No access token';
  clearWebTokenButton.disabled = !webStatus.tokenConfigured;
  renderWebServerStatus(webStatus);
  applyWebModeLock();

  if (webStatus.error) {
    saveStatus.textContent = webStatus.error;
    saveStatus.className = 'status error';
    return;
  }

  saveStatus.textContent = '✔ Settings saved.';
  saveStatus.className = 'status success';
  setTimeout(() => { saveStatus.className = 'status'; }, 2000);
});

function goBack() {
  window.location.href = 'index.html';
}

document.getElementById('btn-back').addEventListener('click', goBack);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.repeat) goBack();
});

const ossOverlay = document.getElementById('oss-overlay');
document.getElementById('btn-oss').addEventListener('click', () => { ossOverlay.style.display = 'flex'; });
document.getElementById('btn-oss-close').addEventListener('click', () => { ossOverlay.style.display = 'none'; });
ossOverlay.addEventListener('click', e => { if (e.target === ossOverlay) ossOverlay.style.display = 'none'; });

load();
