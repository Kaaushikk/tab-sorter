# Contributing

Thanks for helping make tab organization dependable and private.

## Development

Use Node.js 22.12+ and npm. Run `npm ci`, `npm run check`, and `npm run build`. Load `dist` unpacked in a separate test profile in both Chrome and Brave. `npm run dev` rebuilds on changes; reload the extension's card after each rebuild.

Keep changes focused. Describe the problem, resulting behavior, test evidence, and remaining limitations in your pull request. Run the relevant tests while iterating and the complete check suite before submission. Add regression coverage for window scoping, privacy, or undo changes. The [manual checklist](docs/MANUAL_TESTS.md) is required for browser-affecting releases; record real browser versions and do not mark simulated behavior as manually verified.

## Invariants

- Every tab and group query has an explicit window ID captured by the popup. Never use an unfiltered query or a service worker's current/last-focused window.
- Check membership in the target window before mutations; never move tabs into a destination window as part of undo.
- Treat tab metadata and model output as untrusted. Use textContent, strict plan validation, outbound sanitization, and no remote code.
- Keep API keys and browsing data out of logs, fixtures, screenshots, issues, and commits. Use synthetic tabs and obvious fake credentials in tests.
- User state belongs in local/session storage, not service-worker globals. Preserve undo checkpoints around destructive operations.
- Native groups are flat. Preserve local strategies when AI is absent or fails.
- Keep one build for both browsers. Put an unavoidable compatibility adaptation in `src/lib/browser.ts` and explain it.

## Issues and pull requests

Search existing issues, then use the bug or feature template. Report security concerns privately following [SECURITY.md](SECURITY.md). By contributing, you agree your contribution can be distributed under the project's MIT license. Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
