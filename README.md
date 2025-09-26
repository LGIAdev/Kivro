# Kivro

![Status](https://img.shields.io/badge/status-WIP-blue)
![License](https://img.shields.io/badge/license-Apache--2.0%20%2F%20MPL--2.0-green)
![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/LGIAdev/Kivro?sort=semver)
![Issues](https://img.shields.io/github/issues/LGIAdev/Kivro)
![Pull Requests](https://img.shields.io/github/issues-pr/LGIAdev/Kivro)

Kivro is an open-source interface for running and managing multiple AI models locally via [Ollama](https://ollama.com/).  
It provides a clean UI with support for math rendering (KaTeX), code execution, and conversation history.

Status: Project under development (Work In Progress).
The API, file structure, and features may still change significantly.

------------------------------------------------------------

## Goal

Kivro is a lightweight user interface to interact with different AI models through Ollama.
It focuses on:

- Enhanced Markdown rendering (titles, lists, quotes)
- Mathematical formulas with KaTeX
- GFM tables converted into clean HTML
- Dark/Light themes switch
- Multi-model support: select your AI model dynamically

------------------------------------------------------------

## Quickstart

Clone the repository and run Kivro locally:

git clone https://codeberg.org/LG-IALab/Kivro.git
cd Kivro

Start a local web server (example with Python):

python -m http.server 8000
Then open http://localhost:8000 in your browser.

Make sure Ollama is installed and that you have at least one model available
(for example: ollama pull phi4:latest).

------------------------------------------------------------

## Roadmap

- [x] Basic UI with Ollama integration
- [x] Markdown + KaTeX rendering
- [ ] OCR (image → text)
- [ ] Voice input/output
- [ ] Conversation history
- [ ] GitHub Pages demo

------------------------------------------------------------

## Contributing

Contributions are welcome!
For now, please:

1. Fork the project
2. Create a branch feature/...
3. Submit a Pull Request

See also CONTRIBUTING.md.

------------------------------------------------------------

## License

The source code is distributed under a dual license: Apache 2.0 / MPL 2.0 (your choice).
You are free to choose the license that best suits your needs.

See LICENSE.

------------------------------------------------------------

## Trademark notice

The name Kivro, its logo, and its visual identity are trademarks of LG-IA ResearcherLab.

- You may not use the name Kivro or its logo for a modified project
or a commercial product without prior written permission.
- Forks must use a different name/branding. References to the original
(e.g., “fork of Kivro”) are allowed as long as they do not create
confusion with the official project.

For any inquiries regarding the Kivro trademark: contact@lg-ia-researchlab.fr.


