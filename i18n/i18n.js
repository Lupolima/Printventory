// Tradução da interface (tela) do Printventory.
//
// Fica por cima do código original: não altera nenhum texto no código-fonte.
// Quando o idioma escolhido não é inglês, percorre a página e troca os textos
// conhecidos pela tradução do dicionário, e continua observando a página para
// traduzir o que aparecer depois (janelas, listas, mensagens).
(function () {
  'use strict';

  const STORAGE_KEY = 'printventory-language';
  const COOKIE_NAME = 'printventory-language';
  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'pt-BR', label: 'Português (Brasil)' },
  ];
  const DICTIONARIES = { 'pt-BR': window.PRINTVENTORY_I18N_PT_BR };

  // Atributos com texto visível (dicas, campos vazios, leitores de tela).
  const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt', 'data-tooltip'];
  // Conteúdo do usuário ou código: nunca traduzir.
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT', 'KBD']);
  // Textos que o código original compara depois de escrever na tela.
  const KEEP_ORIGINAL = new Set(['Copied']);

  function readCookie() {
    try {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (_) {
      return null;
    }
  }

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function isSupported(code) {
    return LANGUAGES.some((l) => l.code === code);
  }

  function storeLanguage(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (_) { /* sem armazenamento */ }
    try {
      document.cookie = COOKIE_NAME + '=' + encodeURIComponent(code) + '; path=/; max-age=315360000; SameSite=Lax';
    } catch (_) { /* página file:// não tem cookies */ }
  }

  // O cookie vem do processo principal (desktop) e vale para qualquer porta;
  // o localStorage cobre o modo servidor aberto num navegador.
  let language = [readCookie(), readStored()].find(isSupported) || 'en';
  let translator = null;
  let observer = null;
  const applied = new WeakMap(); // nó → último texto que nós escrevemos

  function skipElement(el) {
    return SKIP_TAGS.has(el.tagName) || el.isContentEditable || el.hasAttribute('data-no-i18n');
  }

  function insideSkipped(node) {
    for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
      if (skipElement(el)) return true;
    }
    return false;
  }

  function translateTextNode(node) {
    const value = node.nodeValue;
    if (!value || applied.get(node) === value) return;
    const key = value.trim();
    if (KEEP_ORIGINAL.has(key)) return;
    const out = translator.translate(value);
    if (out !== null && out !== value) {
      applied.set(node, out);
      node.nodeValue = out;
    }
  }

  function translateAttributes(el) {
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const out = translator.translate(value);
      if (out !== null && out !== value) el.setAttribute(name, out);
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      const out = translator.translate(el.value);
      if (out !== null && out !== el.value) el.value = out;
    }
  }

  function translateTree(root) {
    if (root.nodeType === 3) {
      if (!insideSkipped(root)) translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (insideSkipped(root)) return;
      translateAttributes(root);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === 1) return skipElement(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) translateTextNode(node);
      else translateAttributes(node);
    }
  }

  function onMutations(mutations) {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) translateTree(n);
      } else if (m.type === 'characterData') {
        if (!insideSkipped(m.target)) translateTextNode(m.target);
      } else if (m.type === 'attributes' && m.target.nodeType === 1) {
        if (!insideSkipped(m.target)) translateAttributes(m.target);
      }
    }
  }

  function wrapDialogs() {
    for (const name of ['alert', 'confirm', 'prompt']) {
      const original = window[name];
      if (typeof original !== 'function') continue;
      window[name] = function (message, ...rest) {
        return original.call(window, translator ? translator.translateMessage(String(message ?? '')) : message, ...rest);
      };
    }
  }

  function start() {
    const dict = DICTIONARIES[language];
    if (!dict || !window.PrintventoryTranslator) return;
    translator = window.PrintventoryTranslator.createTranslator(dict);
    document.documentElement.lang = language;
    wrapDialogs();
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES.concat(['value']),
    });
    translateTree(document.documentElement);
    // Os textos do <title> e o que já existir quando a página terminar de carregar.
    document.addEventListener('DOMContentLoaded', () => translateTree(document.documentElement), { once: true });
  }

  // Troca o idioma e recarrega a página (o jeito mais seguro de voltar ao inglês).
  function setLanguage(code) {
    if (!isSupported(code)) return;
    storeLanguage(code);
    if (code !== language) location.reload();
  }

  // Chamado pelo processo principal quando a página abre, para alinhar o idioma
  // nas janelas que não conseguem ler o cookie.
  function syncLanguage(code) {
    if (!isSupported(code)) return;
    storeLanguage(code);
    if (code === language) return;
    if (language === 'en' && !translator) {
      language = code;
      start();
    } else if (document.visibilityState === 'visible') {
      // Janelas ocultas (a que gera miniaturas) não são recarregadas no meio de um trabalho.
      location.reload();
    }
  }

  // Seletor de idioma na janela "Configurações de tema" (também funciona no modo servidor).
  function addLanguagePicker() {
    const dialog = document.getElementById('settings-dialog');
    if (!dialog || dialog.querySelector('#printventory-language-select')) return;
    const content = dialog.querySelector('h3');
    if (!content) return;

    const group = document.createElement('div');
    group.className = 'form-group';
    group.setAttribute('data-no-i18n', '');
    const label = document.createElement('label');
    label.htmlFor = 'printventory-language-select';
    label.textContent = 'Idioma / Language:';
    const select = document.createElement('select');
    select.id = 'printventory-language-select';
    for (const l of LANGUAGES) {
      const option = document.createElement('option');
      option.value = l.code;
      option.textContent = l.label;
      option.selected = l.code === language;
      select.appendChild(option);
    }
    select.addEventListener('change', () => setLanguage(select.value));
    const description = document.createElement('div');
    description.className = 'setting-description';
    description.textContent = 'O app recarrega ao trocar o idioma. / The app reloads when you change the language.';
    group.append(label, select, description);
    content.insertAdjacentElement('afterend', group);
  }

  window.PrintventoryI18n = {
    languages: LANGUAGES.slice(),
    getLanguage: () => language,
    setLanguage,
    syncLanguage,
    translate: (text) => (translator ? translator.translateMessage(text) : text),
  };

  if (language !== 'en') start();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLanguagePicker, { once: true });
  else addLanguagePicker();
})();
