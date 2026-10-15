#!/usr/bin/env node
'use strict';

// A ZIP larger than the Max File Size is scanned for the models inside it; each model is held to
// the limit, not the archive (src/server/scan-worker.js).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { zipSync, strToU8 } = require('fflate');

function scan(dir, maxFileSize) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'src', 'server', 'scan-worker.js'));
    const files = [];
    worker.on('message', (message) => {
      if (message.type === 'batch') files.push(...message.files);
      if (message.type === 'done') {
        files.push(...(message.result.files || []));
        worker.terminate();
        resolve({ files, skipped: message.result.skippedDueToSize });
      }
      if (message.type === 'error') {
        worker.terminate();
        reject(new Error(message.error));
      }
    });
    worker.postMessage({
      directoryPath: dir,
      maxFileSize,
      enableZipArchives: true,
      scanExtensions: ['.stl', '.3mf'],
      excludeFolderNames: [],
      excludeDirectories: []
    });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-zip-size-'));
  try {
    const small = 'solid part\nendsolid part\n';
    // Incompressible padding makes the archive larger than the limit; the parts stay small.
    const padding = Uint8Array.from({ length: 6000 }, (_, i) => (i * 7919) % 251);
    const big = 'solid big\n' + 'x'.repeat(5000) + '\nendsolid big\n';
    fs.writeFileSync(
      path.join(dir, 'kit.zip'),
      Buffer.from(
        zipSync({ 'arm.stl': strToU8(small), 'leg.stl': strToU8(small), 'big.stl': [strToU8(big), { level: 0 }], 'notes.bin': [padding, { level: 0 }] })
      )
    );
    assert.ok(fs.statSync(path.join(dir, 'kit.zip')).size > 4000);
    const { files, skipped } = await scan(dir, 4000);
    const names = files.map((f) => f.fileName).sort();
    assert.deepStrictEqual(names, ['arm.stl', 'leg.stl'], 'the small parts are found although the ZIP is over the limit');
    assert.strictEqual(skipped, 1, 'a part over the limit is still skipped');
    console.log('ok a ZIP over the size limit is scanned for its models');
  } catch (error) {
    console.error('FAIL scan-zip-size:', error.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
