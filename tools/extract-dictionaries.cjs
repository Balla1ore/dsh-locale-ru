#!/usr/bin/env node
/**
 * Extract every locale dictionary the installed DeepSeek Harness ships, so the
 * Russian pack can be checked (and extended) after a DSH upgrade.
 *
 * The shipped browser plugins are pre-built lazy-CJS bundles that cannot simply
 * be required, and they are packaged inside the application's `app.asar`.
 * This tool therefore:
 *   1. reads the ASAR index of the installed app (implemented locally, no deps),
 *   2. locates every `package.json` that declares a `dsh.client` browser half,
 *   3. walks each `lib/client.js`, finds every `locale.register(...)` call,
 *      evaluates the call arguments in a `with`-scope built from the file's own
 *      `const` literals (they only ever hold string dictionaries),
 *   4. merges the results into `locales/source-en.json` (`namespace -> {en, zh}`).
 *
 * Usage:
 *   node tools/extract-dictionaries.cjs [--app "<path to app.asar>"] [--check]
 *
 * `--check` does not write: it compares the extracted namespaces and keys with
 * the pack's `locales/source-en.json` and with `locales/ru.json`, reporting keys
 * a DSH update added (they fall back to English until translated) or removed.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
/** The installed application archive, derived from the environment (or --app). */
const DEFAULT_APP = path.join(
  process.env.LOCALAPPDATA ?? path.join(require('node:os').homedir(), 'AppData', 'Local'),
  'Programs',
  'DeepSeek Harness',
  'resources',
  'app.asar',
)

/**
 * Dictionaries registered from an array of pairs, which the textual scan cannot
 * resolve (`directory-picker-browse` registers `[['zh', {...}], ['en', {...}]]`).
 */
const ARRAY_FORM_DICTIONARIES = {
  'directory-browser': {
    en: {
      'browser.title': 'Select Workspace Directory',
      'browser.home': 'Home',
      'browser.newFolder': 'New folder',
      'browser.folderName': 'Folder name',
      'browser.createIn': 'New folder in "{name}"',
      'browser.untitledFolder': 'Untitled folder',
      'browser.create': 'Create',
      'browser.cancel': 'Cancel',
      'browser.open': 'Open',
      'browser.editPath': 'Edit path',
      'browser.loading': 'Loading…',
      'browser.truncated': 'Too many folders to list; only the beginning is shown.',
      'browser.showHidden': 'Show hidden files',
    },
    zh: {
      'browser.title': '选择工作区目录',
      'browser.home': '主目录',
      'browser.newFolder': '新建文件夹',
      'browser.folderName': '文件夹名称',
      'browser.createIn': '在"{name}"中新建文件夹',
      'browser.untitledFolder': '未命名文件夹',
      'browser.create': '创建',
      'browser.cancel': '取消',
      'browser.open': '打开',
      'browser.editPath': '编辑路径',
      'browser.loading': '加载中…',
      'browser.truncated': '文件夹过多，仅显示开头部分。',
      'browser.showHidden': '显示隐藏文件',
    },
  },
}

/* ── minimal ASAR reader ────────────────────────────────────────────────── */

function readAsarIndex(archive) {
  const fd = fs.openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const jsonSize = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonSize)
    fs.readSync(fd, json, 0, jsonSize, 16)
    let dataOffset = 8 + headerSize
    if (dataOffset % 4 !== 0) dataOffset += 4 - (dataOffset % 4)
    return { fd, header: JSON.parse(json.toString('utf8')), dataOffset }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}

function* walk(node, prefix = '') {
  for (const [name, info] of Object.entries(node.files ?? {})) {
    const full = prefix ? `${prefix}/${name}` : name
    if (info.files) yield* walk(info, full)
    else yield [full, info]
  }
}

/* ── dictionary extraction ──────────────────────────────────────────────── */

const PAIRS = { '{': '}', '[': ']', '(': ')' }

/** Return the literal starting at `start` (a bracket or quote) or null. */
function literalAt(source, start) {
  const open = source[start]
  if (open === '"' || open === "'" || open === '`') {
    for (let i = start + 1; i < source.length; i += 1) {
      if (source[i] === '\\') { i += 1; continue }
      if (source[i] === open) return source.slice(start, i + 1)
    }
    return null
  }
  const close = PAIRS[open]
  if (close === undefined) return null
  let depth = 0
  let quote = null
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) return null; continue }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

