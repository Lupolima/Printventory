'use strict';

// Model folders (src/server/model-folders.js): a folder per model with image, video and document subfolders.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const database = require('../src/core/database');
const runtime = require('../src/server/runtime');
const mf = require('../src/server/model-folders');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-model-folders-')));
  database.db = new Database(path.join(tmp, 'test.db'));
  database.db.exec(`CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, fileName TEXT, thumbnail TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  const trashed = [];
  runtime.shell.trashItem = async (p) => {
    trashed.push(p);
    fs.rmSync(p);
  };
  const noResize = async () => null;

  // --- Kinds ---
  assert.strictEqual(mf.kindOf('Photo.JPG'), 'image');
  assert.strictEqual(mf.kindOf('a.pjpeg'), 'image');
  assert.strictEqual(mf.kindOf('clip.m4v'), 'video');
  assert.strictEqual(mf.kindOf('guide.text'), 'document');
  assert.strictEqual(mf.kindOf('part.stl'), null);
  assert.deepStrictEqual(Object.keys(mf.mediaExtensions()), ['image', 'video', 'document']);

  // --- Making and registering ---
  const lib = path.join(tmp, 'lib');
  fs.mkdirSync(lib);
  const robot = mf.makeFolder(lib, 'Robot: Mk/2');
  assert.strictEqual(path.basename(robot), 'Robot Mk 2', 'unsafe characters leave the name');
  assert.ok(mf.isModelFolder(robot) && mf.isModelFolder(`${robot}/`));
  assert.strictEqual(path.basename(mf.makeFolder(lib, 'Robot Mk 2')), 'Robot Mk 2 (2)', 'a taken name gets a number');
  assert.ok(!mf.isModelFolder(lib));

  // Scans leave out the media folders of model folders at or under the scanned folder.
  const skipped = mf.mediaFolders(lib);
  assert.ok(skipped.includes(path.join(robot, 'image')) && skipped.includes(path.join(robot, 'document')) && skipped.length === 6, JSON.stringify(skipped));
  assert.deepStrictEqual(
    mf.mediaFolders(path.join(robot, 'video')),
    ['image', 'video', 'document'].map((d) => path.join(robot, d)),
    'a scan of a media folder'
  );
  assert.ok(mf.isMediaFolder(path.join(robot, 'image')) && !mf.isMediaFolder(path.join(lib, 'image')));

  // Upload targets: a media folder is made when missing and takes its kind's types.
  assert.strictEqual(mf.mediaTarget(path.join(lib, 'image')), null);
  const target = mf.mediaTarget(path.join(robot, 'image'));
  assert.ok(target && target.kind === 'image' && fs.existsSync(path.join(robot, 'image')) && target.extensions.includes('.webp'));

  // --- Media ---
  const model = path.join(robot, 'Robot.3mf');
  fs.writeFileSync(model, 'x');
  database.db.prepare('INSERT INTO models (filePath, fileName, thumbnail) VALUES (?, ?, ?)').run(model, 'Robot.3mf', 'data:image/png;base64,OLD');
  fs.writeFileSync(path.join(robot, 'image', 'b.png'), PNG);
  fs.writeFileSync(path.join(robot, 'image', 'a.tif'), 'tiff');
  fs.writeFileSync(path.join(robot, 'image', 'notes.txt'), 'wrong folder');
  fs.mkdirSync(path.join(robot, 'document'));
  fs.writeFileSync(path.join(robot, 'document', 'Guide.pdf'), '%PDF');
  let media = mf.getMedia(model);
  assert.ok(media.isModelFolder && media.folder === robot, 'a model file finds its folder');
  assert.deepStrictEqual(
    media.image.map((f) => f.name),
    ['a.tif', 'b.png'],
    'only pictures, by name'
  );
  assert.deepStrictEqual(
    media.document.map((f) => f.name),
    ['Guide.pdf']
  );
  assert.strictEqual(mf.getMedia(lib).isModelFolder, false);

  // The first picture a cover can be made from becomes the cover (TIFF cannot be one).
  await mf.coverIfNone(robot, { resize: noResize });
  media = mf.getMedia(robot);
  assert.strictEqual(media.cover, 'b.png');
  const cover = `data:image/png;base64,${PNG.toString('base64')}`;
  assert.strictEqual(database.db.prepare('SELECT thumbnail FROM models').get().thumbnail, `${cover}::data:image/png;base64,OLD`, 'the cover goes first');
  await assert.rejects(mf.setCover(robot, 'a.tif', { resize: noResize }), /cannot be a cover/);
  await assert.rejects(mf.setCover(robot, '../x.png'), /Not a image file name/);

  // A resized cover replaces the earlier one, not added next to it.
  await mf.setCover(robot, 'b.png', { resize: async () => ({ dataUrl: 'data:image/webp;base64,S' }) });
  assert.strictEqual(database.db.prepare('SELECT thumbnail FROM models').get().thumbnail, 'data:image/webp;base64,S::data:image/png;base64,OLD');

  // Removing the cover picture takes the cover away.
  media = await mf.removeMedia(robot, 'image', 'b.png');
  assert.deepStrictEqual(trashed, [path.join(robot, 'image', 'b.png')]);
  assert.strictEqual(media.cover, null);
  assert.strictEqual(database.db.prepare('SELECT thumbnail FROM models').get().thumbnail, 'data:image/png;base64,OLD');
  await assert.rejects(mf.removeMedia(robot, 'document', 'Missing.pdf'), /No file named/);
  await assert.rejects(mf.removeMedia(lib, 'document', 'Guide.pdf'), /Not a model folder/);

  // --- YouTube ---
  assert.strictEqual(mf.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
  assert.strictEqual(mf.youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(mf.youtubeId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(mf.youtubeId('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  media = mf.addYoutube(robot, ['dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ']);
  assert.deepStrictEqual(
    media.youtube.map((v) => v.id),
    ['dQw4w9WgXcQ'],
    'kept once'
  );
  assert.throws(() => mf.addYoutube(robot, 'not a link'), /Not a YouTube/);
  assert.deepStrictEqual(mf.removeYoutube(robot, 'dQw4w9WgXcQ').youtube, []);

  // --- Saving from a site ---
  const answer = (body, type, url) => {
    const response = new Response(body, { status: 200, headers: { 'content-type': type } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  let fetched = 0;
  const fetchImpl = async (url) => {
    fetched++;
    if (url.endsWith('/page')) return answer('<html>', 'text/html', url);
    if (url.endsWith('/noext')) return answer(PNG, 'image/png', url);
    return answer(PNG, 'image/png', url);
  };
  const host = (url) => new URL(url).hostname === 'media.example.com';
  assert.strictEqual(await mf.saveFromSite(robot, 'https://media.example.com/x/Front%20view.png', null, { fetchImpl, allowedHost: host }), 'Front view.png');
  assert.strictEqual(await mf.saveFromSite(robot, 'https://media.example.com/x/Front%20view.png', null, { fetchImpl, allowedHost: host }), null, 'not twice');
  assert.strictEqual(fetched, 1);
  assert.strictEqual(
    await mf.saveFromSite(robot, 'https://media.example.com/noext', 'Side', { fetchImpl, allowedHost: host }),
    'Side.png',
    'the type gives the extension'
  );
  await assert.rejects(mf.saveFromSite(robot, 'https://media.example.com/page', 'Manual.pdf', { fetchImpl, allowedHost: host }), /sent text\/html/);
  await assert.rejects(mf.saveFromSite(robot, 'https://other.example.com/a.png', null, { fetchImpl, allowedHost: host }), /Not downloaded from/);
  assert.ok(fs.existsSync(path.join(robot, 'image', 'Front view.png')));
  assert.ok(!fs.readdirSync(path.join(robot, 'image')).some((n) => n.endsWith('.part')), 'no temp files left');
  assert.strictEqual(mf.plainFileName('../../etc/passwd'), '_.._etc_passwd');

  // --- Moving a folder ---
  const renamed = path.join(lib, 'Robot Renamed');
  fs.renameSync(robot, renamed);
  mf.moved(robot, renamed);
  assert.ok(mf.isModelFolder(renamed) && !mf.isModelFolder(robot));

  database.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('model-folders tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
