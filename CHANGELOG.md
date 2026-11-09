# Changelog

This project follows semantic versioning. Before 1.0.0, behavior and storage formats may evolve between minor versions.

## [Unreleased]

### Changed in v0.2.4

- Guide new users from the popup through ChatGPT setup. Approve the local connection in the browser and save an available model automatically. Manual pairing and model choices are under Advanced.

### Changed in v0.2.3

- For more than 100 eligible tabs, build one topic plan in smaller batches with short tab IDs to reduce generation time.

### Changed in v0.2.2

- Show suggested grouping cards under **Suggest groupings**, above custom instructions and the local strategies.

### Fixed in v0.2.2

- Add the required UUID namespace to the ChatGPT helper's host ID. Restarting the helper upgrades existing IDs and preserves the pairing code.
- Forward ChatGPT plan responses when OpenAI streams events without a content type. The extension still checks that the response completed.

### Fixed in v0.2.1

- Open the popup before reading the active provider. Show the ChatGPT plan label once settings have loaded.

### Added in v0.2.0

- Use an eligible ChatGPT plan for tab previews through OpenAI's sign-in flow and an optional local helper.

### Fixed in v0.1.3

- Retry an empty OpenRouter stream once as a complete response from the same model. Distinguish empty, oversized, and filtered replies in the popup.

### Changed in v0.1.2

- Migrate the previous OpenRouter free-router setting once to the fixed, free Gemma 4 model with reasoning disabled. Preserve the user's key, endpoint, privacy settings, and explicit model selections.
- Request three compact AI plans rather than asking the model to repeat local website/content-type plans.
- Show connection, waiting, receiving, validation and retry stages, elapsed time, and the selected model. Reopening the popup can resume monitoring an active request.
- Cancel requests from the popup without changing tabs; limit each provider request to 60 seconds and distinguish connection timeouts from incomplete responses.
- Rename the custom provider option and add a **Use free Gemma 4** shortcut for OpenRouter setups.

### Fixed

- Stream responses from custom AI providers so slow free endpoints can start responding without waiting for the entire plan.
- Separate the connection and generation deadlines, with bounded service-worker activity only while a request is active.
- Catch body-read timeouts and interrupted streams; show actionable errors instead of raw "signal timed out" messages.
- Explain the AI wait in the popup and preserve the user's selected free model.

### Added

- Manifest V3 extension for local website/content-type grouping in the popup's window.
- Preview, apply, collapse/expand, ungroup, individual group undo, and whole undo.
- Five durable snapshots per window with conservative URL/group rematching after restart.
- Anthropic, OpenAI-compatible, and Ollama providers; JSON validation/retry; coordinated batching.
- Custom instructions, refinements, saved presets, local preference ordering, and privacy settings.
- Pinned/existing-group policies, endpoint permission requests, and runtime feature detection.
- Unit and background-command integration tests, CI, ZIP packaging, and release documentation.

### Validation remaining

- Latest stable Chrome and Brave manual checklist on Windows 11, including restart, Shields, and vertical tabs.
- Live remote provider and local Ollama requests in both browsers.
- Actual store screenshots and demo GIF. No store publication or release tag yet.
