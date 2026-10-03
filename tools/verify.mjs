/**
 * Verify the built browser half without launching the app.
 *
 * - loads `lib/client.js` the way the browser module system does (capturing the
 *   factory from `window.__ModuleLoader__.load`),
 * - runs the factory with a `require` that throws, proving the bundle is
 *   self-contained,
 * - mounts the plugin against a stub `ctx` and asserts the language definition
 *   and every namespace dictionary are registered as owned effects,
 * - compares the pack against the source dictionaries extracted from the
 *   shipped client bundles: full namespace/key coverage, no unknown namespaces,
 *   and identical placeholder sets per key.
 *
 * Usage: node tools/verify.mjs [--source <dictionaries.json>] [--quiet]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const sourceIndex = argv.indexOf('--source');
const sourceFile = sourceIndex >= 0 ? argv[sourceIndex + 1] : path.join(root, 'locales/source-en.json');

const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

/* ── 1. package manifest and host half ──────────────────────────────────── */

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (pkg.dsh?.client?.platform !== 'web') {
  fail(`dsh.client.platform is ${JSON.stringify(pkg.dsh?.client?.platform)}, expected "web" (the client module system ignores other platforms)`);
}
const clientExport = pkg.exports?.['./client'];
if (typeof clientExport !== 'string') fail('exports["./client"] must be a string path');
else if (!fs.existsSync(path.join(root, clientExport))) fail(`exports["./client"] points at a missing file: ${clientExport}`);
if (pkg.dsh?.client?.inject !== undefined && !Array.isArray(pkg.dsh.client.inject)) fail('dsh.client.inject must be an array');
if (pkg.dsh?.bundle?.patch !== undefined) {
  for (const patch of [pkg.dsh.bundle.patch].flat()) {
    if (!fs.existsSync(path.join(root, patch))) fail(`dsh.bundle.patch names a missing file: ${patch}`);
  }
}

const host = await import(new URL('../lib/index.js', import.meta.url));
if (typeof host.apply !== 'function') fail('the host half lib/index.js does not export apply()');
if (typeof host.name !== 'string' || host.name.trim() === '') fail('the host half declares no plugin name');
for (const helper of ['archivePath', 'shellPatched', 'ensureShellPatchReady', 'runPatcher']) {
  if (typeof host[helper] !== 'function') fail(`the host half does not export ${helper}()`);
}

/* The shell detector reads a real ASAR index: build a minimal one and check both answers. */
const tmpDir = path.join(root, '.shell-check');
fs.mkdirSync(tmpDir, { recursive: true });
const writeMiniAsar = (file, mainSource) => {
  const content = Buffer.from(mainSource, 'utf8');
  const json = Buffer.from(JSON.stringify({ files: { lib: { files: { 'main.js': { size: content.length, offset: '0' } } } } }), 'utf8');
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(json.length + 8, 4);
  head.writeUInt32LE(json.length + 4, 8);
  head.writeUInt32LE(json.length, 12);
  const padding = (4 - ((16 + json.length) % 4)) % 4;
  fs.writeFileSync(file, Buffer.concat([head, json, Buffer.alloc(padding), content]));
};
const patchedAsar = path.join(tmpDir, 'patched.asar');
const plainAsar = path.join(tmpDir, 'plain.asar');
writeMiniAsar(patchedAsar, 'const ru = { title: "x" };\n');
writeMiniAsar(plainAsar, 'const en = { title: "x" };\n');
if (host.shellPatched(patchedAsar) !== true) fail('the host half did not recognise a patched shell archive');
if (host.shellPatched(plainAsar) !== false) fail('the host half did not recognise an unpatched shell archive');
fs.rmSync(tmpDir, { recursive: true, force: true });

/* ── 2. load the bundle exactly like the browser module system ──────────── */

const bundleFile = path.join(root, 'lib/client.js');
const bundle = fs.readFileSync(bundleFile, 'utf8');
const loaded = [];
const windowStub = { __ModuleLoader__: { load: (row) => loaded.push(row) } };

try {
  // eslint-disable-next-line no-new-func
  new Function('window', bundle)(windowStub);
} catch (error) {
  fail(`lib/client.js is not loadable: ${error.message}`);
}

if (loaded.length !== 1) fail(`expected exactly one module row, got ${loaded.length}`);
const row = loaded[0] ?? {};
if (row.id !== pkg.name) fail(`module row id ${JSON.stringify(row.id)} is not the package name ${JSON.stringify(pkg.name)}`);
if (typeof row.factory !== 'function') fail('module row has no factory function');

/* ── 2. materialize the factory: nothing but the shell's baseline ────────── */

/** The frozen baseline module table the shell seeds; a bundle may require only these. */
const BASELINE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);
const baselineModule = (specifier) => {
  if (specifier === 'react/jsx-runtime') {
    const element = (type, props) => ({ type, props });
    return { jsx: element, jsxs: element, Fragment: Symbol('Fragment') };
  }
  return {};
};
const requireBaseline = (specifier) => {
  if (!BASELINE.has(specifier)) throw new Error(`bundle requested external module ${specifier}`);
  return baselineModule(specifier);
};

