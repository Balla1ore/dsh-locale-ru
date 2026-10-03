# NOTICE

## What is original here

* The Russian translation itself — 2615 strings across 58 web-UI namespaces
  (`locales/ru.json`) plus 165 desktop-shell strings (`locales/shell-ru.json`).
* All tooling: the ASAR reader/extractor, the dictionaries extractor, the client
  bundle generator, the shell patcher, the launcher and the verifier.

## What is derived

The English and Chinese source strings in `locales/source-en.json` were extracted
from a locally installed DeepSeek Harness (`0.2.0-rc.2`) and remain the property
of their authors. DeepSeek Harness packages are published under the MIT license,
which permits this use with attribution. The Russian translation is a derivative
work of those strings and is distributed here under the same MIT license.

## The desktop-shell patch is unofficial

`tools/patch-shell.mjs` rewrites three files inside the installed application
archive (`app.asar`): `lib/main.js`, `lib/preload-app.cjs` and
`lib/preload-welcome.cjs`. It exists because the desktop shell ships its own
dictionary in English and Chinese only, and no plugin API can reach it.

Consequences a user must accept before running it:

* it modifies the installed application, not just the DSH profile;
* it keeps a backup (`app.asar.before-locale-ru`) and `--restore` puts it back;
* a DeepSeek Harness update replaces `app.asar` and silently reverts the patch
  (the pack prepares it again, the launcher applies it at the next start);
* an unexpected upstream layout change makes the patcher refuse to write
  anything, rather than write something wrong;
* it is not endorsed by the DeepSeek Harness authors — the supported fix is a
  Russian dictionary inside the desktop shell itself, and the ready-made
  `locales/shell-ru.json` can be handed to them for that.

## Not affiliated

This is an independent community language pack. It is not affiliated with,
endorsed by, or supported by DeepSeek. `DeepSeek`, `DeepSeek Harness` and `DSH`
are used only to describe what the pack is for.
