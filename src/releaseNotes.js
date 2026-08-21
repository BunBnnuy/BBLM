'use strict';

function parseReleaseNotes(markdown, version) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^## \[([^\]]+)\]/);
    if (!match || match[1].trim() !== String(version)) continue;
    const sections = [];
    let current = null;
    for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (/^## \[/.test(line)) break;
      const heading = line.match(/^###\s+(.+?)\s*$/);
      if (heading) {
        current = { title: heading[1], items: [] };
        sections.push(current);
        continue;
      }
      const item = line.match(/^\s*[-*]\s+(.+?)\s*$/);
      if (item) {
        if (!current) {
          current = { title: 'Changes', items: [] };
          sections.push(current);
        }
        current.items.push(item[1]);
      }
    }
    return { version: String(version), sections };
  }
  return { version: String(version), sections: [] };
}

module.exports = { parseReleaseNotes };
