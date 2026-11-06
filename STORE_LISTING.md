# Draft store listing

Not submitted. Complete the browser/provider checklist and capture real UI assets before submission.

## Name

Tab Sorter

## Short description

Organize this window into native tab groups. Preview local or optional AI plans, apply, and undo each group.

## Detailed description

Turn a crowded browser window into clear native tab groups. Tab Sorter organizes only the window where you open it, so your other workspaces stay separate.

Group by website or content type entirely on your device. Optionally connect your own Anthropic key, an OpenAI-compatible endpoint, or local Ollama for grouping suggestions and plain-English instructions. Refine a suggested plan, inspect every group and tab title, then apply when ready.

Fix a single group with its own Undo, Ungroup, or Collapse/Expand controls. Undo the entire last grouping or revisit up to five snapshots per window. Closed, manually moved, and conflicting tabs are skipped rather than forced back. Restart restoration uses conservative URL/group matching and may skip ambiguous tabs.

Save one-click instruction presets, choose how to handle existing groups and pinned tabs, and control what is sent to AI. The extension has no backend, analytics, or telemetry. API keys stay in your browser profile. AI actions send eligible metadata directly to the provider you select; provider terms, retention, and charges apply. No AI setup is needed for local grouping.

## Single-purpose statement

Organize the current browser window's tabs into native tab groups with previews and reversible group-management controls.

## Permission justifications

| Permission | Why it is needed |
| --- | --- |
| `tabs` | Read titles, URLs, positions, pinning, and membership from the explicitly selected window to infer local groups, preview plans, validate operations, and restore prior state. |
| `tabGroups` | Read and update native group titles, colors, collapsed state, and membership-related metadata for the selected window. |
| `storage` | Save provider configuration and keys locally, presets, local strategy counts, per-window undo snapshots, and transient session previews. No sync storage is used. |
| Optional `https://*/*` | Allows user-selected HTTPS AI endpoints. Actual endpoint access is requested at runtime for the configured origin; broad access is not granted at install. |
| Optional `http://*/*` | Supports configurable loopback endpoints, particularly local Ollama. Runtime validation restricts HTTP to localhost/loopback and requests that origin only. |

No remote code is used. No content scripts, history API, identity, or account permissions are requested. Native `chrome.windows` metadata calls do not require an additional `windows` permission.

## Required assets and submission fields

- 128×128 icon: `public/icons/128.png` (included, original code-generated artwork).
- At least one real 1280×800 screenshot showing the popup and synthetic tabs; capture more for preview, undo, and settings.
- Optional promotional tile, commonly 440×280; verify current dashboard requirements before export.
- Public privacy-policy URL: host `PRIVACY.md` as a page or point to its public GitHub rendering.
- Support and homepage URLs: the repository and issue tracker.
- Complete dashboard privacy/data-use disclosures consistently with `PRIVACY.md`; mention tab metadata sent only for user-requested AI calls.
- Declare that all executable code is packaged and that AI outputs are validated data, never executed.

Do not use personal tabs, provider keys, fake review badges, or invented compatibility claims in assets. The first store upload is manual. See [release instructions](docs/RELEASING.md).
