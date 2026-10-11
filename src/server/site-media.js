'use strict';

/**
 * What a site shows of a model, saved with its files: after a download from MakerWorld,
 * Printables or Thingiverse, the model's folder becomes a model folder (model-folders.js) and
 * gets the model's pictures (its gallery, not the site's own graphics), the guides, parts lists
 * and PDFs the site lists for it, and its videos: video files into video/, YouTube videos as
 * links (they cannot be downloaded). Only the site's own hosts are downloaded from. Files saved
 * before are skipped, so downloading more profiles later adds only what is new. The site's cover
 * becomes the folder's cover when it has none.
 */

const path = require('path');
const modelFolders = require('./model-folders');

const MAX_PICTURES = 40;
const MAX_ATTACHMENTS = 20;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** Where each site keeps its pictures and files. */
const HOSTS = {
  makerworld: ['bblmw.com', 'bambulab.com', 'aliyuncs.com', 'amazonaws.com', 'cloudfront.net'],
  printables: ['printables.com'],
  thingiverse: ['thingiverse.com', 'thingiverse-production-new.s3.amazonaws.com', 'thingiverse-production.s3.amazonaws.com']
};

function allowedHost(site) {
  const hosts = HOSTS[site] || [];
  return (raw) => {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && hosts.some((h) => host === h || host.endsWith(`.${h}`));
    } catch (_) {
      return false;
    }
  };
}

/** The file name a URL ends in, or null. */
function urlName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || null;
  } catch (_) {
    return null;
  }
}

/**
 * The model's pictures and files on its site: [{ url, name }]. A picture's own name is used when
 * it has a picture's extension (MakerWorld keeps the designer's names), else the URL's.
 */
function mediaOf(details) {
  const pictures = (details.pictureFiles && details.pictureFiles.length ? details.pictureFiles : (details.pictures || []).map((url) => ({ url, name: null })))
    .slice(0, MAX_PICTURES)
    .map((p) => ({ url: p.url, name: p.name && modelFolders.kindOf(p.name) === 'image' ? p.name : urlName(p.url), kind: 'image' }));
  // Details kept by an older version have the Printables PDF only as pdfUrl.
  const listed = details.attachments && details.attachments.length ? details.attachments : details.pdfUrl ? [{ url: details.pdfUrl, name: null }] : [];
  const attachments = listed.slice(0, MAX_ATTACHMENTS).map((a) => {
    const name = a.name && modelFolders.kindOf(a.name) ? a.name : urlName(a.url);
    return { url: a.url, name, kind: null };
  });
  return [...pictures, ...attachments];
}

/**
 * Save a downloaded model's pictures, documents and videos into its folder. Never throws: what
 * fails is listed. Answers { saved, failed, youtube }.
 * @param {string} folder The model's folder.
 * @param {{ site: string }} link
 * @param {any} details The site's details (site-model-details.js).
 * @param {{ fetchImpl?: Function | null, extraPictures?: { url: string, name: string | null }[] }} [options]
 */
async function saveSiteMedia(folder, link, details, { fetchImpl = null, extraPictures = [] } = {}) {
  const result = { saved: /** @type {string[]} */ ([]), failed: /** @type {string[]} */ ([]), youtube: 0 };
  try {
    modelFolders.register(folder);
  } catch (error) {
    result.failed.push(error.message);
    return result;
  }
  if (!details) return result;
  const items = mediaOf({ ...details, pictureFiles: [...(details.pictureFiles || []), ...extraPictures] });
  const host = allowedHost(link.site);
  /** @type {string | null} */
  let coverName = null;
  for (const item of items) {
    try {
      const name = await modelFolders.saveFromSite(folder, item.url, item.name, {
        fetchImpl,
        allowedHost: host,
        maxBytes: MAX_FILE_BYTES,
        kind: item.kind
      });
      if (name) {
        result.saved.push(name);
        if (!coverName && item.kind === 'image' && details.cover && sameImage(item.url, details.cover)) coverName = name;
      }
    } catch (error) {
      result.failed.push(`${item.name || urlName(item.url) || item.url}: ${error.message}`);
    }
  }
  const ids = Array.isArray(details.videos) ? details.videos.filter((id) => modelFolders.youtubeId(id)) : [];
  if (ids.length) {
    try {
      modelFolders.addYoutube(folder, ids);
      result.youtube = ids.length;
    } catch (error) {
      result.failed.push(error.message);
    }
  }
  await modelFolders.coverIfNone(folder, { preferred: coverName }).catch((error) => result.failed.push(`cover: ${error.message}`));
  if (result.failed.length) console.warn(`[Site media] ${path.basename(folder)}: ${result.failed.join('; ')}`);
  if (result.saved.length) console.log(`[Site media] ${path.basename(folder)}: saved ${result.saved.join(', ')}`);
  return result;
}

/** The same picture (sites add sizes and query strings). */
function sameImage(a, b) {
  const plain = (u) => {
    try {
      const url = new URL(u);
      return `${url.hostname}${url.pathname}`;
    } catch (_) {
      return u;
    }
  };
  return plain(a) === plain(b);
}

/**
 * A Thingiverse thing's pictures, largest display size ([{ url, name }]); needs the API token.
 * Empty when there is none or Thingiverse does not answer.
 * @returns {Promise<{ url: string, name: string | null }[]>}
 */
async function thingiversePictures(id, fetchImpl) {
  const siteFiles = require('./site-files');
  try {
    const images = await siteFiles.thingiverseJson(`/things/${encodeURIComponent(id)}/images`, fetchImpl || undefined);
    return (Array.isArray(images) ? images : [])
      .map((image) => {
        const sizes = Array.isArray(image && image.sizes) ? image.sizes : [];
        const pick = ['large', 'medium'].map((size) => sizes.find((s) => s && s.type === 'display' && s.size === size)).find(Boolean);
        const url = (pick && pick.url) || (image && image.url) || null;
        return url ? { url, name: image.name || null } : null;
      })
      .filter((picture) => picture !== null);
  } catch (_) {
    return [];
  }
}

module.exports = { HOSTS, allowedHost, mediaOf, saveSiteMedia, thingiversePictures };
