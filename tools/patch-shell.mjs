/**
 * Unofficial Russian translation for the DeepSeek Harness **desktop shell**
 * (the Electron main process and its preload scripts).
 *
 * The shell ships its own two-language dictionary (165 strings, English and
 * Chinese) baked into three files inside `app.asar`, and its language resolver
 * accepts only `zh` and `en`; everything else falls back to English. That covers
 * the window menu items, the tray menu, native dialogs, the startup-failure
 * screen and the sign-in window — none of which a web client plugin can reach.
 *
 * This tool rewrites those three files inside `app.asar`:
 *   lib/main.js             native menus, dialogs, tray, locale resolution
 *   lib/preload-app.cjs     the Windows caption menu bar
 *   lib/preload-welcome.cjs the sign-in / welcome window
 *
 * It is deliberately conservative:
 *   - every edit is an exact-text replacement that must be found, otherwise the
 *     tool refuses to touch anything;
 *   - the rebuilt archive is verified entry by entry: every file that is not a
 *     target must be byte-identical, and each patched file is syntax-checked
 *     with `node --check` before anything is swapped in;
 *   - the original archive is kept as `app.asar.before-locale-ru`, and
 *     `--restore` copies it back.
 *
 * Usage:
 *   node tools/patch-shell.mjs --check           # report the current state
 *   node tools/patch-shell.mjs --prepare         # build app.asar.locale-ru.new (keeps a backup)
 *   node tools/patch-shell.mjs --swap            # swap it in; DeepSeek Harness must be closed
 *   node tools/patch-shell.mjs --apply           # prepare + swap
 *   node tools/patch-shell.mjs --restore         # put the original archive back
 *
 * Options: --archive <app.asar> (default: the installed application), --dry-run, --force
 *
 * NOTE: a DSH update replaces app.asar and therefore reverts this patch.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE_FILE = path.join(ROOT, 'locales/shell-ru.json');
const CHECK_DIR = path.join(ROOT, '.shell-check');
const DEFAULT_ARCHIVE = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
  'Programs',
  'DeepSeek Harness',
  'resources',
  'app.asar',
);

/** Shell files that embed the dictionary and the resolver. */
const TARGETS = ['lib/main.js', 'lib/preload-app.cjs', 'lib/preload-welcome.cjs'];

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const option = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const archive = option('--archive', DEFAULT_ARCHIVE);
const backup = `${archive}.before-locale-ru`;
const preparedFile = `${archive}.locale-ru.new`;
const force = has('--force');
const dryRun = has('--dry-run');

const log = (...args) => console.log(...args);
const die = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

/** User-facing lines; the wrapper batch files stay ASCII so cmd.exe cannot garble them. */
const RU = {
  closeApp: 'Закройте DeepSeek Harness полностью (окно и значок в трее) и запустите установку снова.',
  prepared: 'Замена подготовлена, но приложение ещё занимает app.asar.',
  restored: 'Исходный app.asar восстановлен. Запустите DeepSeek Harness.',
  nothing: 'Ничего не изменено: словарь оболочки уже на месте.',
  applied: 'Готово. Запустите DeepSeek Harness — меню, трей и диалоги будут на русском.',
  failed: 'Патч не применён, исходный app.asar не тронут.',
  waiting: 'Ожидаю закрытия DeepSeek Harness — патч применится автоматически. Это окно можно свернуть.',
  gaveUp: 'Не дождался: приложение всё ещё занимает app.asar. Запустите watch-shell-ru.cmd заново или примените патч вручную: apply-shell-ru.cmd.',
};

/* ── minimal ASAR reader/writer ─────────────────────────────────────────── */

/**
 * Open an archive and parse its index.
 *
 * Header layout (Chromium's pickle): `[4][jsonSize + 8][jsonSize + 4][jsonSize]`
 * followed by the JSON index at byte 16; file data begins at the next 4-byte
 * boundary after the index.
 */
function openArchive(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const jsonSize = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonSize);
  fs.readSync(fd, json, 0, jsonSize, 16);
  let dataOffset = 16 + jsonSize;
  if (dataOffset % 4 !== 0) dataOffset += 4 - (dataOffset % 4);
  return { fd, tree: JSON.parse(json.toString('utf8')), dataOffset };
}

/** Depth-first [path, node] pairs in header order. */
function* walk(node, prefix = '') {
  for (const [name, info] of Object.entries(node.files ?? {})) {
    const full = prefix ? `${prefix}/${name}` : name;
    if (info.files) yield* walk(info, full);
    else yield [full, info];
  }
}

