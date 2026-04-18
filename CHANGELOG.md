# Changelog

All notable changes to Kivrio are documented in this file.

## [2026.4.17.1] - 2026-04-18

### Changed
- Improved the width of deterministic math result cards in the chat interface.
- Improved the internal layout of equation, integral, derivative, limit, and ordinary differential equation result cards so labels and values use the available width more effectively.
- Preserved the existing layout of regular LLM response bubbles.

## [2026.4.17] - 2026-04-17

### Added
- Added local guidance messages for deterministic math tools when a math intent is recognized but the expression cannot yet be parsed.
- Added broader natural-language request prefix stripping across derivative, limit, equation, integral, variation, and ODE analyzers.
- Added a Windows installer progress window and refreshed the desktop icon asset used by the installer flow.

### Changed
- Improved the local math router so more natural French prompts stay on deterministic pipelines instead of falling back immediately to the language model.
- Improved the variation pipeline so prompts like `etudier les variations de ...` are handled more robustly, with or without an explicit `f(x)=...`.
- Preserved the language model for explanations and demonstrations while keeping deterministic computation local when the intent is recognized.

## [2026.4.15] - 2026-04-15

### Added
- Added deterministic local math analyzers for variation tables, equation solving, derivatives, limits, integrals, and ordinary differential equations.
- Added dedicated backend endpoints for structured local math workflows.

### Changed
- Improved the Ollama integration to recognize math-oriented prompts and route structured local results back into the chat flow.
- Improved chat rendering so embedded structured math result blocks are preserved and displayed cleanly in the UI.
- Refined the styling of rendered variation tables and aligned the visible UI version to `Kivrio 2026.4.15`.

### Security
- No new security regression was identified during the pre-production validation campaign for this release.

## [2026.4.9] - 2026-04-09

### Added
- Added a first-launch password setup flow so each local Kivrio installation can create and keep its own personal password.
- Added a Windows installer flow with a desktop shortcut, dedicated icon, and automatic launch after installation.
- Added release notes for `Kivrio 2026.4.9`.

### Changed
- Protected the local API with session-based authentication and enforced login/logout server-side.
- Restricted static HTTP serving to public assets only and blocked direct access to internal files and data.
- Routed attachment access through authenticated endpoints instead of direct static file exposure.
- Improved the frontend auth gate, upload auth handling, and session expiry behavior.
- Updated the Windows launcher to wait for local API readiness before opening the browser on first launch.

### Security
- Removed the direct exposure of the SQLite database and backend source files over HTTP.
- Replaced raw internal server error leaks with generic error responses.
- Removed unsafe HTML injection from the model selector rendering path.
- Updated the security disclosure contact to `contact@lg-ia-researchlab.fr`.

## [2026.3.29] - Previous release

- See the repository history and GitHub releases for earlier changes.
