#!/usr/bin/env node
'use strict';

// Puter that cannot answer is not retried, and a run stops at the first such answer (src/core/aitagging.js PUTER_STOP).

const assert = require('assert');
const aitagging = require('../src/core/aitagging');

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

(async () => {
  await test('the messages that stop a run', () => {
    for (const message of [
      'Not signed in to Puter: the sign-in was not finished within 2 minutes.',
      'Puter sign-in was cancelled.',
      'No JusttPrint page is open to ask Puter: keep one open.',
      'Puter did not answer in time: keep a JusttPrint page open.'
    ])
      assert.ok(aitagging.PUTER_STOP.test(message), message);
    assert.ok(!aitagging.PUTER_STOP.test('Network error: Unable to connect'), 'a network error is retried');
  });

  await test('"not signed in" is asked once, not retried', async () => {
    let calls = 0;
    aitagging.initializeOpenAI('', '', 'puter', async () => {
      calls++;
      throw new Error('Not signed in to Puter: the sign-in was not finished within 2 minutes.');
    });
    await assert.rejects(aitagging.generateTagsForImage('aGVsbG8=', 'gpt-5-nano', { maxTags: 3 }, 0, 5), /Not signed in to Puter/);
    assert.strictEqual(calls, 1);
  });

  await test('other Puter errors are still retried', async () => {
    let calls = 0;
    aitagging.initializeOpenAI('', '', 'puter', async () => {
      calls++;
      if (calls < 2) throw new Error('Network error');
      return '{"tags":["robot"]}';
    });
    const tags = await aitagging.generateTagsForImage('aGVsbG8=', 'gpt-5-nano', { maxTags: 3, useJsonResponse: true }, 0, 3);
    assert.strictEqual(calls, 2);
    assert.ok(tags.includes('robot'), JSON.stringify(tags));
  });
})();
