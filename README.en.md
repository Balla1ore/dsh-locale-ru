# dsh-locale-ru — Russian for DeepSeek Harness

A language pack for the DeepSeek Harness (DSH) desktop application: the whole web
interface plus the desktop shell (window menu, tray, dialogs, sign-in window).

* **2615 strings** in **58 web-UI namespaces** — every dictionary the interface
  ships, extracted from the installed DSH `0.2.0-rc.2`.
* **165 desktop-shell strings** — the window menu, tray menu, dialogs, sign-in
  and update screens, which the shell itself only knows in English and Chinese.
* Untranslated keys fall back to English, so a newer DSH never breaks the
  interface: it just shows English for the new strings.
* No dependencies, no build step for users: the browser half is one
  self-contained bundle.

## Install

### From an unpacked folder (this repository)

```cmd
install.cmd
```

That copies the pack into the DSH profile (`%DSH_HOME%\profiles\desktop\plugins\dsh-locale-ru`)
and adds one row to the profile's `cordis.patch.yml` (with a backup). Remove it
again with `install.cmd --remove`.

### From a git address, through the GUI

The **Plugins** page of the web interface ("Add plugin") accepts a git address,
a tarball, an absolute local path or a package name. Paste this repository's
address and DSH installs the pack as a bundle, after which it can be switched on
and off from that page.

### From npm

The name `dsh-locale-ru` on npm belongs to a different author's plugin, so this
pack has to be published under another name. A git or local-path install needs no
rename: it uses the `name` in `package.json`, which the row in
`cordis.patch.yml` must keep matching.

### Do not mix with another Russian locale

The language id `ru` can be registered only once. Installing this pack next to
another Russian localisation (for instance the npm plugin of the same name by
another author) makes the second one fail to load. Switch the other one off first.

## Enable the language

**Settings → General → Language → «Русский»**. The choice is stored in the DSH
settings and survives restarts.

## Desktop shell translation

The shell is not reachable from a plugin, so the pack patches the installed
application (`tools/patch-shell.mjs`) and reverts that patch whenever DSH
updates. Everything else is automatic:

1. the host half checks the installed archive at startup and prepares the
   patched archive when the Russian table is missing;
2. the launcher (`launch-dsh-ru.vbs`) applies it before the application starts.

`tools/install-launcher.cmd` points the DeepSeek Harness shortcuts at that
launcher (`-Restore` undoes it). Manual paths, if you prefer no launcher:
`apply-shell-ru.cmd`, `watch-shell-ru.cmd`, `restore-shell-ru.cmd`.

## What is inside

| Path | Purpose |
|---|---|
| `lib/index.js` | host half: keeps the desktop-shell patch prepared |
| `lib/client.js` | browser half: language definition, all dictionaries, shell caption patch, Plugins-page card |
| `locales/ru.json` | the translation source of truth |
| `locales/source-en.json` | English/Chinese source the translation was made from |
| `locales/shell-ru.json` | Russian dictionary for the desktop shell (165 strings) |
| `locale/en.json`, `locale/ru.json` | the pack's own display title and description |
| `tools/build-client.mjs` | builds `lib/client.js` from `locales/ru.json` |
| `tools/verify.mjs` | offline verification: bundle, manifest, coverage, placeholders, card, shell detectors |
| `tools/extract-dictionaries.cjs` | re-extracts the shipped dictionaries after a DSH update |
| `tools/patch-shell.mjs` | prepares/applies/restores the shell patch |
| `tools/install.mjs` | installs/removes the pack in a DSH profile |
| `tools/install-launcher.ps1` | points the DeepSeek Harness shortcuts at the launcher |

## Verification

```cmd
node tools\verify.mjs
```

It loads `lib/client.js` exactly as the browser module system does, mounts the
plugin against a stub `ctx`, and asserts: the module row id matches the package
name, the bundle needs nothing but the shell's baseline modules, the language
`ru` is registered with an `en` fallback, all 58 namespaces and 2615 strings
match the source, placeholder sets match, the Plugins-page card registers and
renders, the shell caption patch works for `ru` and leaves other languages alone,
and the host half recognises patched and unpatched archives.

## Licence and provenance

MIT — see `LICENSE`. The English/Chinese source strings come from DeepSeek
Harness (MIT); the Russian translation and all tooling are original. The
desktop-shell patch is unofficial; read `NOTICE.md` before using it.
