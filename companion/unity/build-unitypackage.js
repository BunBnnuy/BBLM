// Regenerates BBLM_Importer.unitypackage from BBLM_Importer.cs.
// Run manually with `node companion/unity/build-unitypackage.js` whenever the
// companion script changes. Not part of the app build/runtime — this is a
// one-off dev tool.
const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');

// Fixed GUID so re-running this script (e.g. after editing the .cs) updates
// the same asset in Unity instead of creating a duplicate on reimport.
// Change this when the companion package changes. Unity otherwise reports
// "Nothing to import" for an already-installed package with the same asset
// identity, even when the source file has changed.
const GUID = 'b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8';
const TARGET_PATH = 'Assets/Editor/BBLM_Importer.cs';

const SCRIPT_META = `fileFormatVersion: 2
guid: ${GUID}
MonoImporter:
  externalObjects: {}
  serializedVersion: 2
  defaultReferences: []
  executionOrder: 0
  icon: {instanceID: 0}
  userData:
  assetBundleName:
  assetBundleVariant:
`;

async function main() {
  const srcCs = path.join(__dirname, 'BBLM_Importer.cs');
  const outPkg = path.join(__dirname, 'BBLM_Importer.unitypackage');

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-unitypkg-'));
  try {
    const entryDir = path.join(stagingDir, GUID);
    fs.mkdirSync(entryDir);
    fs.copyFileSync(srcCs, path.join(entryDir, 'asset'));
    fs.writeFileSync(path.join(entryDir, 'asset.meta'), SCRIPT_META);
    fs.writeFileSync(path.join(entryDir, 'pathname'), TARGET_PATH + '\n');

    await tar.create({ gzip: true, file: outPkg, cwd: stagingDir, portable: true }, [GUID]);
    console.log('Wrote', outPkg);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
