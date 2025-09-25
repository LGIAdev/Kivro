# Kivro

Kivro is a lightweight local-first interface for running and managing multiple AI models via [Ollama](https://ollama.com), 
with math rendering (KaTeX), Markdown tables, and a clean UI.

## Trademark

The name **Kivro**, its logo, and its visual identity are trademarks of LG-IA ResearchLab.

- The source code is distributed under a dual license: **Apache 2.0 / MPL 2.0** (your choice).
- You are free to use and modify the code, and to create derivative works.
- ⚠️ You may not use the name **Kivro** or its logo for a modified project
  or a commercial product without prior written permission.
- Forks must use a different name/branding. References to the original
  (e.g., *“fork of Kivro”*) are allowed as long as they do not create
  confusion with the official project.

For any inquiries regarding the **Kivro** trademark: contact@lg-ia-researchlab.fr

## Quickstart

Clone the repository and run Kivro locally:

```bash
git clone https://github.com/LGIAdev/Kivro.git
cd Kivro

Start a local web server (example with Python):
python -m http.server 8000

Then open http://localhost:8000

Make sure Ollama is installed and that you have at least one model available
(for example: ollama pull phi4:latest).
```

## Roadmap

- [x] Basic UI with Ollama integration
- [x] Markdown + KaTeX rendering
- [ ] OCR (image → text)
- [ ] Voice input/output
- [ ] Conversation history
- [ ] GitHub Pages demo
