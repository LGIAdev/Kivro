# Kivrio

![Status](https://img.shields.io/badge/status-WIP-blue)
![License](https://img.shields.io/badge/license-Apache--2.0%20%2F%20MPL--2.0-green)
![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/LGIAdev/Kivrio?sort=semver)
![Issues](https://img.shields.io/github/issues/LGIAdev/Kivrio)
![Pull Requests](https://img.shields.io/github/issues-pr/LGIAdev/Kivrio)

Kivrio is an open-source interface for running and managing AI models locally via [Ollama](https://ollama.com/).
It provides a desktop-style web UI with math rendering, local conversation history, and a fully local persistence layer.

Status: project under active development.

---

## Releases

- [Releases v2026.3.27.1](releases/v2026.3.27.1.md)
- [Releases v2026.3.27](releases/v2026.3.27.md)

---

## Current features

- Local Ollama integration
- Dark/light theme support
- Markdown rendering with KaTeX
- Conversation history in the left sidebar
- Persistent local storage of conversations in SQLite
- Rename and delete actions for conversation links
- Local Python backend serving both the UI and the API
- Direct file reading for supported multimodal models
- Local Pix2Text OCR for image uploads sent to non-multimodal models

---

## Local architecture

Kivrio now runs as a local application made of:

- a local Python server
- a local SQLite database
- a browser UI served from the same local server
- local Ollama models running outside Kivrio
- a local Pix2Text OCR integration inside Kivrio for non-multimodal models

Conversation data is stored locally in:

`data/kivrio.db`

No cloud database is used for conversation history.

OCR runtime files, downloaded model weights, temporary files and OCR outputs are kept local and are excluded from the Git repository.

---

## Quickstart

### Windows

Run:

```powershell
.\start-kivrio.bat
```

Then open:

[http://127.0.0.1:8000/index.html](http://127.0.0.1:8000/index.html)

### Manual start

```powershell
cd "$env:USERPROFILE\Documents\Kivrio"
py server\app.py --host 127.0.0.1 --port 8000
```

Then open:

[http://127.0.0.1:8000/index.html](http://127.0.0.1:8000/index.html)

Make sure Ollama is installed locally and running, for example on:

`http://127.0.0.1:11434`

For non-multimodal models, Kivrio can route image uploads through the local Pix2Text OCR flow before sending the extracted text to the model.

---

## Conversation history

Kivrio stores conversations locally in SQLite and rebuilds the left sidebar from the database at startup.

Supported behavior:

- reopen a saved conversation from the sidebar
- keep conversations after closing the interface
- keep conversations after a PC restart
- rename a conversation link
- delete a conversation link

Logging out of the interface no longer clears persistent conversation history.

---

## Project structure

- `index.html`: main UI
- `js/`: frontend logic
- `server/`: local API and SQLite access
- `css/`: styles
- `ocr/pix2text/`: local OCR integration scripts and stable config
- `data/kivrio.db`: local conversation database

---

## Roadmap

- [x] Basic UI with Ollama integration
- [x] Markdown + KaTeX rendering
- [x] Local conversation history
- [x] SQLite persistence
- [x] Sidebar rename/delete actions
- [x] OCR for image uploads with non-multimodal models
- [ ] Voice input/output
- [ ] GitHub Pages demo

---

## Contributing

Contributions are welcome.

Recommended flow:

1. Fork the project
2. Create a branch
3. Open a Pull Request

See also `CONTRIBUTING.md`.

---

## License

The source code is distributed under a dual license: Apache 2.0 / MPL 2.0.

See `LICENSE`.

---

## Trademark notice

The name Kivrio, its logo, and its visual identity are trademarks of LG-IA ResearcherLab.

- You may not use the name Kivrio or its logo for a modified project or a commercial product without prior written permission.
- Forks must use different branding. References to the original project are allowed when they do not create confusion with the official version.

For trademark inquiries: `contact@lg-ia-researchlab.fr`
