### StratoSort Bundled Runtime (portable)

Place optional portable runtime binaries here before packaging:

- `assets/runtime/python/` — embeddable Python (python.exe + stdlib/pip) used for ChromaDB when system Python is unavailable.
- `assets/runtime/ollama/` — portable Ollama binary (`ollama.exe` on Windows) started directly by the app.

Notes:
- Keep versions aligned with app requirements (Python ≥3.9).
- These binaries are optional; the app falls back to system installs if missing.
- Signed binaries are recommended to avoid AV false positives.
