'use strict';

// What runs in the background (src/server/activity.js): the progress bars above Library Storage.

const assert = require('assert');
const events = require('../src/server/events');
const activity = require('../src/server/activity');

async function main() {
  const sent = [];
  events.setBroadcaster((channel, payload) => sent.push([channel, payload]));

  // Time left from the pace so far.
  const t0 = 1_000_000;
  assert.strictEqual(activity.etaOf({ done: 0, total: 100, startedAt: t0 }, t0 + 10000), null, 'nothing done yet');
  assert.strictEqual(activity.etaOf({ done: 50, total: 100, startedAt: t0 }, t0 + 1000), null, 'too early to tell');
  assert.strictEqual(activity.etaOf({ done: 25, total: 100, startedAt: t0 }, t0 + 10000), 30000, '25 in 10 s: 75 more take 30 s');
  assert.strictEqual(activity.etaOf({ done: 5, total: null, startedAt: t0 }, t0 + 10000), null, 'no total');

  // Jobs that call start / update / finish.
  const id = activity.start('scan', 'Scanning the library', { unit: 'files', detail: 'models' });
  activity.update(id, { done: 10 });
  let list = activity.list();
  assert.deepStrictEqual(
    list.map((j) => [j.kind, j.label, j.done, j.total, j.unit, j.detail]),
    [['scan', 'Scanning the library', 10, null, 'files', 'models']]
  );
  activity.finish(id);
  assert.deepStrictEqual(activity.list(), []);

  // track(): finished however it ends.
  await assert.rejects(
    activity.track('download', 'Downloading', { unit: 'bytes' }, async (progressed) => {
      progressed({ done: 5, total: 10 });
      assert.strictEqual(activity.list()[0].done, 5);
      throw new Error('lost');
    })
  );
  assert.deepStrictEqual(activity.list(), [], 'a failed job goes too');

  // Jobs followed from their own events.
  events.broadcast('ai-tag-job', { running: true, processed: 3, total: 12 });
  events.broadcast('geometry-progress', { running: true, processed: 1, total: 4 });
  events.broadcast('thumbnail-job-progress', { processed: 2, total: 9 });
  events.broadcast('category-scan', { running: true, phase: 'ai', aiDone: 4, aiTotal: 8 });
  list = activity.list();
  assert.deepStrictEqual(
    list.map((j) => [j.kind, j.done, j.total]),
    [
      ['ai-tagging', 3, 12],
      ['duplicates', 1, 4],
      ['thumbnails', 2, 9],
      ['categories', 4, 8]
    ]
  );
  assert.strictEqual(list.find((j) => j.kind === 'categories').detail, 'Asking the AI');
  events.broadcast('ai-tag-job', { running: false });
  events.broadcast('geometry-complete', {});
  events.broadcast('thumbnail-job-complete', {});
  events.broadcast('category-scan', { running: false });
  assert.deepStrictEqual(activity.list(), [], 'their end ends them');

  // The browsers hear about it.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const last = sent.filter(([channel]) => channel === 'background-activity').pop();
  assert.ok(last && Array.isArray(last[1]) && last[1].length === 0, JSON.stringify(last));

  // A backup reports the pages copied.
  const fakeDb = {
    backup: async (target, { progress }) => {
      progress({ totalPages: 10, remainingPages: 4 });
      assert.strictEqual(activity.list()[0].done, 6);
      return { totalPages: 10, remainingPages: 0 };
    }
  };
  await activity.backupDatabase(fakeDb, '/tmp/x.db', 'Backing up');
  assert.deepStrictEqual(activity.list(), []);

  activity.reset();
  events.setBroadcaster(null);
  console.log('activity tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