/** One entry's inline bytes, or null for an unpacked entry. */
function readEntry(archive_, info, size = info.size) {
  if (info.offset === undefined) return null;
  const buffer = Buffer.alloc(size);
  fs.readSync(archive_.fd, buffer, 0, size, archive_.dataOffset + Number(info.offset));
  return buffer;
}

const sha1 = (buffer) => createHash('sha1').update(buffer).digest('hex');

/* ── exact-text edits inside one shell file ─────────────────────────────── */

/** The balanced `{...}` block that starts at `start`. */
function balancedBlock(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) return null; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const RU_RESOLVER = `function resolveDesktopLocale(locale) {
	const selected = locale.toLowerCase();
	if (selected.startsWith("ru")) return {
		id: "ru",
		messages: ru
	};
	if (selected.startsWith("zh")) return {
		id: "zh-CN",
		messages: zh
	};
	return {
		id: "en",
		messages: en
	};
}`;

/**
 * Apply the three edits to one shell file.
 * @returns the patched source, or null when the file already carries the pack.
 */
function patchShellFile(source, table, file) {
  if (source.includes('const ru = {')) return null;

  // 1. the Russian table, inserted directly after the Chinese one.
  const zhStart = source.indexOf('const zh = {');
  if (zhStart < 0) die(`${file}: the Chinese table was not found`);
  const zhBlock = balancedBlock(source, source.indexOf('{', zhStart));
  if (zhBlock === null) die(`${file}: the Chinese table has no end`);
  let insertAt = source.indexOf('{', zhStart) + zhBlock.length;
  if (source[insertAt] === ';') insertAt += 1;
  const literal = JSON.stringify(table, null, '\t').split('\n').join('\n\t');
  const block = `\n\t/** Russian dictionary for the desktop shell. */\n\tconst ru = ${literal};\n`;
  let patched = source.slice(0, insertAt) + block + source.slice(insertAt);

  // 2. the resolver must accept Russian before Chinese and English.
  const resolverStart = patched.indexOf('function resolveDesktopLocale(');
  if (resolverStart < 0) die(`${file}: resolveDesktopLocale was not found`);
  const braceIndex = patched.indexOf('{', resolverStart);
  const resolverBody = balancedBlock(patched, braceIndex);
  if (resolverBody === null) die(`${file}: resolveDesktopLocale has no end`);
  patched = `${patched.slice(0, resolverStart)}${RU_RESOLVER}${patched.slice(braceIndex + resolverBody.length)}`;

  // 3. the startup resolver (main.js only) must keep a stored "ru" preference.
  const before = 'if (selected === "zh" || selected === "en") return resolveDesktopLocale(selected);';
  const after = 'if (selected === "zh" || selected === "en" || selected === "ru") return resolveDesktopLocale(selected);';
  if (patched.includes(before)) patched = patched.replace(before, after);
  const languageBefore = 'if (primary === "zh" || primary === "en") return resolveDesktopLocale(primary);';
  const languageAfter = 'if (primary === "zh" || primary === "en" || primary === "ru") return resolveDesktopLocale(primary);';
  if (patched.includes(languageBefore)) patched = patched.replace(languageBefore, languageAfter);

  return patched;
}

/** Syntax-check a patched shell file with the Node that runs this tool. */
function syntaxCheck(name, content) {
  fs.mkdirSync(CHECK_DIR, { recursive: true });
  const file = path.join(CHECK_DIR, path.basename(name));
  fs.writeFileSync(file, content);
  const result = spawnSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) die(`${name}: the patched file does not parse (node --check failed)`);
}

/** Every entry of `after` must match `before` except the allowed target paths. */
function verifyArchive(before, after, allowed) {
  const failures = [];
  const afterIndex = new Map(walk(after.tree));
  let compared = 0;
  for (const [entry, info] of walk(before.tree)) {
    const other = afterIndex.get(entry);
    if (!other) { failures.push(`missing entry ${entry}`); continue; }
    const left = readEntry(before, info);
    const right = readEntry(after, other);
    if (left === null || right === null) {
      if ((left === null) !== (right === null)) failures.push(`unpacked flag changed for ${entry}`);
      continue;
    }
    if (left.length !== right.length && !allowed.has(entry)) failures.push(`size changed for ${entry}`);
    else if (left.length === right.length && sha1(left) !== sha1(right) && !allowed.has(entry)) failures.push(`unexpected change in ${entry}`);
    compared += 1;
  }
  return { failures, compared };
}

/* ── inspection ─────────────────────────────────────────────────────────── */

if (!fs.existsSync(archive)) die(`app archive not found: ${archive} (pass --archive <path>)`);
const table = JSON.parse(fs.readFileSync(TABLE_FILE, 'utf8'));

