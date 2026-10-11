'use strict';

// Google Cloud Translation (src/server/google-translate.js) and the translators in order (src/server/translate.js).

const assert = require('assert');
const Database = require('better-sqlite3');
const database = require('../src/core/database');
const google = require('../src/server/google-translate');
const translate = require('../src/server/translate');

const KEY = 'AIzaSyTESTtestTESTtestTESTtestTEST1234';

async function main() {
  database.db = new Database(':memory:');
  database.db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  const set = (key, value) => database.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  const notes = () =>
    database.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get()
      ? database.db.prepare('SELECT title, body FROM notifications ORDER BY id').all()
      : [];

  // --- Google's month is Pacific time ---
  assert.deepStrictEqual(google.billingMonth(new Date('2026-11-01T06:30:00Z')), { month: '2026-10', label: 'October', daysLeft: 1, resetsOn: '2026-11-01' });
  assert.deepStrictEqual(google.billingMonth(new Date('2026-11-01T08:30:00Z')), { month: '2026-11', label: 'November', daysLeft: 30, resetsOn: '2026-12-01' });
  assert.strictEqual(google.billingMonth(new Date('2026-12-15T20:00:00Z')).resetsOn, '2027-01-01');

  // --- Requests Google takes ---
  const many = google.requestsOf(Array.from({ length: 200 }, () => 'x'));
  assert.deepStrictEqual(
    many.map((b) => b.length),
    [128, 72]
  );
  assert.deepStrictEqual(
    google.requestsOf(['a'.repeat(3000), 'b'.repeat(3000), 'c']).map((b) => b.length),
    [1, 2]
  );

  // --- Translating, counting, warning ---
  const sent = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    sent.push({ key: new URL(url).searchParams.get('key'), body });
    return new Response(JSON.stringify({ data: { translations: body.q.map((q) => ({ translatedText: `EN(${q}) &amp; more` })) } }));
  };
  await assert.rejects(google.translateGoogle(['腿部'], { fetchImpl }), /no API key/);
  await assert.rejects(google.setKey('short', { fetchImpl }), /does not look like/);
  const status = await google.setKey(KEY, { fetchImpl });
  assert.strictEqual(status.hasKey, true);
  assert.strictEqual(status.keyHint, '…1234');
  assert.strictEqual(status.used, 0, 'checking the key is not counted');
  assert.deepStrictEqual(sent[0].body, { q: ['Hola'], target: 'en', format: 'text' });

  const now = new Date('2026-10-10T18:00:00Z');
  set(google.FREE_SETTING, '100');
  assert.deepStrictEqual(await google.translateGoogle(['腿部', '武器'], { fetchImpl, now }), ['EN(腿部) & more', 'EN(武器) & more']);
  assert.strictEqual(google.status(now).used, 4);
  assert.deepStrictEqual(notes(), [], 'no warning yet');
  await google.translateGoogle(['x'.repeat(78)], { fetchImpl, now });
  assert.deepStrictEqual(
    notes().map((n) => n.title),
    ["Google Translate: 80% of this month's free characters used"]
  );
  assert.match(notes()[0].body, /82 of 100 free characters used in October.*resets in 22 days \(2026-11-01\)/);
  await google.translateGoogle(['y'.repeat(14)], { fetchImpl, now });
  await google.translateGoogle(['z'.repeat(4)], { fetchImpl, now });
  assert.deepStrictEqual(
    notes().map((n) => n.title),
    [
      "Google Translate: 80% of this month's free characters used",
      "Google Translate: 95% of this month's free characters used",
      "Google Translate's free characters are used up"
    ]
  );
  assert.strictEqual(google.status(now).stopped, true);
  await assert.rejects(
    google.translateGoogle(['more'], { fetchImpl, now }),
    (error) => error.code === 'GOOGLE_LIMIT' && /resets in 22 days/.test(error.message)
  );
  // The same warning is not given twice in a month.
  await google.translateGoogle([], { fetchImpl, now });
  assert.strictEqual(notes().length, 3);

  // Pay: Google is used past the free characters.
  set(google.AT_LIMIT_SETTING, 'pay');
  assert.strictEqual(google.status(now).stopped, false);
  assert.deepStrictEqual(await google.translateGoogle(['more'], { fetchImpl, now }), ['EN(more) & more']);
  // A new month starts again.
  set(google.AT_LIMIT_SETTING, 'stop');
  assert.strictEqual(google.status(new Date('2026-11-02T18:00:00Z')).used, 0);

  // Google refuses: its message is passed on.
  const refuse = async () => new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 });
  await assert.rejects(google.translateGoogle(['腿部'], { fetchImpl: refuse, now: new Date('2026-12-02T18:00:00Z') }), /API key not valid/);

  // Long texts go in pieces, line breaks kept.
  set(google.FREE_SETTING, '1000000');
  const long = Array.from({ length: 30 }, (_, i) => `第${i}行${'很'.repeat(300)}`).join('\n');
  sent.length = 0;
  const english = await google.translateLongText(long, { fetchImpl, now: new Date('2026-12-02T18:00:00Z') });
  assert.ok(sent.length >= 1 && sent.every((r) => r.body.q.every((q) => [...q].length <= 5000)));
  assert.strictEqual(english.split('\n').length, 30);

  // --- The translators in order: the next one when one fails ---
  assert.deepStrictEqual(translate.orderFrom('["google","free","nope"]', 'ai'), ['google', 'free']);
  assert.deepStrictEqual(translate.orderFrom(null, 'off'), []);
  assert.deepStrictEqual(translate.orderFrom(null, null), ['free']);
  assert.strictEqual(translate.orderKey([]), 'off');
  const memory = async (url) => {
    if (url.includes('googleapis')) return refuse();
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'Legs' } }));
  };
  assert.deepStrictEqual(await translate.translateNames(['腿部'], ['google', 'free'], { fetchImpl: memory }), { english: ['Legs'], by: 'free', error: null });
  const none = await translate.translateNames(['腿部'], ['google'], { fetchImpl: memory });
  assert.strictEqual(none.by, null);
  assert.match(none.error, /API key not valid/);

  // Removing the key.
  assert.strictEqual((await google.setKey('')).hasKey, false);
  console.log('google-translate tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
