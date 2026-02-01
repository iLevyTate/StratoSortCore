### StratoSort Bundled Runtime (portable)

This folder holds optional, **embedded runtimes** that ship with the Windows installer.
Models are **not** bundled; users download models after install.

Runtime layout:
- `assets/runtime/ollama/ollama.exe` — embedded Ollama binary.
- `assets/runtime/python/python.exe` — embeddable Python used to run ChromaDB.
- `assets/runtime/tesseract/tesseract.exe` — embedded Tesseract OCR runtime.
- `assets/runtime/runtime-manifest.json` — versions + URLs for build-time fetching.

Build-time setup:
- Run `npm run setup:runtime` to download and stage the runtimes for packaging.
- The script is idempotent and verifies checksums when provided in the manifest.

Notes:
- Keep versions aligned with app requirements (Python ≥3.9).
- These binaries are optional; the app falls back to system installs if missing.
- Signed binaries are recommended to avoid AV false positives.
