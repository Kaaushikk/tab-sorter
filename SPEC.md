# Task: Build an open-source Chrome/Brave browser extension, "Tab Sorter" (working name, easy to rename)

Build a Manifest V3 browser extension for Chrome and Brave that organizes the user's open tabs into native browser tab groups. The user can either pick from AI-suggested grouping strategies or type their own instruction in plain English (e.g. "group by website", "separate work from entertainment", "everything about my thesis, rest into Misc").

## 1. Scope: one window at a time for grouping
- Grouping operations (suggest, preview, apply, undo, ungroup all, collapse all) apply only to the window the popup was opened in. Use the popup's own window ID for tab queries.
- Tabs from other windows are excluded from grouping operations and AI requests.
- The explicit **Sleep tabs across all windows** action can unload eligible pages across regular windows in the current profile. It keeps all tabs open and runs locally.
- Reason: users keep different contexts in different windows (often one per Windows virtual desktop), and may have several windows per browser, each with unrelated tabs.

## 2. Primary flow: suggested groupings
1. User opens the popup and clicks "Suggest groupings". A text box for a custom instruction is always available as an alternative path.
2. Collect the current window's tabs as {id, title, url, hostname}. Compute local signals first: hostname and content type (video, article, docs, code, social, shopping, search, other) via a hostname/URL-pattern map.
3. Make ONE LLM call that returns 3-5 distinct grouping strategies as strict JSON:
     {"strategies":[{"id":"string","label":"By topic","description":"one line","groups":[{"name":"string","color":"blue|red|yellow|green|pink|purple|cyan|orange|grey","tabIds":[number]}]}]}
   Strategy variety where applicable: by topic, by content type, by topic + content type, by website. Skip strategies that would produce a single group or all-singleton groups.
   Example: if many tabs are about books but spread across YouTube videos and articles, offer "By topic" (Books), "By content type" (YouTube, Articles), and "By topic + type" (Books - YouTube, Books - Articles).
4. Chrome tab groups are flat and cannot be nested, so combined strategies use flat names like "Books - YouTube".
5. Always include the local, no-AI strategies "By website" and "By content type", even if the AI call fails or no API key is configured.
6. Show each strategy as a selectable card with group names and tab counts; clicking expands a preview of tab titles per group.
7. After selecting a strategy, the user can type a refinement ("merge the book groups", "put YouTube tabs in their own group"). Send the chosen strategy + refinement to the LLM and return an updated plan.
8. User clicks Apply (or Cancel). On Apply, create native groups via chrome.tabs.group and chrome.tabGroups.update (title, color).
9. Extra buttons: "Ungroup all", "Collapse all groups".
10. Remember which strategy type the user picks most often and list it first next time (stored locally only).

## 3. Custom instruction path
- Fast path, no network: if the instruction clearly means domain grouping (keywords like "domain", "website", "site"), group by hostname locally. Optionally merge subdomains (docs.google.com + mail.google.com as "Google").
- Otherwise call the LLM with the tab list + instruction and require strict JSON:
     {"groups":[{"name":"string","color":"blue|red|yellow|green|pink|purple|cyan|orange|grey","tabIds":[number]}]}
- Always show the preview before applying.

## 4. Undo (whole grouping AND per group)
- Before every Apply, "Ungroup all", or merge/dissolve of existing groups, save a snapshot for that window: for each tab, its ID, URL, and prior group membership (group title, color, collapsed state), plus tab order. Also record which tabs ended up in which newly created group (a map of new group -> tab IDs -> snapshot ID).
- Per-group undo (primary): after applying, the popup shows a "Groups created" list. Each group row has its own "Undo" button that reverts ONLY that group: its tabs return to their prior state (their previous group if it still exists or can be recreated with the same title and color, otherwise ungrouped). All other groups stay untouched.
- Each row also has "Ungroup" (just removes the group, no restore) and "Collapse/Expand".
- Whole-grouping undo: a separate "Undo all" button reverts the entire last Apply, equivalent to undoing every group from that snapshot. Show a short label of what it reverts (e.g. "Undo all: By topic").
- Keep the last 5 snapshots per window (multi-level undo), stored per window ID. Per-group undo works for groups from any of the kept snapshots.
- Persist snapshots in chrome.storage.local so undo survives service worker and browser restarts. Browser group IDs change across restarts, so after a restart re-match groups by tab URLs, group title, and color. Clean up entries for closed windows.
- Edge cases, handled gracefully:
  - A tab closed since the snapshot is skipped (never reopened); tell the user how many could not be restored.
  - A tab the user has manually moved out of the group, or into another group, since Apply is left alone; per-group undo only touches tabs still in that group.
  - A tab moved to another window is left alone.
  - If undoing a group would recreate an old group that now has conflicting changes, prefer leaving the tab where it is and report it.
- Undo never touches other windows.

## 5. LLM layer
- Providers in Settings: (a) Anthropic API with the user's own key (browser calls need the header "anthropic-dangerous-direct-browser-access: true"), (b) any OpenAI-compatible endpoint (custom base URL + key), (c) local Ollama at http://localhost:11434. Model name is user-configurable.
- Put providers behind a small interface so adding more is easy.
- Strict JSON handling: instruct the model to output JSON only, strip markdown code fences, validate against the schema, retry once on malformed output.
- Validate every plan: all tab IDs exist, no tab in two groups, unassigned tabs go to an "Other" group or stay ungrouped (setting).
- For windows with more than 150 tabs, batch the tabs and keep group names consistent across batches.

