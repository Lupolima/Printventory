#!/usr/bin/env node
'use strict';

// Unpacking archives into a model folder (src/server/unpack-archives.js), with bsdtar.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { zipSync, strToU8 } = require('fflate');

function hasBsdtar() {
  try {
    execFileSync('bsdtar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

async function main() {
  if (!hasBsdtar()) {
    console.log('ok unpack-archives skipped (no bsdtar here)');
    return;
  }
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-unpack-')));
  const database = require('../src/core/database');
  database.db = new Database(path.join(tmp, 'test.db'));
  database.db.exec(
    'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, fileName TEXT, thumbnail TEXT, size INTEGER)'
  );
  const { unpackFolder, archivesIn, folderNameFor } = require('../src/server/unpack-archives');
  const modelFolders = require('../src/server/model-folders');
  try {
    const kit = path.join(tmp, 'Gundam');
    fs.mkdirSync(kit);
    const stl = (name) => strToU8(`solid ${name}\nendsolid ${name}\n`);
    // arm.zip: a folder of its own with a part, and a ZIP inside with another part.
    const innerZip = zipSync({ 'hand.stl': stl('hand') });
    fs.writeFileSync(
      path.join(kit, 'arm.zip'),
      Buffer.from(zipSync({ 'arm/upper arm.stl': stl('upper'), 'arm/hands.zip': innerZip, '__MACOSX/._x': strToU8('junk') }))
    );
    // back+pack.zip: parts at its top.
    fs.writeFileSync(path.join(kit, 'back+pack.zip'), Buffer.from(zipSync({ 'pack.stl': stl('pack'), 'strap.stl': stl('strap') })));
    // core.7z, made by bsdtar.
    const src = path.join(tmp, 'core-src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'core.stl'), 'solid core\nendsolid core\n');
    execFileSync('bsdtar', ['--format', '7zip', '-cf', path.join(kit, 'core.7z'), '-C', src, 'core.stl']);
    fs.writeFileSync(path.join(kit, 'mmexport1.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    fs.writeFileSync(path.join(kit, 'Guide.pdf'), '%PDF-1.4');
    fs.writeFileSync(path.join(kit, 'broken.zip'), 'not a zip at all');

    assert.deepStrictEqual(archivesIn(kit).sort(), ['arm.zip', 'back+pack.zip', 'broken.zip', 'core.7z']);
    assert.strictEqual(folderNameFor('/x/Core+fighter.part1.rar'), 'Core fighter');

    const result = await unpackFolder(kit);
    assert.deepStrictEqual(result.unpacked.sort(), ['arm.zip', 'back+pack.zip', 'core.7z']);
    assert.deepStrictEqual(
      result.failed.map((f) => f.name),
      ['broken.zip'],
      'a damaged archive is listed, the others still unpacked'
    );
    assert.deepStrictEqual([result.images, result.documents], [1, 1]);

    const exists = (...parts) => fs.existsSync(path.join(kit, ...parts));
    assert.ok(exists('arm', 'upper arm.stl'), 'a single folder inside is lifted up (no arm/arm)');
    assert.ok(exists('arm', 'hands', 'hand.stl'), 'an archive inside an archive is unpacked too');
    assert.ok(!exists('arm', 'hands.zip'), '…and the inner archive is gone (the original keeps it)');
    assert.ok(!exists('arm', '__MACOSX'), 'Mac junk is removed');
    assert.ok(exists('back pack', 'pack.stl') && exists('back pack', 'strap.stl'), 'named after the archive, + as a space');
    assert.ok(exists('core', 'core.stl'), '7Z is unpacked');
    assert.deepStrictEqual(fs.readdirSync(path.join(kit, 'archives')).sort(), ['arm.zip', 'back+pack.zip', 'core.7z'], 'the originals are kept');
    assert.ok(exists('broken.zip'), 'a damaged archive stays where it was');
    assert.ok(exists('image', 'mmexport1.png') && exists('document', 'Guide.pdf'), 'loose pictures and documents become the model folder’s own');
    assert.ok(modelFolders.isModelFolder(kit));
    assert.ok(modelFolders.mediaFolders(kit).includes(path.join(kit, 'archives')), 'scans skip archives/');

    // Again: nothing new to do (the originals are in archives/).
    const again = await unpackFolder(kit, { only: [path.join(kit, 'broken.zip')] });
    assert.deepStrictEqual(again.unpacked, []);
    console.log('ok archives are unpacked into the model folder, originals kept');
  } finally {
    database.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL unpack-archives:', error.message);
  process.exitCode = 1;
});
