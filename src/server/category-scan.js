'use strict';

/**
 * Categorize Library (the Categories page): gives every model without one its place, a Category
 * and a Subcategory (categories.js). First the category its site gives it (MakerWorld uses this
 * very list, so its models are placed for free). Then, with the AI, the AI service set up for AI
 * Tagging looks at each remaining model's picture and picks its Category and Subcategory, saved
 * right away; models placed earlier by a guess from words are looked at again. Without the AI,
 * the list's words in folder names, tags and model names place what they can ("Other …" when only
 * the Category is clear). `again` sorts every model again, except places a person chose. One run
 * at a time; every open page follows its progress.
 */

const events = require('./events');
const database = require('../core/database');
const categories = require('../core/categories');
const { linkKey, parseModelLink } = require('../core/link-import');

/** Site details fetched at once (the rest of the free step is quick). */
const SITE_CONCURRENCY = 4;

/** @type {any} */
let job = null;
let nextId = 1;

/** What every page shows (the AI's picks go with snapshot()). */
function summary() {
  if (!job) return null;
  return {
    id: job.id,
    by: job.by,
    running: job.running,
    stopping: job.stopping,
    phase: job.phase,
    useAi: job.useAi,
    total: job.total,
    processed: job.processed,
    placed: job.placed,
    left: job.left,
    aiTotal: job.aiTotal,
    aiDone: job.aiDone,
    aiPlacedCount: job.aiPlaced.length,
    noPicture: job.noPicture,
    again: job.again,
    error: job.error
  };
}

let lastAnnounce = 0;
function announce(force = false) {
  if (!force && Date.now() - lastAnnounce < 300) return;
  lastAnnounce = Date.now();
  events.broadcast('category-scan', summary());
}

/** The run with what the AI placed: { ...summary, aiPlaced: [{ filePath, fileName, category, subcategory }] }, or null. */
function snapshot() {
  if (!job) return null;
  return { ...summary(), aiPlaced: job.aiPlaced.map((s) => ({ ...s })) };
}

const running = () => !!(job && job.running);

/** Whether the AI service in Settings → AI Tagging can be asked (a key where one is needed). */
function aiReady() {
  try {
    const settings = require('./ipc/ai').getAISettings();
    const aitagging = require('../core/aitagging');
    return !aitagging.requiresApiKey(settings.aiService, settings.apiEndpoint) || !!String(settings.apiKey || '').trim();
  } catch (_) {
    return false;
  }
}

/** The categories a model's site gives it: kept details, else fetched (without translating file names). */
async function siteCategories(model, fetchImpl) {
  const link = parseModelLink(model.source || '') || (model.filePath.startsWith('url::') ? parseModelLink(model.filePath.slice(5)) : null);
  if (!link) return [];
  const siteDetails = require('./site-details');
  const row = siteDetails.siteFilesTable().prepare('SELECT data FROM site_details WHERE key = ?').get(linkKey(link));
  try {
    if (row) return JSON.parse(row.data).categories || [];
    const result = await siteDetails.getDetails(link.url, { translate: false, ...(fetchImpl ? { fetchImpl } : {}) });
    return (result && result.details && result.details.categories) || [];
  } catch (_) {
    return [];
  }
}

