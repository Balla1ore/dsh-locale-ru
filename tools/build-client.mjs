/**
 * Build the browser half (`lib/client.js`) from `locales/ru.json`.
 *
 * The web GUI serves each client plugin as a single pre-built bundle in the
 * lazy-CJS form the browser module system expects:
 *
 *     window.__ModuleLoader__.load({ id, factory: (require) => exports })
 *
 * Running a bundle only registers that factory; the factory body (and therefore
 * every dictionary) materializes when the plugin is first used. The pack needs
 * no imports at all, so the bundle is one self-contained file.
 *
 * Usage: node tools/build-client.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dictionaries = JSON.parse(fs.readFileSync(path.join(root, 'locales/ru.json'), 'utf8'));

const LANGUAGE_ID = 'ru';
const LANGUAGE_LABEL = 'Русский';
const FALLBACK_LOCALE = 'en';

/**
 * Desktop-shell caption labels. The shell draws this menu bar itself (Windows)
 * and knows only English and Chinese, so the pack supplies the Russian ones.
 */
const SHELL_CAPTIONS = { application: 'Приложение', edit: 'Правка', menuBar: 'Меню приложения' };

/**
 * The card this pack registers in the Plugins page (`plugins.item`). These are
 * new strings the pack owns, so they are authored here for both shipped
 * languages instead of coming from the translated dictionaries.
 */
const CARD_NAMESPACE = 'localePack';
const CARD_DICTIONARIES = {
  en: {
    title: 'Russian language pack',
    summary: 'Russian for the web interface and for the desktop shell',
    language:
      'The pack registers the language “Русский” and dictionaries for every namespace the interface ships: 58 namespaces, 2615 strings. Choose it in Settings → General → Language.',
    shellTitle: 'Desktop shell',
    shell:
      'The window menu, tray menu, dialogs, sign-in window and update screens belong to the desktop shell, which ships English and Chinese only. This pack patches the installed application (app.asar) to add Russian there as well.',
    automatic:
      'The pack prepares that patch by itself shortly after the application starts, and the DeepSeek Harness launcher shortcut applies it on the next start. A DSH update reverts the shell patch, and the pack prepares it again automatically.',
    manualTitle: 'Manual paths',
    manualApply: 'apply-shell-ru.cmd — apply now (close DeepSeek Harness first).',
    manualWatch: 'watch-shell-ru.cmd — apply automatically the moment the application closes.',
    log: 'Both write dsh-locale-ru/shell-patch.log next to the pack.',
    restore: 'Rollback: restore-shell-ru.cmd returns the original app.asar.',
  },
  ru: {
    title: 'Русский язык',
    summary: 'Русский для веб-интерфейса и для оболочки приложения',
    language:
      'Пакет добавляет язык «Русский» и словари для всех пространств имён интерфейса: 58 пространств, 2615 строк. Выбирается в «Настройки → Общие → Язык».',
    shellTitle: 'Оболочка приложения',
    shell:
      'Меню окна, трей, диалоги, окно входа и экраны обновления рисует оболочка приложения, а в ней есть только английский и китайский. Пакет патчит установленное приложение (app.asar) и добавляет русский и там.',
    automatic:
      'Патч пакет готовит сам вскоре после запуска приложения, а применяет его лаунчер-ярлык DeepSeek Harness при следующем запуске. Обновление DSH сбрасывает перевод оболочки — пакет подготовит патч заново автоматически.',
    manualTitle: 'Ручные способы',
    manualApply: 'apply-shell-ru.cmd — применить сразу (DeepSeek Harness должен быть закрыт).',
    manualWatch: 'watch-shell-ru.cmd — применить автоматически в момент закрытия приложения.',
    log: 'Оба пишут журнал dsh-locale-ru/shell-patch.log рядом с пакетом.',
    restore: 'Откат: restore-shell-ru.cmd возвращает исходный app.asar.',
  },
};

const namespaces = Object.keys(dictionaries).sort();
if (namespaces.length === 0) throw new Error('locales/ru.json holds no namespaces');

let keyCount = 0;
let blankCount = 0;
for (const ns of namespaces) {
  const entries = dictionaries[ns];
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    throw new Error(`namespace ${ns} is not an object`);
  }
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string') throw new Error(`${ns}/${key} is not a string`);
    // Separators, prefixes and concatenation fragments are legitimately blank;
    // they are shipped exactly as the source declares them.
    if (value.trim() === '') blankCount += 1;
    keyCount += 1;
  }
}