let exports_;
try {
  exports_ = row.factory(requireBaseline);
} catch (error) {
  fail(`factory failed: ${error.message}`);
}
exports_ ??= {};

if (typeof exports_.apply !== 'function') fail('exports.apply is not a function');
if (!Array.isArray(exports_.inject) || !exports_.inject.includes('locale')) fail('exports.inject does not request "locale"');

/* ── 3. mount against a stub locale service ─────────────────────────────── */

const languages = [];
const registered = new Map();
const effects = [];
const cardEntries = [];
const ctx = {
  effect: (callback, label) => {
    const disposer = callback();
    if (typeof disposer !== 'function') fail(`effect ${JSON.stringify(label)} returned no disposer`);
    effects.push({ label, disposer });
    return disposer;
  },
  locale: {
    addLanguage: (definition) => {
      languages.push(definition);
      return () => {};
    },
    register: (namespace, locale, dictionary) => {
      registered.set(`${namespace}|${locale}`, dictionary);
      return () => {};
    },
    bind: () => (key) => key,
  },
  inject: (deps, callback) => {
    if (!deps.includes('slots')) fail(`unexpected service request: ${deps.join(', ')}`);
    callback({
      effect: (inner) => {
        const disposer = inner();
        effects.push({ label: 'slots child', disposer });
        return disposer;
      },
      locale: { bind: () => (key) => key },
      slots: {
        inject: (_name, callback_) => callback_(),
        register: (entry, component) => {
          cardEntries.push({ entry, component });
          return () => {};
        },
      },
    });
  },
};

try {
  exports_.apply(ctx);
} catch (error) {
  fail(`apply() threw: ${error.message}`);
}

if (languages.length !== 1) fail(`expected one language definition, got ${languages.length}`);
const [language] = languages;
if (language?.id !== 'ru') fail(`language id is ${JSON.stringify(language?.id)}, expected "ru"`);
if (language?.fallback !== 'en') fail(`language fallback is ${JSON.stringify(language?.fallback)}, expected "en"`);
if (typeof language?.label !== 'string' || language.label.trim() === '') fail('language label is empty');

for (const key of registered.keys()) {
  const [namespace, locale] = key.split('|');
  if (locale !== 'ru' && namespace !== exports_.CARD_NAMESPACE) {
    fail(`namespace ${namespace} registered for locale ${locale}`);
  }
}

/* ── 3b. the Plugins page card ──────────────────────────────────────────── */

const card = cardEntries.find(({ entry }) => entry.name === 'plugins.item');
if (!card) fail('the bundle did not register a plugins.item entry');
else {
  if (card.entry.id !== 'locale-ru') fail(`the card id is ${JSON.stringify(card.entry.id)}`);
  if (card.entry.locale !== exports_.CARD_NAMESPACE) fail('the card does not declare its dictionary namespace');
  const label = typeof card.entry.label === 'function' ? card.entry.label() : undefined;
  if (typeof label !== 'string' || label.trim() === '') fail('the card label is empty');
  if (typeof card.component !== 'function') fail('the card component is not a function');
  else {
    const text = (key) => key;
    for (const view of ['summary', 'page']) {
      try {
        const rendered = card.component({ view, t: text });
        if (rendered === undefined || rendered === null) fail(`the card rendered nothing for view ${view}`);
      } catch (error) {
        fail(`the card threw for view ${view}: ${error.message}`);
      }
    }
  }
}

/* ── 4. compare against the shipped English source dictionaries ─────────── */

const packFile = path.join(root, 'locales/ru.json');
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));

// The bundle must carry exactly the JSON source, byte for byte per value: a
// stale or re-encoded artifact would silently ship wrong text.
const embedded = exports_.DICTIONARIES ?? {};
for (const [namespace, dictionary] of Object.entries(pack)) {
  const inlined = embedded[namespace];
  if (inlined === undefined) {
    fail(`namespace ${namespace} is not embedded in the bundle`);
    continue;
  }
  for (const [key, value] of Object.entries(dictionary)) {
    if (inlined[key] !== value) fail(`${namespace}/${key}: bundle holds ${JSON.stringify(inlined[key])}, source holds ${JSON.stringify(value)}`);
  }
}
for (const namespace of Object.keys(embedded)) {
  if (!(namespace in pack)) fail(`the bundle embeds unknown namespace ${namespace}`);
}

let source = null;
if (fs.existsSync(sourceFile)) source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
else warn(`source dictionary not found at ${sourceFile}; coverage check skipped`);

const placeholders = (text) => (String(text).match(/\{[^}]*\}/g) || []).sort().join(',');

