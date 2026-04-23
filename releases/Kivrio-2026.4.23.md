# Kivrio 2026.4.23

## What's Changed

- Added a controlled SymPy fallback for deterministic equation, derivative, and integral pipelines so valid requests can still resolve locally when direct handling is insufficient.
- Added a deterministic local pipeline for solving 2x2 systems from text and OCR-derived image input before falling back to the language model.
- Improved OCR and LaTeX normalization for system solving so image transcriptions such as `aligned` and `cases` blocks are parsed more reliably.
- Fixed the `/api/math/system-solve` backend route and updated the visible application version for `Kivrio 2026.4.23`.

## Full Changelog

https://github.com/LGIAdev/Kivrio/compare/v2026.4.22...v2026.4.23
