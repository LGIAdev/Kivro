## What's Changed

- Improved the deterministic math routing layer so local equation, derivative, limit, integral, variation, and ODE requests are handled more consistently.
- Improved parser tolerance for natural French formulations and aligned local guidance when a math intent is recognized but the expression cannot be parsed.
- Improved segmented exercise handling so simple numbered sub-questions can be routed through the appropriate local pipeline before falling back to the language model.
- Improved the deterministic math API contract and payload handling between the frontend and backend.
- Improved the visual rendering of deterministic result cards with wider layouts, better label/value structure, and more consistent specialized renderers.
- Fixed Markdown heading rendering in model answers so heading levels 4 to 6 no longer appear with raw `####` markers.
- Updated the visible app version and documentation for `Kivrio 2026.4.18`.

## Full Changelog

https://github.com/LGIAdev/Kivrio/compare/v2026.4.17.1...v2026.4.18
