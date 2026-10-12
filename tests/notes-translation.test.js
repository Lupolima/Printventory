'use strict';

// English for notes in another language (src/server/notes-translation.js).

const assert = require('assert');
const Database = require('better-sqlite3');
const database = require('../src/core/database');
const notes = require('../src/server/notes-translation');

async function main() {
  database.db = new Database(':memory:');
  database.db.exec(
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, notes TEXT, description TEXT); INSERT INTO settings VALUES ('makerWorldTranslation', 'free')"
  );

  // --- Which notes need English ---
  const chinese = '为我助力钢索是《变形金刚》系列电影中极具人气的角色。\n\nPrint at 0.2 mm.';
  assert.strictEqual(notes.notesNeedTranslation(chinese), true);
  assert.strictEqual(notes.notesNeedTranslation('Print the lions first. Ölfarben, ça va.'), false, 'Latin script is not translated');
  assert.strictEqual(
    notes.notesNeedTranslation('Voltron 战神金刚 kit, five lions, print in PLA with supports.'),
    false,
    'a few foreign letters in English notes'
  );
  assert.strictEqual(notes.notesNeedTranslation(`English${notes.ORIGINAL_MARK}中文说明中文说明`), false, 'already has its English');
  assert.strictEqual(notes.notesNeedTranslation(''), false);

  // --- Long lines go in pieces the free service takes ---
  const long = '这是一个很长的句子。'.repeat(40);
  const parts = notes.pieces(long);
  assert.ok(parts.length > 1 && parts.every((p) => Buffer.byteLength(p, 'utf8') <= 450));
  assert.strictEqual(parts.join(''), long);

  // --- The free service: line by line, English lines kept, kept for next time ---
  const asked = [];
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams.get('q');
    asked.push(q);
    const english = q
      .split('\n')
      .map(() => 'Grimlock is a popular character.')
      .join('\n');
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: english } }));
  };
  const first = await notes.translateText(chinese, { fetchImpl });
  assert.deepStrictEqual(first, { english: 'Grimlock is a popular character.\n\nPrint at 0.2 mm.', by: 'free', error: null });
  assert.strictEqual(asked.length, 1);
  assert.ok(!asked[0].includes('Print at'), 'English lines are not sent');
  await notes.translateText(chinese, { fetchImpl });
  assert.strictEqual(asked.length, 1, 'translated once');

  // Failures do not throw; off translates nothing.
  const quota = async () => new Response(JSON.stringify({ responseStatus: 429, responseDetails: 'YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' }));
  const failed = await notes.translateText('另一个说明文字很长', { fetchImpl: quota });
  assert.strictEqual(failed.english, null);
  assert.match(failed.error, /FREE TRANSLATIONS/);
  database.db.prepare("UPDATE settings SET value = 'off'").run();
  assert.deepStrictEqual(await notes.translateText('另一个说明文字很长', { fetchImpl }), { english: null, by: null, error: null });

  // --- The AI service ---
  database.db.prepare("UPDATE settings SET value = 'ai'").run();
  const ai = await notes.translateText('第三个说明文字很长', {
    aiSettings: { aiService: 'openai', apiKey: 'k' },
    ask: async (prompt) => (prompt.includes('第三个') ? 'The third note.' : '')
  });
  assert.deepStrictEqual(ai, { english: 'The third note.', by: 'ai', error: null });

  // --- A new model's description: saved in English with the original under it ---
  database.db.prepare("UPDATE settings SET value = 'free'").run();
  database.db.prepare('INSERT INTO models (id, filePath, description) VALUES (1, ?, ?), (2, ?, ?)').run('/l/a.3mf', chinese, '/l/b.3mf', 'Already English.');
  notes._queue.push(1, 2);
  await notes.work({ fetchImpl });
  assert.strictEqual(
    database.db.prepare('SELECT description FROM models WHERE id = 1').get().description,
    `Grimlock is a popular character.\n\nPrint at 0.2 mm.${notes.ORIGINAL_MARK}${chinese}`
  );
  assert.strictEqual(database.db.prepare('SELECT description FROM models WHERE id = 2').get().description, 'Already English.');
  assert.deepStrictEqual(await notes.englishForModel('/l/a.3mf', { fetchImpl }), { english: null, by: null, error: null }, 'nothing more to show');

  console.log('notes-translation tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
