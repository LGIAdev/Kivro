## What's Changed

- Secured the local API with session authentication and removed public exposure of internal backend and database files.
- Added a first-launch password setup flow so each installation can create and reuse its own local password.
- Protected attachments behind authenticated endpoints and improved auth handling in the frontend upload flow.
- Replaced unsafe model selector HTML rendering and stopped leaking internal exception details to clients.
- Added a Windows installer with a desktop shortcut, branded icon, and automatic launch after installation.
- Improved the first automatic launch on Windows by waiting for the local API to be ready before opening the browser.

## Full Changelog

https://github.com/LGIAdev/Kivro/compare/v2026.3.29...v2026.4.9
