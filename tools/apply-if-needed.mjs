/**
 * Apply the prepared Russian shell patch, if the installed shell still needs it.
 *
 * Run by `launch-dsh-ru.vbs` before DeepSeek Harness starts: at that moment
 * `app.asar` is not locked, so the prepared archive can be swapped in. The pack's
 * host half prepares that archive at startup (`lib/index.js`), so in practice
 * this only has to rename a file.
 *
 * Usage: node tools/apply-if-needed.mjs [--archive <app.asar>] [--quiet]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url';
import { archivePath, runPatcher, shellPatched } from '../lib/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG_FILE = path.join(ROOT, 'shell-patch.log')

const argv = process.argv.slice(2)
const quiet = argv.includes('--quiet')
const archiveIndex = argv.indexOf('--archive')
const archive = archiveIndex >= 0 ? argv[archiveIndex + 1] : archivePath()

const log = (message) => {
  const line = `${new Date().toISOString()} ${message}`
  if (!quiet) console.log(line)
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`)
  } catch {
    /* the log is a convenience */
  }
}

if (archive === undefined || !fs.existsSync(archive)) {
  log('apply-if-needed: установленный app.asar не найден, пропускаю')
  process.exit(0)
}

const patched = shellPatched(archive)
if (patched === true) {
  log('apply-if-needed: перевод оболочки уже в приложении')
  process.exit(0)
}
if (patched === undefined) {
  log('apply-if-needed: не удалось прочитать архив приложения')
  process.exit(1)
}

const prepared = `${archive}.locale-ru.new`
const args = fs.existsSync(prepared) ? ['--swap'] : ['--apply']
log(`apply-if-needed: применяю патч оболочки (${args[0]})`)
const code = await runPatcher(args)
log(`apply-if-needed: патчер завершился с кодом ${code}`)
process.exit(code === 0 ? 0 : 1)