const data = JSON.stringify(dictionaries, null, '\t')
  // Keep the emitted file ASCII-safe apart from the natural UTF-8 text: only
  // escape the characters that would break the surrounding JavaScript literal.
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const bundle = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\t/** Baseline module the shell seeds; the pack's Plugins page card renders with it. */
\t\tconst react_jsx_runtime = require("react/jsx-runtime");
\t\t//#region locale pack data
\t\t/** Language definition registered with the locale service. */
\t\tconst LANGUAGE = ${JSON.stringify({ id: LANGUAGE_ID, label: LANGUAGE_LABEL, fallback: FALLBACK_LOCALE })};
\t\t/** Namespace dictionaries owned by this pack: namespace -> key -> Russian. */
\t\tconst DICTIONARIES = ${data};
\t\t//#endregion
\t\t//#region desktop caption menu
\t\t/**
\t\t* Captions of the window menu bar the Desktop shell (Windows) draws itself
\t\t* inside this page. The shell builds the bar in a preload script with its own
\t\t* two-language table (English/Chinese) and re-labels it whenever the document
\t\t* language changes, so a language pack has to rewrite these two labels in the
\t\t* page. The menu items inside the popups are native Electron menus owned by the
\t\t* shell process and cannot be reached from here.
\t\t*/
\t\tconst SHELL_CAPTIONS = { application: ${JSON.stringify(SHELL_CAPTIONS.application)}, edit: ${JSON.stringify(SHELL_CAPTIONS.edit)}, menuBar: ${JSON.stringify(SHELL_CAPTIONS.menuBar)} };
\t\t/** Attribute the Desktop preload puts on its caption-menu host element. */
\t\tconst SHELL_MENU_MARKER = "[data-windows-menu]";
\t\t/**
\t\t* Rewrite the caption-bar labels, skipping writes that would change nothing
\t\t* (an observer-driven rewrite of the same text would keep re-triggering itself).
\t\t* @param root - the caption menu's shadow root.
\t\t*/
\t\tfunction patchShellCaptions(root) {
\t\t\tconst bar = root.querySelector('[role="menubar"]');
\t\t\tif (bar !== null && bar.getAttribute("aria-label") !== SHELL_CAPTIONS.menuBar) bar.setAttribute("aria-label", SHELL_CAPTIONS.menuBar);
\t\t\tconst buttons = root.querySelectorAll('button[role="menuitem"]');
\t\t\tconst labels = [SHELL_CAPTIONS.application, SHELL_CAPTIONS.edit];
\t\t\tfor (let index = 0; index < labels.length && index < buttons.length; index += 1) {
\t\t\t\tif (buttons[index].textContent !== labels[index]) buttons[index].textContent = labels[index];
\t\t\t}
\t\t}
\t\t/**
\t\t* Keep the desktop caption bar Russian while Russian is the active language.
\t\t* Does nothing outside a browser or when the Desktop shell draws no such bar.
\t\t* @param locale - the locale registry to follow.
\t\t* @returns disposer that withdraws both observers and the subscription.
\t\t*/
\t\tfunction installShellCaptions(locale) {
\t\t\tif (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
\t\t\tlet host;
\t\t\tlet bodyObserver;
\t\t\tlet menuObserver;
\t\t\tconst sync = () => {
\t\t\t\tif (locale.getLocale().active !== LANGUAGE.id) return;
\t\t\t\tconst root = host?.shadowRoot;
\t\t\t\tif (root) patchShellCaptions(root);
\t\t\t};
\t\t\tconst attach = () => {
\t\t\t\tconst found = document.querySelector(SHELL_MENU_MARKER);
\t\t\t\tif (found === null || found.shadowRoot === null) return false;
\t\t\t\tif (found !== host) {
\t\t\t\t\tif (menuObserver !== undefined) menuObserver.disconnect();
\t\t\t\t\thost = found;
\t\t\t\t\tmenuObserver = new MutationObserver(sync);
\t\t\t\t\tmenuObserver.observe(found.shadowRoot, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
\t\t\t\t}
\t\t\t\tsync();
\t\t\t\treturn true;
\t\t\t};
\t\t\tif (!attach()) {
\t\t\t\tbodyObserver = new MutationObserver(() => {
\t\t\t\t\tif (attach()) bodyObserver.disconnect();
\t\t\t\t});
\t\t\t\tbodyObserver.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
\t\t\t}
\t\t\tconst unsubscribe = locale.subscribe(sync);
\t\t\treturn () => {
\t\t\t\tif (bodyObserver !== undefined) bodyObserver.disconnect();
\t\t\t\tif (menuObserver !== undefined) menuObserver.disconnect();
\t\t\t\tunsubscribe();
\t\t\t};
\t\t}
\t\t//#endregion
\t\t//#region plugins page card
\t\t/** Owner namespace for this card's copy; registered for English and Russian. */
\t\tconst CARD_NS = ${JSON.stringify(CARD_NAMESPACE)};
\t\t/** Copy of the card the Plugins page renders. */
\t\tconst CARD_DICTIONARIES = ${JSON.stringify(CARD_DICTIONARIES, null, '\t').split('\n').join('\n\t\t')};
\t\t/**
\t\t* The card this pack contributes to the Plugins page: a one-liner in the list
\t\t* and the pack's own page. Everything it needs is the copy handed to it.
\t\t* @param props - the view the page asks for and this entry's locale reader.
\t\t* @returns the one-liner, or the card's page.
\t\t*/
\t\tfunction LocalePackCard(props) {
\t\t\tconst t = typeof props.t === "function" ? props.t : (key) => key;
\t\t\tif (props.view !== "page") return t("summary");
\t\t\tconst jsx = react_jsx_runtime.jsx;
\t\t\tconst jsxs = react_jsx_runtime.jsxs;
\t\t\treturn jsxs("div", { children: [
\t\t\t\tjsx("p", { children: t("language") }),
\t\t\t\tjsx("h4", { children: t("shellTitle") }),
\t\t\t\tjsx("p", { children: t("shell") }),
\t\t\t\tjsx("p", { children: t("automatic") }),
\t\t\t\tjsx("h4", { children: t("manualTitle") }),
\t\t\t\tjsxs("ul", { children: [
\t\t\t\t\tjsx("li", { children: t("manualApply") }),
\t\t\t\t\tjsx("li", { children: t("manualWatch") }),
\t\t\t\t\tjsx("li", { children: t("log") }),
\t\t\t\t\tjsx("li", { children: t("restore") })
\t\t\t\t] })
\t\t\t] });
\t\t}
\t\t//#endregion
\t\t//#region locale pack plugin
\t\t/** Required service: the locale registry that owns languages and dictionaries. */
\t\tconst inject = ["locale"];
\t\t/**
\t\t* Register the language and every dictionary as owned effects, so unloading
\t\t* the plugin withdraws the whole pack and an active selection falls back to
\t\t* the available locales. The Plugins page card is registered the same way and
\t\t* is skipped in compositions without the slot registry.
\t\t* @param ctx - browser root context.
\t\t*/
\t\tfunction apply(ctx) {
\t\t\tctx.effect(() => ctx.locale.addLanguage(LANGUAGE), "locale-ru: language definition");
\t\t\tfor (const [namespace, dictionary] of Object.entries(DICTIONARIES)) {
\t\t\t\tctx.effect(() => ctx.locale.register(namespace, LANGUAGE.id, dictionary), \`locale-ru: \${namespace} dictionary\`);
\t\t\t}
\t\t\tfor (const [locale, dictionary] of Object.entries(CARD_DICTIONARIES)) {
\t\t\t\tctx.effect(() => ctx.locale.register(CARD_NS, locale, dictionary), \`locale-ru: \${CARD_NS} (\${locale})\`);
\t\t\t}
\t\t\tctx.effect(() => installShellCaptions(ctx.locale), "locale-ru: desktop caption menu");
\t\t\tctx.inject(["slots"], (child) => {
\t\t\t\tchild.effect(() => child.slots.inject("plugins.item", () => child.slots.register({
\t\t\t\t\tname: "plugins.item",
\t\t\t\t\tid: "locale-ru",
\t\t\t\t\torder: 30,
\t\t\t\t\tlabel: () => child.locale.bind(CARD_NS)("title"),
\t\t\t\t\tlocale: CARD_NS,
\t\t\t\t\tinject: () => ({})
\t\t\t\t}, LocalePackCard)), "locale-ru: plugins page card");
\t\t\t});
\t\t}
\t\t//#endregion
\t\texports.CARD_NAMESPACE = CARD_NS;
\t\texports.DICTIONARIES = DICTIONARIES;
\t\texports.LANGUAGE = LANGUAGE;
\t\texports.LocalePackCard = LocalePackCard;
\t\texports.SHELL_CAPTIONS = SHELL_CAPTIONS;
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\texports.name = "locale-ru";
\t\treturn module.exports;
\t}
});
`;

const outFile = path.join(root, 'lib/client.js');
fs.writeFileSync(outFile, bundle);
console.log(
  `wrote ${path.relative(process.cwd(), outFile)}: ${namespaces.length} namespaces, ${keyCount} keys ` +
    `(${blankCount} blank separators), ${(bundle.length / 1024).toFixed(1)} KiB`,
);
