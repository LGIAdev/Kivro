## What's Changed

- Grounded qualitative curve explanations on computed plotting facts so follow-up analysis uses the generated curve context instead of free recalculation from the original prompt.
- Improved the plotting guidance so the model keeps exact calculations in Python while converting SymPy values safely before passing them to Matplotlib.
- Prevented duplicate KaTeX rerenders on already stabilized math bubbles to reduce intermittent frontend corruption in specialized math cards.
- Fixed variation-table parsing for inputs such as `f(x)=... sur R`, preventing domain text from leaking into mathematical values like `Rrsu`.
- Updated the visible application version for `Kivrio 2026.4.25.3`.

## Full Changelog

https://github.com/LGIAdev/Kivrio/compare/v2026.4.25.2...v2026.4.25.3
