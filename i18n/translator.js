// Núcleo de tradução compartilhado entre o processo principal (main) e a tela (renderer).
// Recebe um dicionário { 'texto em inglês': 'tradução' } e devolve translate(texto),
// que retorna a tradução ou null quando o texto não está no dicionário.
(function (root) {
  'use strict';

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PLACEHOLDER = /\{(\d+)\}/g;
  const CACHE_LIMIT = 20000;

  function createTranslator(dict) {
    const exact = new Map();
    const patterns = [];

    for (const [en, pt] of Object.entries(dict || {})) {
      if (typeof pt !== 'string' || en === pt) continue;
      if (!/\{\d+\}/.test(en)) {
        exact.set(norm(en), pt);
        continue;
      }
      // Modelos com {0}, {1}...: só entram se tiverem texto fixo suficiente
      // para não casar com qualquer coisa ("{0} {1}", "HTTP {0}" ficam de fora).
      const literal = en.replace(PLACEHOLDER, ' ');
      if ((literal.match(/[A-Za-z]/g) || []).length < 4) continue;
      const key = norm(en);
      const order = [];
      let src = '^';
      let last = 0;
      const literalRe = (s) => escapeRe(s).replace(/ /g, '\\s+');
      key.replace(PLACEHOLDER, (m, n, offset) => {
        src += literalRe(key.slice(last, offset));
        const prev = key[offset - 1];
        // "model{1}" é o "s" do plural em inglês: captura só "s" ou "es".
        src += prev && /[A-Za-z]/.test(prev) ? '((?:e?s)?)' : '(.*?)';
        order.push(n);
        last = offset + m.length;
        return m;
      });
      src += literalRe(key.slice(last)) + '$';
      // Trecho fixo mais longo: teste rápido antes de rodar a expressão regular.
      const anchor = literal.split(/\s{2,}|\{\d+\}/).map((s) => s.trim())
        .sort((a, b) => b.length - a.length)[0] || '';
      patterns.push({ re: new RegExp(src, 's'), order, pt, anchor, weight: literal.length });
    }
    patterns.sort((a, b) => b.weight - a.weight);

    // Textos que já são traduções nunca são traduzidos de novo.
    const outputs = new Set(Object.values(dict || {}).map(norm));
    const cache = new Map();

    // key: texto com espaços normalizados; raw: texto original (mantém quebras
    // de linha dentro dos pedaços variáveis, como listas de arquivos).
    function lookup(key, raw) {
      const hit = exact.get(key);
      if (hit !== undefined) return hit;
      for (const p of patterns) {
        if (p.anchor && !key.includes(p.anchor)) continue;
        const m = p.re.exec(raw);
        if (!m) continue;
        return p.pt.replace(PLACEHOLDER, (_, n) => {
          const i = p.order.indexOf(n);
          const v = i >= 0 && m[i + 1] !== undefined ? m[i + 1] : '';
          const inner = v.length > 1 ? exact.get(norm(v)) : undefined;
          return inner !== undefined ? inner : v;
        });
      }
      // "Prefixo: detalhe" → traduz só o prefixo (ex.: "Failed to save: disco cheio").
      const colon = key.indexOf(': ');
      if (colon > 0) {
        const head = exact.get(key.slice(0, colon + 1));
        if (head !== undefined) return head + key.slice(colon + 1);
      }
      return null;
    }

    function translate(text) {
      if (typeof text !== 'string') return null;
      const key = norm(text);
      if (!key || !/[A-Za-z]{2}/.test(key)) return null;
      if (outputs.has(key) && !exact.has(key)) return null;
      let out;
      const cacheKey = text.includes('\n') ? text.trim() : key;
      if (cache.has(cacheKey)) {
        out = cache.get(cacheKey);
      } else {
        out = lookup(key, text.trim());
        if (cache.size > CACHE_LIMIT) cache.clear();
        cache.set(cacheKey, out);
        if (out !== null) outputs.add(norm(out));
      }
      if (out === null) return null;
      const lead = text.match(/^\s*/)[0];
      const trail = text.match(/\s*$/)[0];
      return lead + out + trail;
    }

    // Mensagens com várias linhas (alert, confirm, caixas de diálogo):
    // tenta a mensagem inteira e, se não achar, linha por linha.
    function translateMessage(text) {
      if (typeof text !== 'string') return text;
      const whole = translate(text);
      if (whole !== null) return whole;
      if (!text.includes('\n')) return text;
      return text.split('\n').map((line) => {
        const t = translate(line);
        return t === null ? line : t;
      }).join('\n');
    }

    return { translate, translateMessage };
  }

  const api = { createTranslator };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrintventoryTranslator = api;
})(typeof window !== 'undefined' ? window : globalThis);
