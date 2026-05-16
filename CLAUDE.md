# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome MV3 extension ("Bilingual Translator") that injects translations of foreign-language paragraphs inline beneath their source nodes. Translation goes through an Anthropic-compatible API the user configures in the options page.

## Commands

- `npm test` — runs `node --test tests/*.test.js` (unit tests for the pure-logic modules; no bundler, no build step).
- No lint/format tooling is configured.

To run a single test file: `node --test tests/parser.test.js`. `node --test` does not have a built-in filter by test name; use `--test-name-pattern '<regex>'` if needed.

After editing files, the extension must be reloaded **twice** to take effect:
1. `chrome://extensions` → click the refresh icon on the extension card (reloads the service worker).
2. Reload any already-open tab you're testing on (the old content script is still active there until you do).

## Architecture

Three runtime contexts, message-passed:

- **`background.js`** (MV3 service worker, `type: "module"`) — owns the toolbar click handler, configuration (read from `chrome.storage.local`), and the translation HTTP call. State is intentionally minimal: only an in-memory `Set` of `tabId`s currently being translated. Persistent translated/hidden state lives in the content script and is queried via a `status` message on each click (this survives SW restarts; `setTimeout` does not, so badge clears use `chrome.alarms`).
- **`content.js`** — DOM scanner + injector. Walks `SELECTOR` (paragraph/heading/list/SPA containers, plus X/Twitter Draft.js blocks), filters out code/pre/script and already-mostly-Chinese text, builds numbered batches (~2000 chars / max 20 items each), sends each via `translateBatch` messages to the SW, parses the `[N] ...` response, and inserts a `<div class="__tr_zh">` after each source element. Hides/shows all translations by toggling `__tr_hidden` on `<body>`.
- **`options.html` / `options.js`** — provider/baseURL/apiKey/model/targetLanguage form, stored in `chrome.storage.local`. Includes a "Test connection" round-trip.

Click semantics (see `chrome.action.onClicked` in `background.js`): if content script reports `translated: true`, send `toggle`; otherwise send `translate`. Pages with restricted URLs (`chrome://`, web store, etc.) are detected up-front and surfaced via `chrome.notifications`.

### `lib/` modules (pure, ES modules, unit-tested)

- `lib/batcher.js` — `buildBatches(items, { maxChars, maxItems })` produces `[{ ids, text }]` with **local** numbering (each batch restarts at `[1]`).
- `lib/parser.js` — `parseNumberedResponse(text, expectedCount)` returns `Map<n, translation>`, tolerating multi-line content under one `[N]` header and ignoring out-of-range numbers.
- `lib/providers.js` — `translate({ provider, ... })` dispatches to `anthropicTranslate` (POSTs `{baseURL}/v1/messages`). The `openai-compatible` branch is stubbed.
- `lib/targetLanguages.js` — fixed list of the top-10 languages by speakers; `resolvePreferredTargetLanguage` picks a default from Chrome's UI locale + `navigator.languages`. `getTargetLanguage(value).promptLabel` is what the system prompt interpolates.

### Critical duplication

`content.js` re-implements `buildBatches`, `parseNumberedResponse`, and the batching constants **inline**. MV3 content scripts can't easily `import` ES modules, so the `lib/` versions are the source of truth and tests, and `content.js` carries a hand-kept copy. **When changing batcher or parser logic, edit both `lib/<file>.js` and the matching block in `content.js`** — the comment at the top of `content.js` flags this.

### Wire format between content script and provider

Each batch is sent as plain text `[1] <para>\n[2] <para>\n...` with batch-local numbering. The system prompt (`buildSystemPrompt` in `lib/providers.js`) instructs the model to return the same `[N]` form, one line per paragraph, in the target language. If the model omits items, `content.js` retries those paragraphs individually as single-item `[1] ...` requests.

## Release flow

Tags matching `v*` trigger `.github/workflows/release.yml`, which verifies the tag version matches `manifest.json#version`, runs `npm test`, zips the runtime files (manifest, JS, CSS, HTML, `lib/`, three icon sizes — note `lib/` ships verbatim because `providers.js` is imported by `background.js`), and attaches the ZIP to a GitHub Release. Bump `manifest.json#version` before tagging.
