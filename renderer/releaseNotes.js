'use strict';

function releaseNotesText(value) {
  return String(value || '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/`(.*?)`/g, '$1');
}

function renderReleaseNotes(notes) {
  const overlay = document.getElementById('release-notes-overlay');
  const versionEl = document.getElementById('release-notes-version');
  const content = document.getElementById('release-notes-content');
  if (!overlay || !versionEl || !content) return;
  versionEl.textContent = `Version ${notes.version}`;
  content.replaceChildren();
  if (!notes.sections || notes.sections.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No release notes are available for this version.';
    content.appendChild(empty);
  } else {
    for (const section of notes.sections) {
      const heading = document.createElement('h3');
      heading.textContent = releaseNotesText(section.title);
      content.appendChild(heading);
      const list = document.createElement('ul');
      for (const item of section.items) {
        const li = document.createElement('li');
        li.textContent = releaseNotesText(item);
        list.appendChild(li);
      }
      content.appendChild(list);
    }
  }
  overlay.style.display = 'flex';
}

async function showReleaseNotes(force = false) {
  const notes = await window.api.getReleaseNotes();
  if (force || notes.isNew) {
    renderReleaseNotes(notes);
    if (notes.isNew) await window.api.acknowledgeReleaseNotes();
  }
}

const overlay = document.getElementById('release-notes-overlay');
const closeButton = document.getElementById('btn-release-notes-close');
const doneButton = document.getElementById('btn-release-notes-done');
if (closeButton) closeButton.addEventListener('click', () => { overlay.style.display = 'none'; });
if (doneButton) doneButton.addEventListener('click', () => { overlay.style.display = 'none'; });
if (overlay) overlay.addEventListener('click', event => {
  if (event.target === overlay) overlay.style.display = 'none';
});

const showButton = document.getElementById('btn-show-release-notes');
if (showButton) {
  showButton.addEventListener('click', () => showReleaseNotes(true).catch(err => console.warn('[release-notes]', err.message)));
} else if (overlay) {
  showReleaseNotes().catch(err => console.warn('[release-notes]', err.message));
}
