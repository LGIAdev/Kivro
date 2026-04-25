# Changelog

All notable changes to Kivrio are documented in this file.

## [2026.4.25.1] - 2026-04-25

### Added
- Added release notes for `Kivrio 2026.4.25.1`.

### Changed
- Fixed the message edit textarea so it stays readable in light theme instead of keeping a dark fixed background.
- Unified the attachment preview styling for `png` and `txt` messages in the user bubble while preserving image thumbnails and themed file badges.
- Made the login screen visually stable across light and dark theme sessions by using a fixed authentication appearance.
- Updated the visible application version for `Kivrio 2026.4.25.1`.

## [2026.4.25] - 2026-04-25

### Added
- Added release notes for `Kivrio 2026.4.25`.

### Changed
- Improved deterministic equation parsing so OCR-transcribed Markdown headings such as `## resoudre ...` are accepted before local solving.
- Restored the specialized system-solve card rendering so the deterministic system pipeline uses the same polished response layout as the other local math pipelines.
- Generalized the comfortable edit-bubble width behavior so message editing is no longer constrained by the previous bubble width.
- Routed `.txt` attachments into the deterministic prompt path before the language model fallback, enabling local SymPy handling when a supported math request is present.
- Updated the visible application version for `Kivrio 2026.4.25`.

## [2026.4.23] - 2026-04-23

### Added
- Added release notes for `Kivrio 2026.4.23`.
- Added a deterministic local system-solve pipeline for 2x2 systems, including OCR-derived image input routed before the language model fallback.

### Changed
- Added a controlled SymPy fallback for deterministic equation, derivative, and integral pipelines so valid requests can still resolve locally when direct handling is insufficient.
- Improved OCR and LaTeX normalization for system solving so image transcriptions such as `aligned` and `cases` blocks are parsed more reliably.
- Fixed the `/api/math/system-solve` backend route and updated the visible application version for `Kivrio 2026.4.23`.

## [2026.4.22] - 2026-04-22

### Added
- Added release notes for `Kivrio 2026.4.22`.

### Changed
- Improved deterministic equation solving so valid equations with no real solution can now return `∅` instead of a misleading guidance message in common cases.
- Improved the equation fallback so malformed input, proven absence of real solutions, and genuinely unresolved cases are handled more clearly.
- Updated the Windows release metadata and visible application version for `Kivrio 2026.4.22`.

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
