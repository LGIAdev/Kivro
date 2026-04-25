## What's Changed

- Improved deterministic equation parsing so OCR-transcribed Markdown headings such as `## resoudre ...` are accepted before local solving.
- Restored the specialized system-solve card rendering so the deterministic system pipeline uses the same polished response layout as the other local math pipelines.
- Generalized the comfortable edit-bubble width behavior so message editing is no longer constrained by the previous bubble width.
- Routed `.txt` attachments into the deterministic prompt path before the language model fallback, enabling local SymPy handling when a supported math request is present.
- Updated the visible application version for `Kivrio 2026.4.25`.

## Full Changelog

https://github.com/LGIAdev/Kivrio/compare/v2026.4.23...v2026.4.25
