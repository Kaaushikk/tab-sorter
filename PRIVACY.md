# Tab Sorter Privacy Policy

Effective November 7, 2026. Applies to Tab Sorter versions 0.2.x.

## No backend, analytics, or tracking

Tab Sorter has no backend and does not collect analytics, telemetry, advertising identifiers, or usage reports. Its authors do not receive browsing data or API keys through the extension. It does not sell data, inject content scripts, read website content, or execute remote code.

## Data processed on your device

When you open the popup, Tab Sorter reads tab IDs, titles, URLs, positions, pinned state, and native tab group metadata **only in that popup's browser window**. Local strategies infer website and content type from hostnames and URL patterns. It does not read tabs in other windows or profiles. Incognito operation is disabled.

Settings, API keys, saved presets, strategy selection counts, and undo snapshots are stored in `chrome.storage.local` in the current browser profile, not sync storage. Each window keeps at most five undo snapshots containing local full URLs, titles, order, group membership, title, color, and collapsed state. Session storage holds transient previews and browser-session identity. This extension does not encrypt local storage; access to your OS/browser profile may expose it.

## Optional requests to a provider you select

Local grouping sends nothing over the network. Only when you explicitly request AI suggestions, an AI custom instruction, or a refinement does Tab Sorter send data directly to the configured provider:

- Eligible tab IDs and titles.
- By default, hostnames, URL paths, and locally inferred content types. Query strings, fragments, and URL credentials are removed.
- With **Send titles only**, only tab IDs and titles are included as tab data.
- Your grouping/refinement instruction and eligible current plan group names/IDs, where relevant. Batches may include previously generated group names to keep naming consistent.
- Your selected model ID and API key as authentication, when the provider requires a key. Ollama requests do not include a key.

Titles, paths, and your instructions can still contain personal or sensitive information. Consider local mode or excluded domains before sending them. The extension never sends undo snapshots to AI.

Tabs on excluded domains or their subdomains, incognito tabs, browser internal pages, extension pages, file URLs, and other non-HTTP(S) pages are omitted. AI plans leave excluded tabs alone. Local strategies can still organize them on your device.

Possible destinations are OpenAI for ChatGPT plan usage, Anthropic's API, the OpenAI-compatible endpoint you configure, or your configured local Ollama server. The ChatGPT option passes the same filtered tab data through a helper running on your own computer. There is no hosted Tab Sorter intermediary. A custom endpoint is controlled by its operator. Remote endpoints require HTTPS; HTTP is allowed for loopback hosts only. API requests omit browser credentials/cookies and reject redirects.

When you choose **Continue with ChatGPT**, you sign in directly with OpenAI and approve plan usage. The helper stores the account label, registration, and sign-in tokens in a file under your OS user profile. The browser stores a separate local pairing code. **Sign out** clears the selected account's local tokens and attempts to revoke its session. You can also disconnect access in ChatGPT settings. Uninstalling the extension alone does not remove the helper's local file.

The provider's own privacy, retention, training, geographic processing, and billing policies govern the data it receives. Choosing a local Ollama URL sends requests to that local server; Tab Sorter cannot control any additional behavior configured in that server or model runtime.

## Permissions

`tabs` reads the scoped tab metadata needed to preview groups; `tabGroups` manages native groups; `storage` saves preferences, previews, and undo history. Optional HTTP/HTTPS host access allows configurable AI endpoints and is requested at runtime for the selected endpoint. It is not granted at install. No browsing-history, identity, content-script, or sync permission is requested.

## Retention and deletion

Settings and presets stay until changed or the extension is uninstalled. Only the last five snapshots per window are kept. Closed-window histories are cleaned on subsequent use; previous-session histories remain recoverable for up to seven days, then expire on use. Session previews clear with browser-session storage and on apply/window closure.

Use Settings → **Clear all undo history** to remove snapshots. To remove a stored API key, switch the provider to Local only (which clears the key field) and save, or uninstall the extension. Uninstalling removes this extension's local/session storage from that profile. Removing local data does not delete information already sent to a provider; contact that provider under its policy.

## Policy changes and contact

Policy changes are versioned with the open-source repository. For privacy questions, open a discussion or issue at [Tab Sorter on GitHub](https://github.com/Kaaushikk/tab-sorter). Do not post keys, private URLs, or personal browsing data. For sensitive security reports, use the private reporting route in [SECURITY.md](https://github.com/Kaaushikk/tab-sorter/blob/main/SECURITY.md).
