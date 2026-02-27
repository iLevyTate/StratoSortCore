# AGENTS.md

## Cursor Cloud specific instructions

### Overview

StratoSort Core is a privacy-first Electron 40 desktop app using node-llama-cpp (in-process LLM),
Orama (vector search), and Tesseract.js (OCR). All processing is local — no external services,
databases, or Docker containers required.

### Node.js version

Use Node.js **20.11.0** as specified in `.nvmrc`. The VM has nvm pre-installed. Run
`nvm use 20.11.0` before any npm/node commands.

### Development commands

See `CLAUDE.md` and `package.json` scripts. Key commands:

- `npm run dev` — full dev build + launch (clean → webpack → electron)
- `npm run lint` / `npm run format:check` — ESLint and Prettier checks
- `npm test` — Jest (386+ suites, 6000+ tests)
- `npm run build` — production webpack build
- `npm run ci` — full CI pipeline (format + lint + test:coverage + verify:ipc-handlers + build)

### GPU binary crash in headless/container environments

The `node-llama-cpp` package ships prebuilt Vulkan and CUDA binaries that probe the GPU driver on
startup. In cloud VMs without GPU drivers, these probes cause a child-process crash that Electron's
ErrorHandler treats as critical (triggering `app.quit()`).

**Workaround:** Before launching the Electron app, rename (or remove) the GPU-specific addon
binaries so node-llama-cpp falls back to the CPU-only binary without crashing:

```bash
mv node_modules/@node-llama-cpp/linux-x64-vulkan/bins/linux-x64-vulkan/llama-addon.node \
   node_modules/@node-llama-cpp/linux-x64-vulkan/bins/linux-x64-vulkan/llama-addon.node.bak
mv node_modules/@node-llama-cpp/linux-x64-cuda/bins/linux-x64-cuda/llama-addon.node \
   node_modules/@node-llama-cpp/linux-x64-cuda/bins/linux-x64-cuda/llama-addon.node.bak
```

Then launch with software rendering and no-sandbox flags:

```bash
NODE_ENV=development STRATOSORT_FORCE_SOFTWARE_GPU=1 \
  electron . --enable-logging --no-sandbox --disable-gpu
```

The app will use the CPU-only `@node-llama-cpp/linux-x64` binary and run AI inference on CPU (slow
but functional).

### SIGILL with large models in Electron on Firecracker VMs

The default 1.9 GB text model (`Llama-3.2-3B-Instruct-Q4_K_M.gguf`) crashes with SIGILL inside
Electron's runtime (Node v24) on Firecracker VMs. The prebuilt binary works in standalone Node.js
v20 but fails during `loadModel` in Electron for models over ~500 MB.

**Workaround:** Use the smaller Qwen 0.5B model (~469 MB) which loads and runs successfully:

```bash
# Download the smaller model
curl -L -o ~/.config/stratosort-core/models/qwen2.5-0.5b-instruct-q4_k_m.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"

# Update settings to use it
python3 -c "
import json
f = '$HOME/.config/StratoSort Core/settings.json'
with open(f) as fh: s = json.load(fh)
s['textModel'] = 'qwen2.5-0.5b-instruct-q4_k_m.gguf'
with open(f, 'w') as fh: json.dump(s, fh, indent=2)
"
```

With this model, the full pipeline works: file import → AI analysis (90-95% confidence, ~50s/file on
CPU) → organization suggestions → semantic search.

### Pre-existing test note

`platformUtils.test.js` has one failing test on Linux (`joinPath` produces backslashes). This is a
pre-existing issue unrelated to environment setup.

### Test files

Download test files from the shared Google Drive folder for manual QA:

```
https://drive.google.com/drive/folders/1EiF1KVvxqvavgYY-WgxADyMe7jvhO_ND?usp=drive_link
```

Use `gdown --folder <URL> -O /home/ubuntu/test-documents-gdrive/` to fetch them. The folder contains
24 files across many types (PDF, PPTX, PNG, JPG, PSD, AI, MP4, Python, JS, SQL, CSS, HTML, YAML,
INI, STL, OBJ, GCODE, SCAD, 3MF, EPS, BMP).

### Model downloads

`npm install` triggers `postinstall` which downloads ~2-5 GB of GGUF model files to
`~/.config/stratosort-core/models`. Set `CI=true` to skip native module rebuild, but model downloads
still run (non-fatal if network is unavailable). Models are also auto-downloaded on first app
launch.
