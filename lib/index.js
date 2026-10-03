/**
 * Host half of the Russian language pack.
 *
 * The web UI translation lives in the browser half (`lib/client.js`). This half
 * has one job: keep the desktop **shell** translation ready. The shell (window
 * menu, tray, dialogs, sign-in window) ships its own English/Chinese dictionary
 * inside `app.asar`, so it is patched by `tools/patch-shell.mjs` rather than by
 * a Cordis plugin; a DSH update replaces `app.asar` and reverts that patch.
 *
 * At startup this half checks the installed archive and, when the Russian table
 * is missing, prepares the patched archive next to it. Preparing is a plain file
 * write; the swap itself needs the application closed, so it is performed by the
 * launcher (`launch-dsh-ru.vbs` / `tools/apply-if-needed.mjs`) on the next start,
 * or by `watch-shell-ru.cmd` at close time.
 *
 * Everything here is best-effort: a failure is logged and never affects the web
 * translation, which is registered by the browser half.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const name = 'locale-ru'

/** This package's root directory, from the module URL the Loader imported. */
const PACK_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
/** The patcher shipped in this package. */
const PATCHER = path.join(PACK_ROOT, 'tools', 'patch-shell.mjs')
/** Where the check and the patches record what they did. */
const LOG_FILE = path.join(PACK_ROOT, 'shell-patch.log')
/** How long to wait after activation before touching the disk. */
const START_DELAY_MS = 5000

/** Append one line to the pack log and to the host log. */
function note(ctx, message) {
  const line = `${new Date().toISOString()} ${message}\n`
  try {
    fs.appendFileSync(LOG_FILE, line)
  } catch {
    /* a missing log must never break the pack */
  }
  try {
    ctx.logger?.info?.(`locale-ru: ${message}`)
  } catch {
    /* the logger is optional */
  }
}

/** The installed application archive, or undefined when this is not a desktop app. */
export function archivePath() {
  const candidates = []
  if (typeof process.resourcesPath === 'string') candidates.push(path.join(process.resourcesPath, 'app.asar'))
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'))
  }
  return candidates.find((candidate) => fs.existsSync(candidate))
}

/**
 * Read one entry out of an ASAR archive.
 * @param archive - path of the archive.
 * @param entry - slash-separated entry path.
 * @returns the entry's bytes, or undefined when it is absent or unpacked.
 */
function readArchiveEntry(archive, entry) {
  const fd = fs.openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const jsonSize = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonSize)
    fs.readSync(fd, json, 0, jsonSize, 16)
    let dataOffset = 16 + jsonSize
    if (dataOffset % 4 !== 0) dataOffset += 4 - (dataOffset % 4)
    let node = JSON.parse(json.toString('utf8'))
    for (const part of entry.split('/')) {
      node = node?.files?.[part]
      if (node === undefined) return undefined
    }
    if (node.offset === undefined) return undefined
    const buffer = Buffer.alloc(node.size)
    fs.readSync(fd, buffer, 0, node.size, dataOffset + Number(node.offset))
    return buffer
  } finally {
    fs.closeSync(fd)
  }
}

/** Whether the installed shell already carries the Russian dictionary. */
export function shellPatched(archive) {
  try {
    const main = readArchiveEntry(archive, 'lib/main.js')
    return main !== undefined && main.includes('const ru = {')
  } catch {
    return undefined
  }
}

/** Run the patcher as a child process, with its output captured in the pack log. */
export function runPatcher(args) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    // Inside the Electron main process the executable is the app itself, which
    // must be told to behave as plain Node.
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    const fd = fs.openSync(LOG_FILE, 'a')
    const child = spawn(process.execPath, [PATCHER, ...args], { cwd: PACK_ROOT, env, stdio: ['ignore', fd, fd] })
    const done = (code) => {
      try {
        fs.closeSync(fd)
      } catch {
        /* already closed */
      }
      resolve(code)
    }
    child.on('error', (error) => {
      try {
        fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} patcher failed to start: ${error.message}\n`)
      } catch {
        /* ignore */
      }
      done(-1)
    })
    child.on('exit', (code) => done(code ?? -1))
  })
}

/**
 * Check the installed shell and prepare the Russian patch when it is missing.
 * @param ctx - plugin context, used for logging only.
 * @returns the state it settled on: `patched`, `prepared`, `skipped` or `failed`.
 */
export async function ensureShellPatchReady(ctx) {
  const archive = archivePath()
  if (archive === undefined) {
    note(ctx, 'не найдена установленная оболочка (app.asar) — перевод оболочки пропущен')
    return 'skipped'
  }
  if (!fs.existsSync(PATCHER)) {
    note(ctx, `не найден ${PATCHER} — перевод оболочки пропущен`)
    return 'skipped'
  }
  const patched = shellPatched(archive)
  if (patched === true) {
    note(ctx, 'перевод оболочки уже в приложении')
    return 'patched'
  }
  if (patched === undefined) {
    note(ctx, 'не удалось прочитать архив приложения — проверьте права')
    return 'failed'
  }
  const prepared = `${archive}.locale-ru.new`
  if (fs.existsSync(prepared)) {
    note(ctx, 'патч оболочки уже подготовлен и ждёт следующего запуска')
    return 'prepared'
  }
  note(ctx, 'оболочка без русского перевода — готовлю патч')
  const code = await runPatcher(['--prepare'])
  if (code === 0) {
    note(ctx, 'патч подготовлен: закройте приложение и запустите через ярлык, чтобы применить')
    return 'prepared'
  }
  note(ctx, `подготовка патча завершилась с кодом ${code}`)
  return 'failed'
}

/**
 * Host-side entry point: schedule the shell check shortly after activation so it
 * never delays plugin startup, and drop the timer whenever this fiber stops.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  const timer = setTimeout(() => {
    ensureShellPatchReady(ctx).catch((error) => note(ctx, `проверка оболочки не удалась: ${String(error)}`))
  }, START_DELAY_MS)
  if (typeof timer.unref === 'function') timer.unref()
  ctx.effect(() => () => clearTimeout(timer), 'locale-ru: shell patch check')
}
