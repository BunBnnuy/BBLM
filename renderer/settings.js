const rootInput = document.getElementById('root-folder');
const downloadsInput = document.getElementById('downloads-folder');
const saveStatus = document.getElementById('save-status');
const monitorToggle = document.getElementById('monitor-toggle');
const boothToggle = document.getElementById('booth-toggle');
const boothFolderField = document.getElementById('booth-folder-field');
const boothDownloadsInput = document.getElementById('booth-downloads-folder');

function setToggleState(enabled) {
  monitorToggle.textContent = enabled ? 'On' : 'Off';
  monitorToggle.setAttribute('aria-checked', String(enabled));
  monitorToggle.classList.toggle('btn-primary', enabled);
  monitorToggle.classList.toggle('btn-ghost', !enabled);
}

function setBoothToggleState(enabled) {
  boothToggle.textContent = enabled ? 'On' : 'Off';
  boothToggle.setAttribute('aria-checked', String(enabled));
  boothToggle.classList.toggle('btn-primary', enabled);
  boothToggle.classList.toggle('btn-ghost', !enabled);
  boothFolderField.style.display = enabled ? 'block' : 'none';
}

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

async function load() {
  const config = await window.api.getConfig();
  rootInput.value = config.rootFolder || '';
  downloadsInput.value = config.downloadsFolder || '';
  setToggleState(config.monitorEnabled || false);
  setBoothToggleState(config.boothEnabled || false);
  boothDownloadsInput.value = config.boothDownloadsFolder || '';
}

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

document.getElementById('btn-save').addEventListener('click', async () => {
  await window.api.setConfig({
    rootFolder: rootInput.value,
    downloadsFolder: downloadsInput.value,
    boothEnabled: boothToggle.getAttribute('aria-checked') === 'true',
    boothDownloadsFolder: boothDownloadsInput.value,
  });
  saveStatus.textContent = '✔ Settings saved.';
  saveStatus.className = 'status success';
  setTimeout(() => { saveStatus.className = 'status'; }, 2000);
});

document.getElementById('btn-back').addEventListener('click', () => {
  window.location.href = 'index.html';
});

load();
