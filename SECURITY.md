# Security

## Supported versions

Security fixes target the latest development version on `main` and the latest published release. Version 0.1.0 is a development preview, pending manual browser and live-provider validation.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/Kaaushikk/tab-sorter/security/advisories/new) if enabled. If unavailable, open an issue containing only “Please enable private vulnerability reporting” and no sensitive details. Do not publish an exploitable report, API key, personal tab URL, or browsing history in a public issue.

Include affected version, browser/version, a minimal reproduction with synthetic tabs, expected and observed behavior, and likely impact. Do not test against other people's tabs, profiles, keys, or AI accounts. Maintainer response times are not guaranteed; coordinated disclosure is appreciated.

## Boundaries

The extension has no content scripts or remote code. Only trusted extension pages can invoke background commands. All queries use a specified window; plans reject unknown or repeated IDs. Outbound payloads are sanitized and requests omit cookies and reject redirects. Endpoint access is opt-in. Secrets are stored locally, not encrypted by the extension. Anyone with access to the browser profile may be able to read them.

Tab URLs/titles and user instructions may contain sensitive data even after sanitization. Provider policies apply to explicitly requested AI calls. Local strategies send nothing. Undo snapshots contain full local URLs and can be erased in Settings. Browser changes are asynchronous; avoid manually moving tabs during Apply/Undo. If interrupted, inspect partial history and live groups before retrying.
