/**
 * Install (or remove) this language pack in a DSH profile.
 *
 * The pack is a plain local plugin module, not a bundle: it is copied into
 * `<profile>/plugins/dsh-locale-ru` and one `insert` row is added to the
 * profile's own `cordis.patch.yml`. A path-like name inside an `insert` row is
 * resolved relative to the patch file, so no pnpm install and no profile
 * dependency are involved, and the pack keeps working when the workspace it was
 * built in moves.
 *
 * The profile's HMR watcher reloads the configuration, so the language appears
 * in the running session without restarting the host. If it does not show up in
 * Settings → General, reload the page.
 *
 * Usage:
 *   node tools/install.mjs                # install into the "desktop" profile
 *   node tools/install.mjs --profile web
 *   node tools/install.mjs --remove       # undo: drop the row and the copy
 *   node tools/install.mjs --dry-run      # show what would change
 *
 * Options: --home <DSH_HOME> --profile <name> --remove --dry-run --force
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ROW_ID = 'locale-ru';
const PLUGIN_DIR = PACKAGE.name;
const ROW_NAME = `./plugins/${PLUGIN_DIR}/lib/index.js`;

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const remove = argv.includes('--remove');
const dryRun = argv.includes('--dry-run');
const force = argv.includes('--force');
const profileName = option('--profile', process.env.DSH_PROFILE ?? 'desktop');
const home = option('--home', process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'));
const profileDir = path.join(home, 'profiles', profileName);
const patchFile = path.join(profileDir, 'cordis.patch.yml');
const target = path.join(profileDir, 'plugins', PLUGIN_DIR);
const backupFile = path.join(profileDir, 'cordis.patch.yml.before-locale-ru');

const log = (...args) => console.log(...args);
const plan = (...args) => console.log(`${dryRun ? '[dry-run] ' : ''}${args.join(' ')}`);

if (!fs.existsSync(patchFile) && !force) {
  console.error(`no profile patch at ${patchFile}\npass --home/--profile, or --force to create it`);
  process.exit(2);
}

let patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '# Your patch layer for this dsh profile.\n';
const hasRow = new RegExp(`^\\s*-?\\s*id:\\s*['"]?${ROW_ID}['"]?\\s*$`, 'm').test(patch);

/* ── remove ─────────────────────────────────────────────────────────────── */

if (remove) {
  if (!hasRow) log(`nothing to remove: ${patchFile} has no "${ROW_ID}" row`);
  else {
    // Drop the whole `- insert:` block that carries the row.
    const lines = patch.split(/\r?\n/);
    const start = lines.findIndex((line) => line.includes(`id: ${ROW_ID}`));
    let from = start;
    while (from > 0 && !/^-\s+\S/.test(lines[from]) && !/^-\s*$/.test(lines[from])) from -= 1;
    let to = start;
    while (to + 1 < lines.length && !/^-\s+\S/.test(lines[to + 1])) to += 1;
    const block = lines.slice(from, to + 1).join('\n');
    if (!block.includes('insert:')) {
      console.error(`refusing to remove: the "${ROW_ID}" row is not inside an "insert:" block I can identify`);
      process.exit(1);
    }
    if (!dryRun) {
      if (!fs.existsSync(backupFile)) fs.copyFileSync(patchFile, backupFile);
      patch = [...lines.slice(0, from), ...lines.slice(to + 1)].join('\n');
      fs.writeFileSync(patchFile, patch);
    }
    plan(`removed the "${ROW_ID}" row from ${patchFile}`);
  }
  if (fs.existsSync(target)) {
    if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
    plan(`removed ${target}`);
  }
  log('\ndone. Reload the page; the language disappears from Settings → General.');
  process.exit(0);
}

/* ── install ────────────────────────────────────────────────────────────── */

if (!fs.existsSync(path.join(ROOT, 'lib/client.js'))) {
  console.error('lib/client.js is missing — run "node tools/build-client.mjs" first');
  process.exit(1);
}

if (fs.existsSync(target) && !dryRun) fs.rmSync(target, { recursive: true, force: true });
if (!dryRun) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(ROOT, target, {
    recursive: true,
    filter: (source) => !/[/\\](node_modules|\.git)([/\\]|$)/.test(source),
  });
}
plan(`copied the pack to ${target}`);

if (hasRow) {
  log(`the "${ROW_ID}" row is already present in ${patchFile}`);
} else {
  const block = `\n# Russian language pack (see plugins/${PLUGIN_DIR})\n- insert:\n    - id: ${ROW_ID}\n      name: '${ROW_NAME}'\n`;
  const patched = `${patch.replace(/\s*$/, '')}\n${block}`;
  // The patch file is a top-level YAML array: appending one list item must add
  // exactly one top-level "- " entry, and the original text must survive.
  const topLevel = (text) => (text.match(/^- /gm) ?? []).length;
  if (!patched.startsWith(patch.replace(/\s*$/, '')) || topLevel(patched) !== topLevel(patch) + 1) {
    console.error('refusing to write: the appended text did not produce exactly one new top-level entry');
    process.exit(1);
  }
  if (!dryRun) {
    if (!fs.existsSync(backupFile)) fs.copyFileSync(patchFile, backupFile);
    fs.writeFileSync(patchFile, patched);
  }
  plan(`appended the "${ROW_ID}" row to ${patchFile} (backup: ${path.basename(backupFile)})`);
}

log(`
installed${dryRun ? ' (dry run)' : ''}.

Next:
  1. DSH reloads the profile configuration by itself (profile HMR), so the pack
     should mount in the running session. If it does not:
       - reload the page (F5) — the browser half is served per page load;
       - check Settings → Built-in plugins → Plugin list for a "${ROW_ID}" row;
       - restart DeepSeek Harness if the row failed to import.
  2. Pick the language: Settings → General → Language → "Русский".

Undo: node tools/install.mjs --remove${profileName === 'desktop' ? '' : ` --profile ${profileName}`}
`);
