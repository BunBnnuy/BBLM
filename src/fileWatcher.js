const fs = require('fs');
const path = require('path');

const POLL_INTERVAL = 1000; // ms
const STABLE_CHECKS = 3;    // file size must be unchanged this many consecutive checks
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function waitForFile(fileName, downloadsFolder) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(downloadsFolder, fileName);
    const deadline = Date.now() + TIMEOUT_MS;
    let stableCount = 0;
    let lastSize = -1;

    const check = () => {
      if (Date.now() > deadline) {
        return reject(new Error('Timed out waiting for file: ' + fileName));
      }

      if (!fs.existsSync(filePath)) {
        stableCount = 0;
        lastSize = -1;
        return setTimeout(check, POLL_INTERVAL);
      }

      try {
        const { size } = fs.statSync(filePath);
        if (size === lastSize && size > 0) {
          stableCount++;
          if (stableCount >= STABLE_CHECKS) {
            return resolve(filePath);
          }
        } else {
          stableCount = 0;
          lastSize = size;
        }
      } catch {
        stableCount = 0;
      }
      setTimeout(check, POLL_INTERVAL);
    };

    check();
  });
}

module.exports = { waitForFile };
