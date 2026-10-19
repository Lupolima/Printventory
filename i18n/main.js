// Tradução do processo principal do Printventory (menus nativos e caixas de diálogo).
//
// Basta um require('./i18n/main') logo no começo do main.js. Este módulo:
//  - traduz os menus montados com Menu.buildFromTemplate;
//  - adiciona "Idioma / Language" ao menu Configurações;
//  - traduz títulos, mensagens e botões das caixas de diálogo nativas;
//  - mantém o idioma das janelas alinhado com a escolha do usuário.
const { app, Menu, dialog, session, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { createTranslator } = require('./translator');

const COOKIE_NAME = 'printventory-language';
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
];
const DICTIONARIES = { 'pt-BR': require('./pt-BR') };

// Itens de menu com "role" usam rótulos prontos em inglês do Electron.
const ROLE_LABELS = {
  'pt-BR': {
    undo: 'Desfazer', redo: 'Refazer', cut: 'Recortar', copy: 'Copiar', paste: 'Colar',
    pasteandmatchstyle: 'Colar sem formatação', delete: 'Excluir', selectall: 'Selecionar tudo',
    quit: 'Sair', reload: 'Recarregar', forcereload: 'Forçar recarregamento',
    toggledevtools: 'Ferramentas do desenvolvedor', togglefullscreen: 'Tela cheia',
    resetzoom: 'Tamanho original', zoomin: 'Aumentar zoom', zoomout: 'Diminuir zoom',
    minimize: 'Minimizar', close: 'Fechar', about: 'Sobre', hide: 'Ocultar',
    hideothers: 'Ocultar outros', unhide: 'Mostrar tudo', front: 'Trazer tudo para a frente',
    window: 'Janela', help: 'Ajuda', editmenu: 'Editar', viewmenu: 'Exibir', windowmenu: 'Janela',
  },
};

let language = null;
let translator = null;
let lastAppTemplate = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'language.json');
}

function getLanguage() {
  if (language) return language;
  language = 'en';
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).language;
    if (LANGUAGES.some((l) => l.code === saved)) language = saved;
  } catch (_) { /* primeira execução: inglês */ }
  return language;
}

function getTranslator() {
  const code = getLanguage();
  if (!DICTIONARIES[code]) return null;
  if (!translator || translator.code !== code) {
    translator = Object.assign(createTranslator(DICTIONARIES[code]), { code });
  }
  return translator;
}

function t(text) {
  const tr = getTranslator();
  return tr && typeof text === 'string' ? tr.translateMessage(text) : text;
}

// ------------------------------------------------------------------ Menus

function localizeItems(items) {
  const roles = ROLE_LABELS[getLanguage()] || {};
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const copy = { ...item };
    if (copy.label) copy.label = t(copy.label);
    else if (copy.role && roles[String(copy.role).toLowerCase()]) copy.label = roles[String(copy.role).toLowerCase()];
    if (copy.sublabel) copy.sublabel = t(copy.sublabel);
    if (copy.toolTip) copy.toolTip = t(copy.toolTip);
    if (Array.isArray(copy.submenu)) copy.submenu = localizeItems(copy.submenu);
    return copy;
  });
}

function languageMenuItem() {
  return {
    label: 'Idioma / Language',
    submenu: LANGUAGES.map((l) => ({
      label: l.label,
      type: 'radio',
      checked: l.code === getLanguage(),
      click: () => setLanguage(l.code),
    })),
  };
}

// O menu principal é o que tem "Settings" no topo: é lá que entra o seletor de idioma.
function withLanguageMenu(template) {
  const index = template.findIndex((item) => item && item.label === 'Settings' && Array.isArray(item.submenu));
  if (index === -1) return null;
  const copy = template.slice();
  copy[index] = {
    ...template[index],
    submenu: [...template[index].submenu, { type: 'separator' }, languageMenuItem()],
  };
  return copy;
}

const originalBuildFromTemplate = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = function (template) {
  if (!Array.isArray(template)) return originalBuildFromTemplate(template);
  const withLanguage = withLanguageMenu(template);
  if (withLanguage) lastAppTemplate = template;
  return originalBuildFromTemplate(localizeItems(withLanguage || template));
};

function rebuildAppMenu() {
  if (lastAppTemplate) Menu.setApplicationMenu(Menu.buildFromTemplate(lastAppTemplate));
}