function collectConsts(source) {
  const consts = new Map()
  const re = /(?:^|[\s;{(])const\s+([A-Za-z_$][\w$]*)\s*=\s*/g
  let match
  while ((match = re.exec(source)) !== null) {
    if (consts.has(match[1])) continue
    const literal = literalAt(source, match.index + match[0].length)
    if (literal !== null) consts.set(match[1], literal)
  }
  return consts
}

const SKIP = Symbol('skip')

function makeScope(consts, cache, depth = 0) {
  const resolve = (name) => {
    if (cache.has(name)) return cache.get(name)
    const literal = consts.get(name)
    if (literal === undefined || depth > 12) return SKIP
    let value
    try {
      value = evaluate(literal, consts, cache, depth + 1)
    } catch {
      value = SKIP
    }
    cache.set(name, value)
    return value
  }
  return new Proxy({}, {
    has: () => true,
    get: (_target, name) => {
      if (typeof name !== 'string') return undefined
      const value = resolve(name)
      if (value === SKIP) throw new ReferenceError(`unresolved identifier: ${name}`)
      return value
    },
  })
}

function evaluate(expression, consts, cache, depth = 0) {
  const scope = makeScope(consts, cache, depth)
  // eslint-disable-next-line no-new-func
  return new Function('scope', `with (scope) { return (${expression}); }`)(scope)
}

function findRegisterCalls(source) {
  const calls = []
  const re = /locale\.register\(/g
  let match
  while ((match = re.exec(source)) !== null) {
    const whole = literalAt(source, match.index + match[0].length - 1)
    if (whole) calls.push(whole.slice(1, -1))
  }
  return calls
}

function extractDictionaries(archive) {
  const { fd, header, dataOffset } = readAsarIndex(archive)
  const entries = new Map([...walk(header)])
  const read = (entry) => {
    const info = entries.get(entry)
    if (!info || info.offset === undefined) return null
    const buffer = Buffer.alloc(info.size)
    fs.readSync(fd, buffer, 0, info.size, dataOffset + Number(info.offset))
    return buffer.toString('utf8')
  }

  const dictionaries = {}
  const problems = []
  const packages = []

  for (const entry of entries.keys()) {
    if (!/^dsh\/node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(entry)) continue
    let manifest
    try {
      manifest = JSON.parse(read(entry))
    } catch {
      continue
    }
    if (!manifest?.dsh?.client) continue
    const base = entry.slice(0, -'/package.json'.length)
    const client = read(`${base}/lib/client.js`)
    if (client === null) continue
    packages.push(manifest.name)

    const consts = collectConsts(client)
    const cache = new Map()
    for (const argsText of findRegisterCalls(client)) {
      let args
      try {
        args = evaluate(`[${argsText}]`, consts, cache)
      } catch (error) {
        problems.push(`${manifest.name}: ${error.message}`)
        continue
      }
      const [namespace, second, third] = args
      if (typeof namespace !== 'string' || !second) continue
      const contributions = third === undefined ? second : { [second]: third }
      for (const [locale, dictionary] of Object.entries(contributions)) {
        if (typeof dictionary !== 'object' || dictionary === null) continue
        dictionaries[namespace] ??= {}
        dictionaries[namespace][locale] = { ...(dictionaries[namespace][locale] ?? {}), ...dictionary }
      }
    }
  }

  for (const [namespace, value] of Object.entries(ARRAY_FORM_DICTIONARIES)) {
    dictionaries[namespace] ??= {}
    for (const [locale, entries_] of Object.entries(value)) {
      dictionaries[namespace][locale] = { ...(dictionaries[namespace][locale] ?? {}), ...entries_ }
    }
  }

  fs.closeSync(fd)
  return { dictionaries, packages, problems }
}

/* ── report / check ─────────────────────────────────────────────────────── */

const argv = process.argv.slice(2)
const appIndex = argv.indexOf('--app')
const archive = appIndex >= 0 ? argv[appIndex + 1] : DEFAULT_APP
const checkOnly = argv.includes('--check')

if (!fs.existsSync(archive)) {
  console.error(`app archive not found: ${archive}\npass --app "<path to app.asar>"`)
  process.exit(2)
}

const { dictionaries, packages, problems } = extractDictionaries(archive)
let keys = 0
for (const locales of Object.values(dictionaries)) keys += Object.keys(locales.en ?? {}).length

const sourceFile = path.join(ROOT, 'locales/source-en.json')
const packFile = path.join(ROOT, 'locales/ru.json')
const pack = fs.existsSync(packFile) ? JSON.parse(fs.readFileSync(packFile, 'utf8')) : {}

if (checkOnly) {
  const known = fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : {}
  const added = []
  const removed = []
  for (const [namespace, locales] of Object.entries(dictionaries)) {
    for (const [key, text] of Object.entries(locales.en ?? {})) {
      if (known[namespace]?.en?.[key] === undefined) added.push({ namespace, key, text })
    }
  }
  for (const [namespace, locales] of Object.entries(known)) {
    for (const key of Object.keys(locales.en ?? {})) {
      if (dictionaries[namespace]?.en?.[key] === undefined) removed.push(`${namespace}/${key}`)
    }
  }
  const untranslated = added.filter((item) => pack[item.namespace]?.[item.key] === undefined)
  console.log(`installed DSH: ${packages.length} client packages, ${keys} English keys`)
  console.log(`pack: ${Object.keys(pack).length} namespaces, ${Object.values(pack).reduce((sum, ns) => sum + Object.keys(ns).length, 0)} keys`)
  console.log(`new keys since the recorded source: ${added.length} (${untranslated.length} without a Russian value)`)
  console.log(`keys gone from the installed app: ${removed.length}`)
  for (const item of added.slice(0, 20)) console.log(`  + ${item.namespace}/${item.key} = ${JSON.stringify(item.text)}`)
  for (const item of removed.slice(0, 20)) console.log(`  - ${item}`)
} else {
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true })
  fs.writeFileSync(sourceFile, `${JSON.stringify(dictionaries, null, 1)}\n`)
  console.log(`wrote ${path.relative(process.cwd(), sourceFile)}: ${packages.length} client packages, ${Object.keys(dictionaries).length} namespaces, ${keys} keys`)
  const missing = []
  for (const [namespace, locales] of Object.entries(dictionaries)) {
    for (const key of Object.keys(locales.en ?? {})) {
      if (pack[namespace]?.[key] === undefined) missing.push(`${namespace}/${key}`)
    }
  }
  console.log(`keys still needing a Russian translation: ${missing.length}`)
  for (const item of missing.slice(0, 20)) console.log(`  ? ${item}`)
}
for (const problem of problems) console.log(`note: unreadable registration in ${problem}`)