const inspect = (file) => {
  const opened = openArchive(file);
  const report = [];
  for (const entry of TARGETS) {
    const info = [...walk(opened.tree)].find(([name]) => name === entry)?.[1];
    if (!info) { report.push([entry, 'MISSING', 0]); continue; }
    const content = readEntry(opened, info)?.toString('utf8') ?? '';
    const state = content.includes('const ru = {') && /startsWith\("ru"\)/.test(content)
      ? 'Russian table present'
      : content.includes('const ru = {')
        ? 'table only, resolver untouched'
        : 'not patched';
    report.push([entry, state, info.size]);
  }
  fs.closeSync(opened.fd);
  return report;
};

if (has('--check') || has('--verify')) {
  for (const [entry, state, size] of inspect(archive)) log(`${entry}: ${state} (${size} bytes)`);
  log(fs.existsSync(backup) ? `backup present: ${backup}` : 'no backup yet');
  log(fs.existsSync(preparedFile) ? `prepared archive waiting: ${preparedFile}` : 'nothing prepared');
  process.exit(0);
}

/* ── restore ────────────────────────────────────────────────────────────── */

if (has('--restore')) {
  if (!fs.existsSync(backup)) die(`no backup at ${backup} — nothing to restore`);
  if (!dryRun) {
    fs.copyFileSync(backup, archive);
    fs.rmSync(preparedFile, { force: true });
  }
  log(`${dryRun ? '[dry-run] ' : ''}restored ${archive} from ${path.basename(backup)}`);
  log(RU.restored);
  process.exit(0);
}

/* ── prepare ────────────────────────────────────────────────────────────── */

if (has('--prepare') || has('--apply')) {
  const before = openArchive(archive);
  const originals = new Map(walk(before.tree));
  const contents = new Map();
  for (const entry of TARGETS) {
    const info = originals.get(entry);
    if (!info) die(`${entry} not found in the archive`);
    const original = readEntry(before, info).toString('utf8');
    const patched = patchShellFile(original, table, entry);
    if (patched === null) {
      log(`${entry}: already patched, left alone`);
      continue;
    }
    syntaxCheck(entry, patched);
    contents.set(entry, Buffer.from(patched, 'utf8'));
    log(`${entry}: ${info.size} -> ${contents.get(entry).length} bytes`);
  }

  if (contents.size === 0) {
    fs.closeSync(before.fd);
    log('nothing to do: the shell already carries the Russian table.');
    if (!has('--swap') && !has('--apply')) process.exit(0);
  } else {
    const tree = JSON.parse(JSON.stringify(before.tree));
    let cursor = 0;
    const plan = [];
    for (const [entry, info] of walk(tree)) {
      if (info.offset === undefined) continue; // unpacked: data lives beside the archive
      const replacement = contents.get(entry);
      const size = replacement ? replacement.length : Number(originals.get(entry).size);
      info.size = size;
      info.offset = String(cursor);
      cursor += size;
      plan.push([entry, originals.get(entry), replacement, size]);
    }

    const json = Buffer.from(JSON.stringify(tree), 'utf8');
    const head = Buffer.alloc(16);
    head.writeUInt32LE(4, 0);
    head.writeUInt32LE(json.length + 8, 4);
    head.writeUInt32LE(json.length + 4, 8);
    head.writeUInt32LE(json.length, 12);
    const padding = (4 - ((16 + json.length) % 4)) % 4;

    if (!dryRun) {
      if (!fs.existsSync(backup)) {
        fs.copyFileSync(archive, backup);
        log(`backup written: ${backup}`);
      }
      const out = fs.openSync(preparedFile, 'w');
      fs.writeSync(out, head);
      fs.writeSync(out, json);
      if (padding) fs.writeSync(out, Buffer.alloc(padding));
      for (const [entry, original, replacement, size] of plan) {
        fs.writeSync(out, replacement ?? readEntry(before, original, size));
        void entry;
      }
      fs.closeSync(out);
      log(`${dryRun ? '[dry-run] ' : ''}prepared archive: ${preparedFile}`);
    }
    fs.closeSync(before.fd);
  }
}

/* ── swap when the application releases the archive ─────────────────────── */

