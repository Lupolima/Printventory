'use strict';

/**
 * Unpack archives into a model folder, keeping everything together: ZIP, RAR and 7Z files (and the
 * archives inside them) are unpacked into a subfolder each, named after the archive; the original
 * archives move to archives/ (which scans skip, like image/, video/ and document/); loose pictures
 * and documents go to image/ and document/. With Folders as models the folder is then one model:
 * its parts, its pictures and its documents.
 *
 * bsdtar (libarchive) does the unpacking: it reads ZIP, 7Z and RAR (4 and 5), never writes outside
 * the folder it unpacks into, and refuses absolute paths and "..". Links are removed afterwards.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z'];
const ARCHIVES_DIR = 'archives';
/** Archives inside archives are unpacked this many levels down. */
const MAX_DEPTH = 4;
/** Larger than this, unpacked, is refused (or more than the free space). */
const MAX_UNPACKED_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 50000;
/** Folders and files archives made on a Mac or Windows bring along. */
const JUNK = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini']);

const isArchive = (name) => ARCHIVE_EXTENSIONS.includes(path.extname(String(name)).toLowerCase());
/** The second and later parts of a split RAR ("x.part2.rar"): unpacked with the first part. */
const isLaterPart = (name) => /\.part0*([2-9]|\d{2,})\.rar$/i.test(String(name));

function run(args, { timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.env.JUSTTPRINT_BSDTAR || 'bsdtar', args, { maxBuffer: 64 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
      if (error) {
        const text = String(stderr || error.message).trim();
        if (/ENOENT/.test(error.message) && /bsdtar/.test(error.message)) return reject(new Error('bsdtar is not installed (libarchive-tools)'));
        if (/passphrase|encrypt/i.test(text)) return reject(new Error('it is protected by a password'));
        return reject(new Error(text.split('\n').filter(Boolean).slice(-2).join(' ') || error.message));
      }
      resolve(String(stdout));
    });
  });
}

/** How big an archive is unpacked, and how many entries (bsdtar -tv lists sizes). */
async function measure(archive) {
  const listing = await run(['-tvf', archive]);
  let bytes = 0;
  let entries = 0;
  for (const line of listing.split('\n')) {
    if (!line.trim()) continue;
    entries++;
    // "-rw-r--r--  0 0      0     1234 Jul 20  2021 name": the size is the 5th field.
    const size = Number(line.trim().split(/\s+/)[4]);
    if (Number.isFinite(size)) bytes += size;
  }
  return { bytes, entries };
}

