# Kivrio 2026.4.17

## What's Changed

- Improved the local math router so derivative, limit, equation, variation, integral, and ODE requests tolerate more natural French formulations.
- Added local guidance messages when a math intent is recognized but the expression cannot be parsed, avoiding an immediate fallback to the language model.
- Improved the variation pipeline so prompts such as `etudier les variations de ...` are handled more robustly, with or without an explicit `f(x)=...`.
- Refreshed the Windows installer source with an in-progress installation window and the updated desktop icon asset.
- Preserved the existing behavior where the language model remains available for explanations and demonstrations instead of core deterministic computation.

## Full Changelog

https://github.com/LGIAdev/Kivrio/compare/v2026.4.15...v2026.4.17
