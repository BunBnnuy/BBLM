const rootInput = document.getElementById('root-folder');
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
  rootInput.value = config.rootFolder || '';
  downloadsInput.value = config.downloadsFolder || '';
  setNotificationsToggle(config.notificationsEnabled !== false);
  setHealthNotifyToggle(config.libraryHealthNotify || false);
  setToggleState(config.monitorEnabled || false);
  setBoothToggleState(config.boothEnabled || false);
  boothDownloadsInput.value = config.boothDownloadsFolder || '';
  setMalwareScanToggle(config.malwareScanEnabled !== false);
  setMalwareBacklogToggle(config.malwareBacklogScanEnabled !== false);
  if (config.malwareScannerAvailable) {
    malwareScannerStatus.value = `vrchat-scanner ${config.malwareScannerVersion || ''} — ${config.malwareScannerPath || ''}`.trim();
  } else {
    malwareScannerStatus.value = 'Not installed yet — will download automatically on next launch with internet access.';
  }

  const schemes = await window.api.getSchemeStatus();
  setSchemeToggle(schemeBoothToggle, schemes['booth-library-manager'] || false);
  setSchemeToggle(schemeBunsToggle, schemes['BunsLM'] || false);
  setSchemeToggle(schemeVroidToggle, schemes['vroid.closet'] || false);

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
  await window.api.setConfig({
    rootFolder: rootInput.value,
    downloadsFolder: downloadsInput.value,
    notificationsEnabled: notificationsToggle.getAttribute('aria-checked') === 'true',
    libraryHealthNotify: healthNotifyToggle.getAttribute('aria-checked') === 'true',
    boothEnabled: boothToggle.getAttribute('aria-checked') === 'true',
    boothDownloadsFolder: boothDownloadsInput.value,
    malwareScanEnabled: malwareScanToggle.getAttribute('aria-checked') === 'true',
    malwareBacklogScanEnabled: malwareBacklogToggle.getAttribute('aria-checked') === 'true',
  });
  saveStatus.textContent = '✔ Settings saved.';
  saveStatus.className = 'status success';
  setTimeout(() => { saveStatus.className = 'status'; }, 2000);
});

document.getElementById('btn-back').addEventListener('click', () => {
  window.location.href = 'index.html';
});

const ossOverlay = document.getElementById('oss-overlay');
document.getElementById('btn-oss').addEventListener('click', () => { ossOverlay.style.display = 'flex'; });
document.getElementById('btn-oss-close').addEventListener('click', () => { ossOverlay.style.display = 'none'; });
ossOverlay.addEventListener('click', e => { if (e.target === ossOverlay) ossOverlay.style.display = 'none'; });

load();