/** "name", else "name (2)", … : a path in `parent` that is not taken. */
function freePath(parent, name) {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(parent, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No free name for ${name} in ${parent}`);
}

/** The archive's name without its extension(s) ("x.part1.rar" → "x"), made readable ("back+pack" → "back pack"). */
function folderNameFor(archive) {
  return (
    path
      .basename(archive)
      .replace(/(\.part0*1)?\.(zip|rar|7z)$/i, '')
      .replace(/\+/g, ' ')
      .trim() || 'archive'
  );
}

/** Remove links (they could point anywhere) and the junk Macs and Windows add; answers the archives found. */
function tidy(dir, depth = 0, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || JUNK.has(entry.name.toLowerCase()) || entry.name.startsWith('._')) {
      fs.rmSync(full, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      if (depth < 20) tidy(full, depth + 1, found);
    } else if (entry.isFile() && isArchive(entry.name) && !isLaterPart(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** An archive that unpacked to just one folder: that folder's contents move up (no "arm/arm/"). */
function liftSingleFolder(target) {
  const entries = fs.readdirSync(target, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  // Aside first: the folder may hold something of its own name.
  const inner = path.join(target, `.justtprint-lift-${process.pid}-${Date.now()}`);
  fs.renameSync(path.join(target, entries[0].name), inner);
  for (const name of fs.readdirSync(inner)) fs.renameSync(path.join(inner, name), path.join(target, name));
  fs.rmdirSync(inner);
}

/** Unpack one archive into a new folder next to it; answers that folder. */
async function unpackOne(archive, { freeBytes = Infinity } = {}) {
  const { bytes, entries } = await measure(archive);
  if (entries > MAX_ENTRIES) throw new Error(`it has ${entries} files (at most ${MAX_ENTRIES})`);
  if (bytes > MAX_UNPACKED_BYTES) throw new Error(`it would take ${Math.round(bytes / 1024 ** 3)} GB unpacked (at most 20 GB)`);
  if (bytes > freeBytes * 0.9) throw new Error('there is not enough free space to unpack it');
  const target = freePath(path.dirname(archive), folderNameFor(archive));
  fs.mkdirSync(target, { recursive: true });
  try {
    await run(['-xf', archive, '-C', target]);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  tidy(target);
  liftSingleFolder(target);
  return target;
}

function freeSpace(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch (_) {
    return Infinity;
  }
}

/**
 * Unpack the archives directly in `dir` (or only `only`, paths in `dir`), and the archives inside
 * them, into a folder each; move the originals to archives/ and loose pictures and documents to
 * image/ and document/. `dir` becomes a model folder. Never throws for one archive: what fails is
 * listed. `archives: false` leaves the archives, `media: false` the pictures and documents
 * (Organize's settings). Answers { folder, unpacked: [name], failed: [{ name, error }], images, documents }.
 * @param {string} dir
 * @param {{ only?: string[] | null, archives?: boolean, media?: boolean }} [options]
 */
async function unpackFolder(dir, { only = null, archives = true, media = true } = {}) {
  const modelFolders = require('./model-folders');
  const folder = modelFolders.register(dir);
  const result = { folder, unpacked: /** @type {string[]} */ ([]), failed: /** @type {{ name: string, error: string }[]} */ ([]), images: 0, documents: 0 };
  const wanted = only ? new Set(only.map((p) => path.resolve(p))) : null;
  const top = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isArchive(entry.name) && !isLaterPart(entry.name))
    .map((entry) => path.join(folder, entry.name))
    .filter((archive) => !wanted || wanted.has(path.resolve(archive)))
    .filter(() => archives);

  for (const archive of top) {
    const name = path.basename(archive);
    try {
      const unpackedTo = await unpackOne(archive, { freeBytes: freeSpace(folder) });
      // The archives inside: unpacked next to themselves, then deleted (the original keeps them).
      let nested = tidy(unpackedTo);
      for (let depth = 1; depth <= MAX_DEPTH && nested.length; depth++) {
        const next = [];
        for (const inner of nested) {
          try {
            const innerTo = await unpackOne(inner, { freeBytes: freeSpace(folder) });
            fs.rmSync(inner, { force: true });
            next.push(...tidy(innerTo));
          } catch (error) {
            result.failed.push({ name: path.relative(folder, inner), error: error.message });
          }
        }
        nested = next;
      }
      // The original is kept, out of the scan's way.
      const keep = path.join(folder, ARCHIVES_DIR);
      fs.mkdirSync(keep, { recursive: true });
      fs.renameSync(archive, freePath(keep, name));
      for (const part of fs.readdirSync(folder)) {
        // A split RAR's other parts go with it.
        if (isLaterPart(part) && part.replace(/\.part\d+\.rar$/i, '') === name.replace(/\.part\d+\.rar$/i, '')) {
          fs.renameSync(path.join(folder, part), freePath(keep, part));
        }
      }
      result.unpacked.push(name);
    } catch (error) {
      result.failed.push({ name, error: error.message });
    }
  }

  // Loose pictures and documents become the model's own (its Pictures and Documents).
  for (const entry of media ? fs.readdirSync(folder, { withFileTypes: true }) : []) {
    if (!entry.isFile()) continue;
    const kind = modelFolders.kindOf(entry.name);
    if (kind !== 'image' && kind !== 'document') continue;
    const into = path.join(folder, modelFolders.KINDS[kind].dir);
    fs.mkdirSync(into, { recursive: true });
    fs.renameSync(path.join(folder, entry.name), freePath(into, entry.name));
    if (kind === 'image') result.images++;
    else result.documents++;
  }
  if (result.unpacked.length || result.failed.length) {
    console.log(
      `[Unpack] ${folder}: unpacked ${result.unpacked.length}${result.failed.length ? `, failed ${result.failed.map((f) => `${f.name} (${f.error})`).join(', ')}` : ''}`
    );
  }
  return result;
}

/** Whether a folder has archives to unpack (directly in it). */
function archivesIn(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isArchive(entry.name) && !isLaterPart(entry.name))
      .map((entry) => entry.name);
  } catch (_) {
    return [];
  }
}

module.exports = { ARCHIVES_DIR, ARCHIVE_EXTENSIONS, archivesIn, folderNameFor, isArchive, unpackFolder };
