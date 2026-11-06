# Manual verification checklist

Use separate browser test profiles and synthetic tabs. Run on Windows 11 with the latest stable Chrome and Brave. Record exact versions from the browser's About page before running. Automated mock tests do not substitute for these results.

**Current result:** not executed. Browser automation stopped before installation because the active URL could not be identified confidently. No native-browser behavior or live provider success is claimed.

## Stage 1: local grouping and undo

1. Build and load `dist` in Chrome, then load the same directory in Brave. Verify the icon and popup display without errors.
2. Open two regular windows with different synthetic tabs. In window A, open two GitHub pages, two Wikipedia pages, and two example.com pages; in B, open unrelated pages.
3. Open the popup in A. Verify website/content-type cards reflect only A's tabs. Select a card, expand group previews, Cancel, then select again and Apply. Verify B is unchanged throughout.
4. Check titles and colors on native groups. Collapse/expand each from the popup, then Collapse all. Use Ungroup on one group; verify its tabs are only ungrouped and its action can be undone from history.
5. Undo only one created group. Confirm the others retain their membership and metadata. Undo all and confirm prior membership/order. Repeat twice to test multi-level history, and apply six times to test the five-snapshot limit.
6. Repeat starting with existing groups: Keep, Merge with matching title/color, and Dissolve. Undo into a surviving previous group and a previous group that disappeared.
7. Close a tab after Apply; Undo must skip it and report a count without reopening it. Move a tab to another group and another to window B; Undo must leave them alone. Edit a prior group; conflicting restores must skip rather than overwrite it.
8. Enable pinned inclusion. Group a pinned tab, verify it unpins, then Undo and verify original pinning/order.
9. After Apply, close the browser with session restoration enabled in the **test profile only**, reopen/restore A and B, then open the popup in A and test per-group Undo. Repeat with duplicate URLs; ambiguous duplicates must be skipped. Test a restart after one of two per-group undos.
10. Stop/restart the extension service worker from its devtools and verify durable undo remains. Interrupt an apply, reopen the popup, inspect its partial history, and verify no cross-window changes.

Record Stage 1 in both browsers before declaring this stage manually verified.

## Stage 2: AI suggestions and refinement

1. For each provider, enter a real, user-controlled model/key or local model, grant only its endpoint, then Save. Inspect requests in extension worker devtools without recording keys or private tabs.
2. Suggest: verify normally one call, candidate variety, local fallback, and previews. Refine a selected strategy. Run a custom instruction and “group by website” (the latter must make no network call).
3. Test invalid key, offline server, rate limiting if available, and malformed model JSON. Verify one JSON retry, helpful errors, unchanged tabs, and local cards still usable.
4. Use 151+ synthetic tabs and verify batches preserve consistent names and each eligible tab appears at most once per strategy. Do not incur unexpected provider costs without the account owner's agreement.

## Stage 3: controls and privacy

1. Add a preset, save, reopen the popup, and use its chip. Remove it and Save. Verify strategy preference ordering after several successful applies.
2. Test titles-only, excluded domains/subdomains, pinned policy, existing-group policy, and unassigned behavior. Verify actual request bodies contain no query strings, fragments, credentials, excluded tab data, or internal/file/extension pages.
3. Navigate/close/move a tab after preview; Apply must reject stale or out-of-window tab IDs. Change excluded domains after an AI preview; that preview must no longer apply excluded tabs.
4. Test popup reopening during a long request, keyboard navigation, Enter/Shift+Enter, Ctrl/Cmd+Enter, and light/dark OS themes.
5. Clear undo history, confirm no snapshots remain, and verify Local only + Save removes the configured key. Verify incognito activation is unavailable.
6. In Brave, repeat local, remote-provider, and Ollama tests with **Shields on** and **vertical tabs enabled**. Record the exact setup. Do not assume shared Chromium APIs imply identical behavior.

## Stage 4: release

Run `npm ci`, `npm run check`, and `npm run package` from a clean checkout. Extract the ZIP into a new directory and load it in both browsers. Confirm the manifest is at the ZIP root. Check all public docs and the privacy notice match actual behavior. Verify no keys, private URLs, test profiles, build caches, or environment files are tracked. Update the README compatibility table with actual evidence.

| Date | OS | Browser and exact version | Shields / vertical tabs | Local + undo + restart | Remote provider / model | Ollama / model | Result / issue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | Windows 11 | Chrome — not recorded | N/A | Pending | Pending | Pending | Not run |
| Pending | Windows 11 | Brave — not recorded | On / On to test | Pending | Pending | Pending | Not run |