## 6. Privacy and security
- API keys live only in chrome.storage.local; never in code, logs, or the repo.
- By default send only title + hostname + path without query string (query strings often hold tokens). Setting to send titles only.
- Setting "Exclude domains from AI" (e.g. banking, email): those tabs are handled locally or left alone.
- Never send incognito tabs (do not enable in incognito). Never send chrome://, brave://, or extension page URLs to the AI.
- Request minimal permissions: tabs, tabGroups, storage; use optional_host_permissions for AI endpoints and request them at runtime when the user picks a provider.
- Settings page includes a plain-language notice of exactly what data is sent to the chosen provider.
- No analytics, telemetry, or backend of any kind.
- The extension must remain fully useful with no AI configured (local strategies only).

## 7. Edge cases
- Pinned tabs: skipped by default (setting to include).
- Existing tab groups: setting to keep, merge into, or dissolve first (all are undoable via section 4).
- Missing/loading titles: fall back to hostname.
- Service worker can be killed: keep transient state in chrome.storage.session, durable state (settings, undo snapshots) in chrome.storage.local; never rely on globals.
- Extensions are installed per browser profile; no cross-profile behavior is needed or possible.

## 8. UX
- Compact popup (~380px wide), light/dark aware, keyboard friendly (Enter to run, Ctrl/Cmd+Enter to apply).
- After applying, keep the "Groups created" list visible in the popup so the user can fix individual groups without re-running the whole flow.
- User-defined saved presets as one-click chips alongside suggestions.
- Clear loading states and errors (bad key, network failure, invalid AI output).
- Options page via chrome.runtime.openOptionsPage.

## 9. Tech stack
- TypeScript, Vite (or esbuild), Manifest V3. No heavy frameworks (vanilla TS or Preact at most). Bundle everything; no remote code.
- Structure: /src/background, /src/popup, /src/options, /src/lib/{grouping,providers,storage,undo,sanitize,browser,types}.ts
- Vitest unit tests for domain and content-type grouping, strategy/plan JSON parsing and validation, batching, URL sanitizing, window-scoped grouping, tab sleep across regular windows, and undo. Cover whole-snapshot restore, per-group restore leaving other groups untouched, tabs closed or manually moved since Apply, restoring into a previously existing group, the 5-snapshot limit, and re-matching groups after a simulated restart.

## 10. Open-source and release readiness
- MIT license (LICENSE file), .gitignore (including .env), no secrets anywhere in the repo or history.
- README: what it does, demo GIF placeholder, install steps for Chrome (chrome://extensions) and Brave (brave://extensions) via "Load unpacked", AI provider setup, a "what data leaves your browser" section, and a development section.
- CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, issue and PR templates, CHANGELOG.md (semantic versioning).
- PRIVACY.md written as a standalone privacy policy suitable for hosting on GitHub Pages: no backend, no analytics, keys stay on-device, data goes only to the provider the user selects.
- GitHub Actions: on pull requests run lint + tests + build; on version tags build and attach a zip of the extension to a GitHub Release.
- STORE_LISTING.md with draft Chrome Web Store text: short description, detailed description, single-purpose statement, and a justification for each requested permission. Avoid "Chrome" or "Brave" in the extension name. Note required assets: 128px icon, 1280x800 screenshots, optional promo tile.
- Notes on packaging for the Chrome Web Store (first submission is manual; later updates can be automated).

## 11. Browser compatibility (Chrome AND Brave are equal targets)
- One codebase, one Manifest V3 package that loads unchanged in both Chrome and Brave. No browser-specific forks or build flavors unless unavoidable; if one is needed, isolate it behind a small adapter in /src/lib/browser.ts.
- Use only the standard chrome.* APIs shared by both (tabs, tabGroups, windows, storage, runtime). Do not use any Chrome-only or Google-account-dependent APIs (e.g. chrome.identity sign-in, Chrome sync storage for secrets).
- Feature-detect at runtime: if chrome.tabGroups is missing or a call fails, show a clear message instead of crashing.
- Test manually on both browsers and document results in the README: Windows 11, latest stable Chrome and latest stable Brave, including Brave with Shields on and with vertical tabs enabled. Confirm in both: group creation, titles/colors, collapse/expand, per-group undo, undo after browser restart, and window scoping with several windows open.
- Make sure local Ollama (http://localhost:11434) and remote API calls work in both. Brave Shields or Brave's privacy defaults must not break them; if something needs a user setting (e.g. allowing the extension to access the endpoint), document it in the README troubleshooting section.
- README: separate install instructions for Chrome (chrome://extensions) and Brave (brave://extensions), both using Developer mode + "Load unpacked", plus a "Known differences between Chrome and Brave" section.
- Keep a short compatibility table in the README: feature x browser x tested version.

## Deliverables and working style
1. Complete working source, build config, tests, and all docs listed above.
2. Work incrementally and, after each stage, summarize what works and how I can test it manually:
   Stage 1: scaffold + window-scoped local strategies (by website, by content type) + preview/apply + whole and per-group undo; verify it loads and works in both Chrome and Brave before moving on.
   Stage 2: AI provider layer + suggested strategies + refinement.
   Stage 3: settings, presets, privacy controls, edge cases.
   Stage 4: tests, CI, and open-source/release docs.
3. Flag any Brave-specific caveats you find with chrome.tabGroups.
