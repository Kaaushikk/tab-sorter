# Tab Sorter

Organize one browser window into native tab groups. Choose a local strategy, ask your own AI provider for ideas, or describe the groups you want in plain English. Preview every plan before applying it.

**Status:** v0.1.2 personal trial build. Lint, automated tests, and the production build are checked. Manual Chrome/Brave certification and successful live provider checks are pending; see [compatibility](#browser-compatibility) and [manual tests](docs/MANUAL_TESTS.md). This is not a Chrome Web Store publication.

<!-- Demo GIF placeholder: replace with docs/assets/demo.gif after recording synthetic test tabs. -->
**Demo GIF:** coming after browser validation. Do not record personal tabs or API keys.

## Features

- Strictly one window at a time; no all-windows mode or cross-profile behavior.
- Always-available **By website** and **By content type** strategies, entirely on device.
- Optional AI suggestions, custom instructions, and refinements through a ChatGPT plan, Anthropic, an OpenAI-compatible endpoint, or local Ollama. No hosted Tab Sorter server.
- Flat native groups with titles and colors, group previews, Collapse all, and Ungroup all.
- Per-group Undo, Ungroup, and Collapse/Expand in the persistent **Groups created** list.
- **Undo all** and the last five snapshots per window, including recovery after a restart where tab identity can be established.
- Saved instruction presets, local strategy preferences, dark/light theme, and keyboard controls.

## Build and install

Requires Node.js 22.12+ and npm. Download the repository or clone it:

```sh
git clone https://github.com/Kaaushikk/tab-sorter.git
cd tab-sorter
npm ci
npm run build
```

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose the project's **dist** folder.
4. Open the extensions menu and select **Tab Sorter**. Pin it if desired.

### Brave

1. Open `brave://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose the same **dist** folder, unchanged.
4. Open the extensions menu and select **Tab Sorter**. Pin it if desired.

After rebuilding, click Reload on the extension's card and reopen the popup. Do not load the source folder; load `dist`.

## Use it

Open Tab Sorter from the window you want to organize. Click a local strategy card to expand its tab preview, then **Apply grouping**. AI is optional. Existing groups and pinned tabs are skipped by default; adjust these choices in Settings.

Use **Suggest groupings** for AI ideas or type an instruction such as “separate work from entertainment.” Clear instructions such as “group by website” run locally. Complex instructions that merely mention a website use AI. With a selected plan, enter a refinement such as “merge the book groups.” Suggestions, instructions, and refinements never apply automatically.

Press **Enter** in the instruction box to preview; **Shift+Enter** adds a newline. **Ctrl+Enter** (or Cmd+Enter on macOS) applies the selected preview. Cancel clears the selection. Tab and Enter work with every control.

Grouping included pinned tabs requires unpinning them because native groups cannot contain pinned tabs. Undo restores pinning where possible. “Merge” matches an existing group's name **and color**; ambiguous matches stop the operation. “Dissolve” only dissolves participating tabs, preserving tabs excluded from the plan.

### Undo behavior

The popup remembers up to five snapshots per window in local storage. Each group has an **Undo** button to restore only that group's participating tabs. **Ungroup** removes membership without restoring prior groups, and creates its own undo snapshot. **Undo all: [label]** restores the remaining changes in that snapshot. Older snapshots remain expandable.

Closed tabs are skipped, never reopened. Tabs moved to another window, manually regrouped, navigated to a different URL, or affected by conflicting prior-group changes are left alone and counted in the result. Browser IDs change on restart; recovery uses unique URLs plus group titles, colors, and membership within the popup's window. Duplicate URLs and ambiguous window matches are skipped. This is deliberately best-effort: group identity is not guaranteed after arbitrary browser edits. For exact tab-order restoration, undo the most recent operation before making manual edits.

Histories of normally closed windows are cleaned on subsequent use. Histories from a previous browser session are retained for up to seven days to allow restart matching, then expired on use. This retention avoids deleting every snapshot when browser shutdown closes its windows. Settings → **Clear all undo history** removes them immediately.

## AI provider setup

### ChatGPT plan

Use an eligible ChatGPT plan with the **ChatGPT plan** provider. This preview uses OpenAI's official browser sign-in and requires the local Tab Sorter helper. No API key is needed.

1. On Windows, double-click **Start ChatGPT helper.cmd** in the project folder. On any supported Node.js installation, you can also run `npm run chatgpt` from the project folder. Keep the helper running while using ChatGPT for grouping.
2. In **Tab Sorter → Settings**, choose **ChatGPT plan** and paste the local pairing code shown by the helper. Click **Continue with ChatGPT** and allow Tab Sorter to connect to the local helper.
3. Sign in and approve plan usage on OpenAI's page. Return to Settings, click **Check connection**, choose a model, and click **Save settings**. Then try **Suggest groupings** in the popup.

The helper listens only on `127.0.0.1:43128`. Its pairing code authenticates the extension to the helper; OpenAI sign-in tokens stay in a local credential file under your user profile. Tab Sorter applies the same titles-only and excluded-domain settings before sending tab details to OpenAI. Eligible requests use your ChatGPT plan or available credits. Use **Sign out** in Settings to end the local session and **Manage ChatGPT usage** to review limits or revoke access. [OpenAI sign-in documentation](https://developers.openai.com/siwc/token-sharing-open-source).

Open Settings with the gear button. Choose a provider, enter its exact model ID and configuration, click **Allow endpoint access**, then **Save settings**. Host access is requested only for that endpoint, never at install. Switching providers clears the unsaved key/model fields; save the desired configuration.

### Anthropic

Use your own Anthropic key and an available model ID from your account. Requests go directly to `https://api.anthropic.com/v1/messages`, including the required `anthropic-dangerous-direct-browser-access: true` header. Some organization policies disallow direct browser calls even with a valid key; see [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication).

### Custom AI provider

Enter a base URL, typically `https://api.openai.com/v1`, a key, and a model ID supported by that server. Tab Sorter appends `/chat/completions`, enables streaming, and requests `response_format: {type: "json_object"}`. It also accepts a complete JSON response if the server ignores streaming. The endpoint must support Chat Completions and JSON mode. Remote endpoints require HTTPS. Redirects and URL-embedded credentials are rejected. Custom paths such as `https://host.example/api/v1` are supported.

For an OpenRouter free trial, choose **Custom AI provider**, set the base URL to `https://openrouter.ai/api/v1`, click **Use free Gemma 4** (model ID `google/gemma-4-26b-a4b-it:free`), and use your OpenRouter key. Allow endpoint access and Save. Version 0.1.2 moves existing `openrouter/free` settings to this fixed model once, retaining the key and other preferences. Gemma 4 runs with reasoning disabled for this task. The model remains editable and the extension does not switch to paid models. Free availability and rate limits are controlled by OpenRouter. See the [free Gemma 4 listing](https://openrouter.ai/google/gemma-4-26b-a4b-it:free).

### Ollama

Use `http://localhost:11434` and the name of a locally installed model. No API key is sent. Requests use `/api/chat`, non-streaming responses, and JSON format. Providers must send response headers within 25 seconds; the whole response has a 60-second deadline. A cold model can exceed the connection deadline; warm it locally before retrying.

Ollama may require its `OLLAMA_ORIGINS` environment setting to allow the extension origin, such as `chrome-extension://YOUR_EXTENSION_ID`. Set it through your normal OS configuration, then restart Ollama. Find the ID on the browser's extensions page. Chrome and Brave unpacked IDs may differ, so allow each actual origin. Prefer specific origins over allowing every extension. See the [official Ollama FAQ](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama).

The usual suggestion request asks for three candidate strategies. Above 100 eligible tabs, Tab Sorter builds one topic plan in batches of up to 100 and carries group names across batches. This cuts how much the model needs to write. Custom instructions still use batches of up to 150. A malformed JSON response is retried once per batch. The popup shows the current stage and elapsed time, including retries. **Cancel request** stops reading the provider response and leaves tabs unchanged. Closing the popup keeps the current request active; reopen it to see progress. Local strategies remain available if AI fails.

## What data leaves your browser?

**Local strategies:** nothing. No analytics, telemetry, remote code, website scraping, or backend. No content scripts are injected.

**Only on an explicit AI action:** eligible tab IDs, titles, hostnames, URL paths without query strings or fragments, and locally inferred content types go directly to your selected provider. Titles-only mode sends IDs and titles. Your instruction and eligible plan group names/IDs are included for custom grouping/refinement. Excluded domains (including subdomains), incognito tabs, and non-HTTP(S) pages are never included. Excluded tabs stay unchanged by AI plans but can be grouped locally.

Titles and paths can still contain sensitive information. Exclude private domains or use local mode. Your provider's retention and billing policies apply. Keys are stored only in `chrome.storage.local` and sent only as authentication to the selected provider; they are not encrypted by this extension or synced. Undo snapshots contain full local URLs, titles, group state, and order, but are never sent to AI. See [PRIVACY.md](PRIVACY.md).

## Browser compatibility

One Manifest V3 package targets both Chrome and Brave. Runtime feature detection reports unavailable `tabGroups` support. No browser-specific code paths, account APIs, or sync storage are used. See the official [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups), and [window context](https://developer.chrome.com/docs/extensions/reference/api/windows#the-current-window) references.

### Known differences between Chrome and Brave

No difference has been confirmed by manual testing in this environment. Brave's vertical tabs and Shields configuration must be tested before release; their behavior is not assumed from shared API names. Endpoint permission prompts and local-provider origin configuration can differ between profiles. Do not disable Shields globally as a troubleshooting step.

| Feature | Chrome on Windows 11 | Brave on Windows 11 | Tested browser version |
| --- | --- | --- | --- |
| Load unchanged MV3 package | Manual test pending | Manual test pending | Not recorded |
| Group titles/colors and collapse/expand | Manual test pending | Manual test pending | Not recorded |
| Per-group and whole undo | Automated API-mock tests pass; manual pending | Automated API-mock tests pass; manual pending | Not recorded |
| Browser restart recovery | Simulated restart tests pass; manual pending | Simulated restart tests pass; manual pending | Not recorded |
| Several-window isolation | Automated command tests pass; manual pending | Automated command tests pass; manual pending | Not recorded |
| Remote API and Ollama | Request-format/privacy tests pass; live pending | Request-format/privacy tests pass; live pending | Not recorded |
| Shields on / vertical tabs | Not applicable | Manual test pending | Not recorded |

Browser automation stopped before extension installation because it could not reliably determine the current URL. User-provided screenshots on November 6, 2026 confirm the settings and popup load and display 16 tabs with local content-type groups; an OpenRouter suggestion attempt in v0.1.0 timed out and the v0.1.1 free-router request was slow. Version 0.1.2 uses a fixed free model, reduces the requested output, and adds progress/cancellation regression tests. Its live retry remains pending. This table intentionally records no completed manual certification runs. Execute [the checklist](docs/MANUAL_TESTS.md) on the latest stable versions and record exact versions and results before publishing.

### Troubleshooting

- **Empty local preview:** existing groups and pinned tabs are kept by default. Change those settings or open ungrouped test tabs.
- **Endpoint access:** click Allow endpoint access in Settings and accept the browser's prompt. Re-check the selected base URL and model, then Save.
- **401/403:** check the key and provider account restrictions. With Ollama, check allowed origins and restart its server.
- **Network failure / Brave:** first verify endpoint access, HTTPS URL, local server availability, and origin configuration. Test a per-site Shields adjustment only if a reproducible issue demonstrates it is needed; record the exact issue, browser version, and minimal change. No Shields exception has been verified as necessary.
- **Invalid JSON:** try a model that supports structured JSON. The extension retries malformed output once and leaves tabs unchanged if validation still fails.
- **AI timeout:** response headers have a 25-second deadline and each request has a 60-second total deadline. A busy free provider may still time out. Use **Cancel request**, try again later, or select another available free model. If the popup was closed, reopen it to check the active request or its preview.
- **Popup closed during an operation:** reopen it. Preview data lives in session storage, undo checkpoints in local storage. An interrupted apply appears in history; check it before retrying. A browser termination between an API mutation and its checkpoint can leave only a partial record; review the live groups.
- **Stale preview:** reopen the popup and select a fresh plan after changing tabs or settings.
- **Restart undo missing:** restore the original browser session's tabs first; duplicate URLs or indistinguishable old windows prevent automatic matching.

## Development

```sh
npm ci
npm run check       # ESLint, Vitest, TypeScript, Vite production build
npm run dev         # rebuild on edits; reload the extension manually
npm run test:watch
npm run package     # artifacts/tab-sorter-0.1.2.zip (manifest at archive root)
node scripts/icons.mjs
```

The extension is vanilla TypeScript. Production code has no third-party runtime dependencies; all JS/CSS is bundled locally. `fflate` is a development tool for icon generation and packaging. Node 22+ is used in CI. The lockfile pins reproducible dependencies.

```text
src/background/       command routing and serialized mutations
src/popup/            selection, previews, presets, group actions
src/options/          provider, privacy, behavior, presets
src/lib/browser.ts    explicit window-scoped browser adapter
src/lib/grouping.ts   local signals, strategies, batching
src/lib/providers.ts  provider interface, prompts, validation/retry
src/lib/undo.ts       durable snapshots and conservative restoration
src/lib/storage.ts    local/session persistence
src/lib/sanitize.ts   outbound privacy and endpoint validation
src/lib/validation.ts strict JSON schemas and tab-ID invariants
tests/                real command integration plus browser API mocks
```

All tab and group queries must supply an explicit `windowId`. Do not add an all-windows query, injected page script, remote dependency, or telemetry. Tests prove other-window tabs are absent from reads and snapshots. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the original [SPEC.md](SPEC.md).

## Release

Pull requests and main-branch pushes run lint, tests, and build on Windows and Linux. A `vX.Y.Z` tag validates the version, builds the extension, and attaches its ZIP to a GitHub Release. Do not tag a stable release until the browser/provider checklist is complete. Store submission is separate and initially manual; see [RELEASING.md](docs/RELEASING.md) and [STORE_LISTING.md](STORE_LISTING.md).

MIT licensed. The working name can be changed in `package.json`, `public/manifest.json`, popup branding, and documentation.