if (source) {
  for (const [namespace, locales] of Object.entries(source)) {
    const english = locales.en || {};
    const russian = pack[namespace];
    if (!russian) {
      fail(`namespace ${namespace} is missing from the pack`);
      continue;
    }
    if (!registered.has(`${namespace}|ru`)) fail(`namespace ${namespace} was not registered on the locale service`);
    for (const [key, value] of Object.entries(english)) {
      const translated = russian[key];
      if (typeof translated !== 'string') {
        fail(`${namespace}/${key} has no Russian translation`);
        continue;
      }
      // Blank English values are separators/concatenation fragments and must be
      // reproduced exactly; anything else must carry an actual translation.
      if (String(value).trim() === '') {
        if (translated !== value) fail(`${namespace}/${key}: blank source must be reproduced verbatim`);
        continue;
      }
      if (translated.trim() === '') {
        fail(`${namespace}/${key} has an empty Russian translation`);
        continue;
      }
      if (placeholders(translated) !== placeholders(value)) {
        fail(`${namespace}/${key}: placeholder mismatch [${placeholders(value)}] vs [${placeholders(translated)}]`);
      }
    }
    for (const key of Object.keys(russian)) {
      if (!(key in english)) warn(`${namespace}/${key} is not a key of the shipped English dictionary`);
    }
  }
  for (const namespace of Object.keys(pack)) {
    if (!(namespace in source)) warn(`namespace ${namespace} is not a namespace of the shipped dictionaries`);
    if (!registered.has(`${namespace}|ru`)) fail(`namespace ${namespace} is in the pack but was not registered`);
  }
}

/* ── 6. desktop caption menu patch ──────────────────────────────────────── */

// The Desktop shell (Windows) draws its caption menu bar inside this page, in a
// shadow root, from its own English/Chinese table. The pack rewrites those two
// labels while Russian is active; this simulates that DOM without a browser.
const makeObserver = () => {
  const observers = [];
  class StubObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = true;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.connected = false;
    }
  }
  return { StubObserver, observers };
};

const makeCaptionDom = () => {
  const button = (text) => ({ tagName: 'BUTTON', textContent: text, getAttribute: () => 'false' });
  const bar = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
  };
  const buttons = [button('Application'), button('Edit')];
  const root = { querySelector: () => bar, querySelectorAll: () => buttons };
  const host = { shadowRoot: root };
  return {
    document: {
      documentElement: {},
      body: {},
      querySelector: (selector) => (selector === '[data-windows-menu]' ? host : null),
    },
    bar,
    buttons,
  };
};

const mountWithLocale = (freshExports, active) => {
  const languages = [];
  const registered = new Map();
  const effects = [];
  const listeners = new Set();
  const ctx = {
    effect: (callback) => {
      const disposer = callback();
      effects.push(disposer);
      return disposer;
    },
    locale: {
      addLanguage: (definition) => {
        languages.push(definition);
        return () => {};
      },
      register: (namespace, locale, dictionary) => {
        registered.set(namespace, { locale, dictionary });
        return () => {};
      },
      getLocale: () => ({ active, locales: [], revision: 0 }),
      bind: () => (key) => key,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    // The caption patch does not use services; the card registration does, and a
    // composition without the slot registry must simply skip it.
    inject: () => {},
  };
  freshExports.apply(ctx);
  return { languages, registered, effects, listeners };
};

for (const [active, expected] of [['ru', ['Приложение', 'Правка']], ['en', ['Application', 'Edit']]]) {
  const dom = makeCaptionDom();
  const { StubObserver } = makeObserver();
  globalThis.document = dom.document;
  globalThis.MutationObserver = StubObserver;
  try {
    const fresh = row.factory(requireBaseline);
    const mounted = mountWithLocale(fresh, active);
    if (dom.buttons[0].textContent !== expected[0] || dom.buttons[1].textContent !== expected[1]) {
      fail(
        `caption patch with active locale "${active}" wrote ` +
          `${JSON.stringify([dom.buttons[0].textContent, dom.buttons[1].textContent])}, expected ${JSON.stringify(expected)}`,
      );
    }
    if (active === 'ru' && dom.bar.getAttribute('aria-label') !== 'Меню приложения') {
      fail(`caption patch did not relabel the menu bar (got ${JSON.stringify(dom.bar.getAttribute('aria-label'))})`);
    }
    // Every observer and subscription must be withdrawn when the plugin unloads.
    for (const disposer of mounted.effects) if (typeof disposer !== 'function') fail('the caption effect returned no disposer');
    for (const disposer of mounted.effects) disposer();
  } finally {
    delete globalThis.document;
    delete globalThis.MutationObserver;
  }
}

/* ── 7. report ──────────────────────────────────────────────────────────── */

let keys = 0;
for (const dictionary of Object.values(pack)) keys += Object.keys(dictionary).length;

const namespaces = Object.keys(pack).length;
if (!quiet) {
  console.log(`bundle:        ${path.relative(process.cwd(), bundleFile)} (${(bundle.length / 1024).toFixed(1)} KiB)`);
  console.log(`language:      ${language?.id} — ${language?.label} (fallback ${language?.fallback})`);
  console.log(`namespaces:    ${namespaces} registered on the locale service`);
  console.log(`keys:          ${keys}`);
  console.log(`owned effects: ${effects.length}`);
}
for (const message of warnings) console.log(`warning: ${message}`);
if (failures.length) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`\nPASS: the Russian pack registers ${namespaces} namespaces / ${keys} keys and covers the shipped dictionaries`);
