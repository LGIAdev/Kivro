# Kivrio 2026.4.22

## What's Changed

- Improved deterministic equation solving so valid real equations with no real solution now return the correct local result instead of a generic guidance message in common cases such as `ln(x)-x^2=0`.
- Improved the equation fallback to better distinguish malformed equations from valid but unresolved equations before showing guidance.
- Updated the Windows repository release metadata and visible app version for `Kivrio 2026.4.22`.

## Full Changelog

https://github.com/LGIAdev/Kivrio/compare/v2026.4.18.1...v2026.4.22
