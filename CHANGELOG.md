# Changelog

This project follows semantic versioning. Before 1.0.0, behavior and storage formats may evolve between minor versions.

## [Unreleased]

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
