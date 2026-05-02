# Bilingual Translator

A Chrome MV3 extension that translates foreign-language webpages to Simplified Chinese **inline**, side-by-side with the original. Click the toolbar icon to translate; click again to hide; click again to show — all without re-fetching.

Translation is powered by an Anthropic-compatible API you configure (e.g. Claude Haiku via your own base URL + API key).

![translate-demo](https://via.placeholder.com/600x300?text=demo+screenshot+goes+here)

## Features

- **One-click translation** — click toolbar icon, get every paragraph translated underneath the original
- **Bilingual layout** — Chinese translations inserted right after each English block, with a subtle blue background and accent border so you can read both at once
- **Toggle** — second click hides translations, third click shows them again (no API call, no flicker)
- **Smart selectors** — works on standard articles (`<p>`, `<h1-6>`, `<li>`, `<blockquote>`, `<td>`), SPA containers (`<article>`, `[lang]`, `[role="article"]`), and X/Twitter long-form articles (Draft.js blocks)
- **Skip Chinese** — paragraphs that are already mostly Chinese are auto-skipped
- **Batched & concurrent** — paragraphs are grouped into batches (~2000 chars each) and translated 3-at-a-time for speed
- **Resilient** — partial-failure fallback (per-paragraph retry), navigation-aware (won't error when you click a link mid-translate)

## Install

### Option A: Load Unpacked (recommended for self-hosting)

1. Clone this repo:
   ```bash
   git clone https://github.com/<your-username>/chrome-translation-ext.git
   ```
2. Open `chrome://extensions` in Chrome
3. Toggle **Developer mode** on (top right)
4. Click **Load unpacked** and select the cloned `chrome-translation-ext/` directory
5. The icon (blue speech bubble with "A" overlapping orange "译") appears in your toolbar

### Option B: Pre-built ZIP

1. Download the latest `chrome-translation-ext-vX.Y.Z.zip` from [Releases](../../releases)
2. Unzip it
3. Follow steps 2-5 above, selecting the unzipped directory

## Configure

Right-click the extension icon → **Options**. Fill in:

| Field | Description |
|---|---|
| **Provider** | `Anthropic` (only supported one for now) |
| **Base URL** | Your Anthropic-compatible endpoint, e.g. `https://api.anthropic.com` (no trailing slash). The extension POSTs to `{baseURL}/v1/messages`. |
| **API Key** | Your API key (stored locally in `chrome.storage.local`, plaintext) |
| **Model** | e.g. `claude-haiku-4-5-20251001` |

Click **Save**, then **Test connection** — you should see something like `OK. Sample response: [1] 你好世界`.

## Use

1. Open any English webpage (Wikipedia, Hacker News, X.com long-form, MDN docs, GitHub README, etc.)
2. Click the extension icon. Badge shows `...` while translating.
3. Within ~10-30 seconds, every paragraph gets a Chinese translation inserted directly underneath, with a light-blue background and blue left border.
4. Click the icon again — translations hide.
5. Click again — they reappear (no re-fetch).

If you navigate to a new page, you need to click the icon again (translation state is per-page, in-memory only).

## Architecture

```
┌─────────────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Toolbar click     │  ─────► │  background.js   │  ─────► │  Anthropic   │
│   (chrome.action)   │         │  (service worker)│  ◄───── │  API         │
└─────────────────────┘         └──────────────────┘         └──────────────┘
                                         ▲
                                         │ message passing
                                         ▼
                                ┌──────────────────┐
                                │   content.js     │
                                │   - scan DOM     │
                                │   - batch        │
                                │   - insert <div> │
                                └──────────────────┘
```

- `lib/batcher.js` — pure function: splits paragraphs into numbered batches (`[1] ... [2] ...`)
- `lib/parser.js` — pure function: parses model response back into a `Map<n, translation>`
- `lib/providers.js` — Anthropic-native HTTP client; OpenAI-compatible adapter is stubbed for future
- `background.js` — service worker, click handler, batch routing, badge/notification UI
- `content.js` — DOM scanner + injector. Embeds copies of batcher/parser logic (MV3 content scripts can't easily import ES modules)
- `tests/` — `node --test` unit tests for the pure-logic modules (18 tests)

## Develop

```bash
# Run unit tests
npm test

# After editing files, reload the extension:
# 1. chrome://extensions → click the refresh icon on the extension card
# 2. Reload the page you want to test on (Cmd+R / Ctrl+R)
```

The two reload steps matter: the extension service worker reloads from step 1, but already-open tabs still run the **old** content script until you refresh them.

## Limitations

- Single language pair only: source = anything not Chinese, target = Simplified Chinese
- No persistent caching (re-translating the same page costs API tokens)
- No SPA route-change detection (clicking a link inside a single-page app doesn't auto-retranslate; you have to click the icon again, and even then `translated=true` may persist — refresh the page to reset)
- No streaming — each batch returns whole; long pages show translations batch-by-batch as they finish
- No `iframe` content (content script only runs in main frame)
- API key is stored in plaintext in `chrome.storage.local`

## License

MIT
