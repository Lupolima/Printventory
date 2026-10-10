'use strict';

/**
 * One question to the AI service set up under Settings → AI Tagging, with an optional picture:
 * the answer's text. Puter runs in the browser that asked (`puterHandler`); the others through
 * their OpenAI-compatible endpoints. Used by file name translation and the library's searches.
 */

const { OpenAI } = require('openai');

/**
 * @param {string} prompt
 * @param {{ aiSettings: any, puterHandler?: any, image?: string | null, maxTokens?: number, temperature?: number, client?: any }} options
 *   `image` a data URL; `client` replaces the OpenAI client (tests).
 */
async function askAi(prompt, { aiSettings, puterHandler = null, image = null, maxTokens = 1000, temperature = 0, client = null }) {
  const { apiKey, apiEndpoint, aiModel, aiService } = aiSettings || {};
  const service = String(aiService || 'openai').toLowerCase();
  if (service === 'puter') {
    if (!puterHandler) throw new Error('Puter runs in the browser: ask from a browser');
    const answer = await puterHandler(prompt, image, aiModel || 'gpt-5-nano');
    return typeof answer === 'string' ? answer : (answer && ((answer.message && answer.message.content) || answer.text || answer.content)) || '';
  }
  const { completionOptions, defaultBaseURLForService, defaultModelForService, requiresApiKey } = require('../core/aitagging');
  if (requiresApiKey(service, apiEndpoint) && !apiKey) throw new Error('The AI service has no API key (Settings → AI Tagging)');
  const endpoint = apiEndpoint && !/puter\.com/i.test(apiEndpoint) ? `${apiEndpoint.trim().replace(/\/+$/, '')}/` : defaultBaseURLForService(service);
  const openai =
    client ||
    new OpenAI({
      apiKey: apiKey || 'not-needed',
      baseURL: endpoint,
      timeout: 60000,
      maxRetries: 1,
      ...(service === 'claude' ? { defaultHeaders: { 'anthropic-version': '2023-06-01' } } : {})
    });
  const model = aiModel || defaultModelForService(service);
  const content = image
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: image } }
      ]
    : prompt;
  const reply = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    ...completionOptions(service, model, { maxTokens, temperature })
  });
  return (reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content) || '';
}

/** The first JSON array of strings in an answer, or throws. */
function parseList(answer) {
  const match = /\[[\s\S]*\]/.exec(String(answer || ''));
  /** @type {unknown} */
  let list;
  try {
    list = match ? JSON.parse(match[0]) : null;
  } catch (_) {
    list = null;
  }
  if (!Array.isArray(list)) throw new Error('The AI service did not answer with a list');
  return list.map((item) => String(item ?? ''));
}

module.exports = { askAi, parseList };