// ------------------------------------------------------- Caixas de diálogo

function localizeMessageOptions(options) {
  if (!options || typeof options !== 'object') return options;
  const copy = { ...options };
  for (const key of ['title', 'message', 'detail', 'checkboxLabel']) {
    if (typeof copy[key] === 'string') copy[key] = t(copy[key]);
  }
  if (Array.isArray(copy.buttons)) copy.buttons = copy.buttons.map((b) => t(b));
  return copy;
}

function localizeFileOptions(options) {
  if (!options || typeof options !== 'object') return options;
  const copy = { ...options };
  for (const key of ['title', 'buttonLabel', 'message', 'nameFieldLabel']) {
    if (typeof copy[key] === 'string') copy[key] = t(copy[key]);
  }
  if (Array.isArray(copy.filters)) copy.filters = copy.filters.map((f) => ({ ...f, name: t(f.name) }));
  return copy;
}

// As funções aceitam (janela, opções) ou só (opções).
function wrapDialog(name, localize) {
  const original = dialog[name];
  if (typeof original !== 'function') return;
  dialog[name] = function (...args) {
    const i = args[0] && typeof args[0].isDestroyed === 'function' ? 1 : 0;
    args[i] = localize(args[i]);
    return original.apply(dialog, args);
  };
}

wrapDialog('showMessageBox', localizeMessageOptions);
wrapDialog('showMessageBoxSync', localizeMessageOptions);
wrapDialog('showOpenDialog', localizeFileOptions);
wrapDialog('showOpenDialogSync', localizeFileOptions);
wrapDialog('showSaveDialog', localizeFileOptions);
wrapDialog('showSaveDialogSync', localizeFileOptions);
const originalShowErrorBox = dialog.showErrorBox;
dialog.showErrorBox = (title, content) => originalShowErrorBox.call(dialog, t(title), t(content));

// ------------------------------------------------- Idioma das janelas

function writeCookie(code) {
  return session.defaultSession.cookies.set({
    url: 'http://127.0.0.1/',
    name: COOKIE_NAME,
    value: code,
    path: '/',
    expirationDate: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600,
  }).catch(() => {});
}

function readCookie() {
  return session.defaultSession.cookies.get({ url: 'http://127.0.0.1/', name: COOKIE_NAME })
    .then((list) => (list[0] ? list[0].value : null))
    .catch(() => null);
}

function saveLanguage(code) {
  language = code;
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify({ language: code }));
  } catch (err) {
    console.error('[i18n] Could not save language:', err.message);
  }
  rebuildAppMenu();
}

function setLanguage(code) {
  if (!LANGUAGES.some((l) => l.code === code) || code === getLanguage()) return;
  saveLanguage(code);
  writeCookie(code).then(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || !win.isVisible()) continue;
      win.webContents.executeJavaScript(
        `window.PrintventoryI18n && window.PrintventoryI18n.setLanguage(${JSON.stringify(code)})`
      ).catch(() => {});
    }
  });
}

// Código de tradução para janelas que não carregam os scripts por conta própria
// (por exemplo, a janelinha de digitar um valor).
let injectableSource = null;
function injectable() {
  if (!injectableSource) {
    const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    injectableSource = [read('pt-BR.js'), read('translator.js'), read('i18n.js')].join('\n;\n');
  }
  return injectableSource;
}

async function syncWindow(contents) {
  // Se a escolha foi feita pela própria página (seletor nas Configurações de tema),
  // o cookie mudou: o processo principal adota o novo idioma.
  const cookie = await readCookie();
  if (cookie && cookie !== getLanguage() && LANGUAGES.some((l) => l.code === cookie)) saveLanguage(cookie);
  const code = getLanguage();
  if (contents.isDestroyed()) return;
  const hasI18n = await contents.executeJavaScript('!!window.PrintventoryI18n').catch(() => true);
  if (!hasI18n && code !== 'en') await contents.executeJavaScript(injectable()).catch(() => {});
  contents.executeJavaScript(
    `window.PrintventoryI18n && window.PrintventoryI18n.syncLanguage(${JSON.stringify(code)})`
  ).catch(() => {});
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('dom-ready', () => {
    if (contents.getType() !== 'window' || contents.getURL().startsWith('devtools:')) return;
    syncWindow(contents);
  });
});

app.whenReady().then(() => writeCookie(getLanguage()));

module.exports = { getLanguage, setLanguage, t };