if (has('--swap-when-free')) {
  const timeoutMinutes = Number(option('--timeout', '120'));
  const logFile = option('--log', path.join(ROOT, 'shell-patch.log'));
  const taskName = option('--delete-task', '');
  const started = Date.now();
  // A detached watcher may have no usable console: never let a broken pipe or
  // an invalid handle take the process down before the swap happens.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  const append = (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      process.stdout.write(line);
    } catch {
      /* no console attached */
    }
    try {
      fs.appendFileSync(logFile, line);
    } catch {
      /* the log is a convenience; never fail the swap over it */
    }
  };
  /** A repeating watcher removes its own scheduled task once it is done. */
  const dropTask = () => {
    if (taskName === '') return;
    spawnSync('schtasks', ['/delete', '/tn', taskName, '/f'], { stdio: 'ignore' });
  };

  if (!fs.existsSync(preparedFile)) {
    dropTask();
    append(`nothing prepared: ${preparedFile} does not exist — nothing to do`);
    process.exit(0);
  }
  if (!fs.existsSync(backup)) die(`refusing to swap without a backup at ${backup}`);

  // Verify once: Windows keeps the archive locked while the app runs, but the
  // archive we prepared does not change between attempts. A repeating watcher
  // skips the re-read (--no-verify) because the file it checked is still there.
  if (!has('--no-verify')) {
    const before = openArchive(backup);
    const after = openArchive(preparedFile);
    const { failures, compared } = verifyArchive(before, after, new Set(TARGETS));
    fs.closeSync(before.fd);
    fs.closeSync(after.fd);
    if (failures.length) {
      dropTask();
      for (const failure of failures.slice(0, 20)) append(`  - ${failure}`);
      append(`verification failed (${failures.length} problems); ${archive} was not touched`);
      process.exit(1);
    }
    for (const [entry, state] of inspect(preparedFile)) {
      if (!state.startsWith('Russian table present')) {
        dropTask();
        append(`prepared archive: ${entry} is ${state}`);
        process.exit(1);
      }
    }
    append(`verified ${compared} entries — waiting for DeepSeek Harness to close (up to ${timeoutMinutes} min)`);
  }
  append(RU.waiting);

  let done = false;
  let attempt = 0;
  let lastCode = '';
  while (!done) {
    attempt += 1;
    try {
      fs.renameSync(preparedFile, archive);
      done = true;
    } catch (error) {
      lastCode = error.code ?? String(error.message);
      if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST', 'ENOENT'].includes(lastCode)) {
        dropTask();
        append(`could not replace ${archive}: ${lastCode}`);
        process.exit(1);
      }
      if (lastCode === 'ENOENT') {
        // Another run (or the manual script) already performed the swap.
        dropTask();
        append('the prepared archive is gone — assuming another run already applied it');
        process.exit(0);
      }
      if (Date.now() - started > timeoutMinutes * 60_000) {
        append(`gave up after ${timeoutMinutes} min (still ${lastCode}); ${archive} was not touched`);
        append(RU.gaveUp);
        process.exit(2);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  dropTask();
  append(`replaced ${archive} on attempt ${attempt}`);
  append(RU.applied);
  append(`restore with: node tools/patch-shell.mjs --restore`);
  process.exit(0);
}

/* ── swap ───────────────────────────────────────────────────────────────── */

if ((has('--swap') || has('--apply')) && !has('--swap-when-free')) {
  if (!fs.existsSync(preparedFile)) {
    log('nothing prepared — the shell is either patched already or was never prepared.');
    log(RU.nothing);
    process.exit(0);
  }
  if (!fs.existsSync(backup)) die(`refusing to swap without a backup at ${backup}`);

  if (!dryRun) {
    const before = openArchive(backup);
    const after = openArchive(preparedFile);
    const { failures, compared } = verifyArchive(before, after, new Set(TARGETS));
    fs.closeSync(before.fd);
    fs.closeSync(after.fd);
    if (failures.length) {
      for (const failure of failures.slice(0, 20)) console.error(`  - ${failure}`);
      console.error(RU.failed);
      die(`the rebuilt archive failed verification (${failures.length} problems); ${archive} was not touched`);
    }
    for (const [entry, state] of inspect(preparedFile)) {
      if (!state.startsWith('Russian table present')) die(`prepared archive: ${entry} is ${state}`);
    }
    log(`verified ${compared} entries against the backup — only the three shell files differ`);
    try {
      fs.renameSync(preparedFile, archive);
    } catch (error) {
      console.error(RU.prepared);
      console.error(RU.closeApp);
      die(
        `could not replace ${archive}: ${error.code ?? error.message}\n` +
          '       Close DeepSeek Harness completely (including the tray icon) and run --swap again.\n' +
          `       prepared archive kept at ${preparedFile}`,
      );
    }
    log(`replaced ${archive}`);
  } else {
    log(`[dry-run] would replace ${archive} with ${preparedFile}`);
  }
  log(RU.applied);
  log(`restore with: node tools/patch-shell.mjs --restore${archive === DEFAULT_ARCHIVE ? '' : ` --archive "${archive}"`}`);
}