/** Run `work` over `items`, `limit` at a time, until done or stopped. */
async function eachLimited(items, limit, work) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !job.stopping) {
      const item = items[next++];
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** At most this many of the AI's places are listed on the Categories page (to check them). */
const MAX_LISTED = 500;

/** The free step: the site's category, and without the AI the list's words. Answers the models left for the AI. */
async function freeStep(models, list, fetchImpl) {
  const tagsOf = database.db.prepare('SELECT t.name FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = ?');
  const left = [];
  await eachLimited(models, SITE_CONCURRENCY, async (model) => {
    const hint = model.hint ? categories.findCategory(model.hint, list) : null;
    let match = categories.freeMatches(
      {
        siteCategories: await siteCategories(model, fetchImpl),
        filePath: model.filePath,
        fileName: model.fileName,
        tags: tagsOf.all(model.id).map((row) => row.name)
      },
      list,
      { words: !job.useAi }
    );
    // A Category a person chose stays: only its Subcategories count.
    if (match && hint && match.category.id !== hint.id) match = null;
    let place = match ? match.subcategory : null;
    const source = match ? match.source : null;
    if (!place && match && !job.useAi) {
      // Only the Category is clear: its "Other …" Subcategory.
      place = categories.otherOf(match.category, list);
    }
    if (place) {
      categories.setModelPlace(model.id, place.name, source);
      job.placed[source] = (job.placed[source] || 0) + 1;
    } else {
      left.push({ ...model, main: (match && match.category) || hint || null });
    }
    job.processed++;
    announce();
  });
  return left;
}

const AI_PROMPT =
  'You are sorting 3D printable models in a library. Look at this picture of a model and name what it is in one or two words in the "tags" list. ';

async function aiStep(models, list, event, ask) {
  const settings = require('./ipc/ai').getAISettings();
  const aitagging = require('../core/aitagging');
  const { getThumbnailImagePayload } = require('../core/thumbnails');
  const { getModelByFilePath } = require('../core/models');
  if (!ask) {
    const puter = settings.aiService === 'puter' ? require('./ipc/ai').createPuterIPCHandler(event || {}) : null;
    aitagging.initializeOpenAI(settings.apiKey, settings.apiEndpoint, settings.aiService, puter);
    ask = (base64, options, filePath) => aitagging.generateTagsForImage(base64, settings.aiModel, options, 1000, 3, filePath);
  }
  const byId = new Map(list.map((c) => [c.id, c]));
  const concurrency = Math.max(1, Math.min(Number(settings.aiTagConcurrency) || 3, 10));
  await eachLimited(models, concurrency, async (model) => {
    if (job.error) return;
    const full = getModelByFilePath(model.filePath, { includeThumbnail: true });
    const picture = full && full.thumbnail ? getThumbnailImagePayload(full.thumbnail) : null;
    if (!picture) {
      job.noPicture++;
    } else {
      try {
        const answer = await ask(
          picture.base64,
          {
            customPrompt: AI_PROMPT,
            maxTags: 2,
            useJsonResponse: true,
            mimeType: picture.mimeType,
            folderLevels: settings.aiTagFolderLevels,
            notes: full.notes || '',
            categoryChoices: categories.aiChoices(list, model.main)
          },
          model.filePath
        );
        const sub = categories.matchAiCategory(answer && answer.category, list);
        if (sub && (!model.main || sub.parent_id === model.main.id)) {
          categories.setModelPlace(model.id, sub.name, 'ai');
          job.placed.ai = (job.placed.ai || 0) + 1;
          if (job.aiPlaced.length < MAX_LISTED) {
            job.aiPlaced.push({
              filePath: model.filePath,
              fileName: model.fileName || model.filePath.split(/[\\/]/).pop(),
              category: byId.get(sub.parent_id).name,
              subcategory: sub.name
            });
          }
        }
      } catch (error) {
        // A rate limit or a failed sign-in stops the AI step; what was placed so far stays.
        if (/rate limit|authentication|api key/i.test(error.message || '')) job.error = error.message;
        else console.warn(`[Categories] AI could not categorize ${model.filePath}: ${error.message}`);
      }
    }
    job.aiDone++;
    announce();
  });
}

/**
 * The models a run looks at: without a Subcategory; with the AI also those placed by a guess from
 * words; with `again` every model except the ones a person placed. `hint` is a Category a person
 * chose alone.
 */
function modelsToSort({ useAi, again }) {
  categories.ensureTables();
  const places = new Map();
  for (const row of database.db
    .prepare('SELECT mc.model_id, c.name, c.parent_id, mc.source FROM model_categories mc JOIN categories c ON c.id = mc.category_id')
    .all()) {
    const place = places.get(row.model_id) || { main: null, sub: null, source: null };
    if (row.parent_id) place.sub = row.name;
    else place.main = row.name;
    place.source = row.source;
    places.set(row.model_id, place);
  }
  return database.db
    .prepare('SELECT id, filePath, fileName, source FROM models')
    .all()
    .filter((model) => {
      const place = places.get(model.id);
      if (!place || !place.sub) {
        model.hint = place && place.source === 'manual' ? place.main : null;
        return true;
      }
      if (place.source === 'manual') return false;
      if (again) return true;
      return useAi && categories.GUESSES.includes(place.source);
    });
}

/**
 * Start a run: { useAi } asks the AI about the models the free step leaves, { again } sorts every
 * model again (not the places a person chose). Answers the summary, or null while another run is
 * going. `deps.fetchImpl` and `deps.ask` replace the network and the AI service (tests).
 * @param {{ by?: string | null, useAi?: boolean, again?: boolean, event?: any }} [options]
 * @param {{ fetchImpl?: Function, ask?: Function }} [deps]
 */
function start({ by = null, useAi = false, again = false, event = null } = {}, deps = {}) {
  if (running()) return null;
  const models = modelsToSort({ useAi, again });
  job = {
    id: nextId++,
    by,
    useAi: !!useAi,
    again: !!again,
    running: true,
    stopping: false,
    phase: 'free',
    total: models.length,
    processed: 0,
    placed: {},
    left: 0,
    aiTotal: 0,
    aiDone: 0,
    noPicture: 0,
    aiPlaced: [],
    error: null
  };
  const current = job;
  const list = categories.listCategories();
  job.promise = (async () => {
    try {
      const left = await freeStep(models, list, deps.fetchImpl);
      current.left = left.length;
      if (current.useAi && left.length && !current.stopping) {
        current.phase = 'ai';
        current.aiTotal = left.length;
        announce(true);
        await aiStep(left, list, event, deps.ask);
        current.left = categories.uncategorizedCount();
      }
    } catch (error) {
      console.error('[Categories] Categorize Library failed:', error);
      current.error = error.message;
    } finally {
      current.running = false;
      current.phase = 'done';
      announce(true);
      events.broadcast('refresh-grid');
      events.broadcast('categories-changed');
    }
  })();
  announce(true);
  return summary();
}

function stop() {
  if (!running()) return false;
  job.stopping = true;
  announce(true);
  return true;
}

/** Close a finished run. */
function dismiss() {
  if (!job || job.running) return false;
  job = null;
  announce(true);
  return true;
}

/**
 * After the list changed (an update), sort every model once with what is free (no AI: it costs);
 * the Categories page offers the AI for the rest.
 */
async function resortIfPending() {
  const row = database.db && database.db.prepare("SELECT value FROM settings WHERE key = 'categoriesResort'").get();
  if (!row || row.value !== '1' || running()) return false;
  const started = start({ by: 'JusttPrint', useAi: false });
  if (!started) return false;
  await job.promise;
  database.db.prepare("DELETE FROM settings WHERE key = 'categoriesResort'").run();
  console.log(`[Categories] Sorted the library into the new categories: ${JSON.stringify(job.placed)}; ${job.left} left for the AI`);
  return true;
}

module.exports = { aiReady, dismiss, resortIfPending, snapshot, start, stop, running, summary, _job: () => job };
