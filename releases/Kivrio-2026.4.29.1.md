## What's Changed

- Isolated Kivrio on its own local port range (`8000-8009`) to avoid opening another Kivrio-family application by mistake.
- Added an application identity to `/api/health` so the launcher can verify that it is talking to Kivrio before opening the browser.
- Reworked the Windows launcher to avoid slow HTTP port scans and keep startup responsive.
- Updated the visible README version to `Kivrio 2026.4.29.1`.

## Full Changelog

https://github.com/LGIAdev/Kivrio/compare/v2026.4.29...v2026.4.29.1
