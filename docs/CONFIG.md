-- layout: single title: "CONFIG" sidebar: nav: "docs" --

# Configuration Reference

This document lists all environment variables and configuration options available in StratoSort
Core.

## Model & OCR Setup

The AI stack runs in-process (node-llama-cpp + Orama). You only need models and OCR:

### Setup Commands

```bash
npm run setup:deps          # Download models (best-effort)
npm run setup:models        # Download GGUF models
npm run setup:models:check  # Verify models
```

### Setup Script Flags (Advanced)

These variables affect setup scripts and `postinstall` behavior:

| Variable               | Default | Description                                                           |
| ---------------------- | ------- | --------------------------------------------------------------------- |
| `SKIP_APP_DEPS`        | `0`     | Skip `postinstall` native rebuild and all setup scripts               |
| `SKIP_TESSERACT_SETUP` | `0`     | Skip Tesseract setup (used by setup scripts and background setup)     |
| `MINIMAL_SETUP`        | `0`     | Skip optional model downloads during setup (`setup:models --minimal`) |

### Default AI Models

StratoSort Core uses the **Base (Small & Fast)** profile by default (configurable in Settings → AI
Configuration). A **Better Quality** profile with larger models is available during setup.

| Role          | Default (Base)                      | Better Quality                                     |
| ------------- | ----------------------------------- | -------------------------------------------------- |
| **Text**      | `Llama-3.2-3B-Instruct-Q4_K_M.gguf` | `Qwen2.5-7B-Instruct-Q4_K_M.gguf` (128K context)   |
| **Vision**    | `llava-phi-3-mini-int4.gguf`        | `llava-v1.6-mistral-7b-Q4_K_M.gguf`                |
| **Embedding** | `all-MiniLM-L6-v2-Q4_K_M.gguf`      | `nomic-embed-text-v1.5-Q8_0.gguf` (768 dimensions) |

To change defaults before install, edit `src/shared/aiModelConfig.js` or set env vars:
`STRATOSORT_TEXT_MODEL`, `STRATOSORT_VISION_MODEL`, `STRATOSORT_EMBEDDING_MODEL`. See
`src/shared/modelRegistry.js` for the full catalog.

### Installing Additional Models from Settings

Users can add new models via **Settings → Local AI Engine**:

- **Download Base Models** — One-click download of the three default models (text, vision,
  embedding)
- **Model Management → Add Model** — Install any model from the registry by typing its exact
  filename (e.g. `Qwen2.5-7B-Instruct-Q4_K_M.gguf`, `all-MiniLM-L6-v2-Q4_K_M.gguf`)
- **Default AI Models** — Select which installed model to use for text, vision, and embeddings

All installable models must be in `modelRegistry.js`; the catalog lists download URLs and metadata.

### Fastest Models with Best Performance (2025)

Based on node-llama-cpp docs and llama.cpp ecosystem:

| Category      | Fastest options                                             | Best quality-speed balance                           |
| ------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| **Text**      | `Llama-3.2-3B-Instruct-Q4_K_M`, `Phi-3-mini-4k-instruct-q4` | `Qwen2.5-7B-Instruct-Q4_K_M` (default, 128K context) |
| **Vision**    | `llava-phi-3-mini-Q4_K_M` (smaller, CPU-friendly)           | `llava-v1.6-mistral-7b-Q4_K_M` (default)             |
| **Embedding** | `all-MiniLM-L6-v2-Q4_K_M.gguf` (~21MB, 384 dim)             | `nomic-embed-text-v1.5-Q8_0.gguf` (default, 768 dim) |

**Quantization:** Per node-llama-cpp, `Q4_K_M` offers the best balance between compression and
quality; `Q5_K_M` is a close second. `Q8_0` is higher quality but slower; smaller models (3B, Phi-3)
are faster than 7B on limited hardware.

**Embedding dimensions:** Changing embedding models changes vector dimensions (e.g. 384 for
All-MiniLM vs 768 for Nomic). The index must be rebuilt when switching; the UI prompts for this.

## Environment Variables

### OCR (Tesseract)

| Variable          | Default  | Description                                                      |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `TESSERACT_PATH`  | -        | Override path to the Tesseract binary (skips auto-install logic) |
| `TESSDATA_PREFIX` | Auto-set | Path to tessdata directory; auto-set for embedded runtime        |

### Performance Tuning

| Variable                   | Default | Description                                     |
| -------------------------- | ------- | ----------------------------------------------- |
| `MAX_IMAGE_CACHE`          | `300`   | Maximum cached image analyses (50-1000)         |
| `AUTO_ORGANIZE_BATCH_SIZE` | `10`    | Files processed per auto-organize batch (1-100) |

### Processing Limits (Settings > Performance)

These settings are configurable via **Settings > Performance > Processing limits**:

| Setting                 | Default | Description                                                        |
| ----------------------- | ------- | ------------------------------------------------------------------ |
| `maxConcurrentAnalysis` | 1       | Files analyzed in parallel (1–10). Lower values reduce memory use. |
| `maxFileSize`           | 100 MB  | Maximum general file size for analysis.                            |
| `maxImageFileSize`      | 100 MB  | Maximum size for image analysis.                                   |
| `maxDocumentFileSize`   | 200 MB  | Maximum size for document extraction.                              |

### Startup & Health Checks

| Variable                | Default | Description                                      |
| ----------------------- | ------- | ------------------------------------------------ |
| `SERVICE_CHECK_TIMEOUT` | `2000`  | Timeout (ms) for preflight service health checks |

### GPU Configuration

| Variable                          | Default | Description                               |
| --------------------------------- | ------- | ----------------------------------------- |
| `STRATOSORT_FORCE_SOFTWARE_GPU`   | `0`     | Set to `1` to force software rendering    |
| `ELECTRON_FORCE_SOFTWARE`         | `0`     | Alternative software rendering flag       |
| `ANGLE_BACKEND`                   | `d3d11` | ANGLE backend for GPU rendering (Windows) |
| `STRATOSORT_GL_IMPLEMENTATION`    | -       | Override OpenGL implementation            |
| `STRATOSORT_IGNORE_GPU_BLOCKLIST` | `0`     | Ignore Electron GPU blocklist (advanced)  |

### Feature Flags

| Variable                              | Default | Description                                    |
| ------------------------------------- | ------- | ---------------------------------------------- |
| `STRATOSORT_DEBUG`                    | `0`     | Enable debug mode with verbose logging         |
| `STRATOSORT_ENABLE_TELEMETRY`         | `0`     | Enable anonymous telemetry collection          |
| `STRATOSORT_REDACT_PATHS`             | `0`     | Redact file/folder paths in the UI (demo-safe) |
| `STRATOSORT_GRAPH_ENABLED`            | `1`     | Master toggle for graph visualization          |
| `STRATOSORT_GRAPH_CLUSTERS`           | `1`     | Cluster visualization                          |
| `STRATOSORT_GRAPH_SIMILARITY_EDGES`   | `1`     | File-to-file similarity edges                  |
| `STRATOSORT_GRAPH_MULTI_HOP`          | `1`     | Multi-hop expansion                            |
| `STRATOSORT_GRAPH_PROGRESSIVE_LAYOUT` | `1`     | Progressive disclosure for large graphs        |
| `STRATOSORT_GRAPH_KEYBOARD_NAV`       | `1`     | Keyboard navigation in graph                   |
| `STRATOSORT_GRAPH_CONTEXT_MENUS`      | `1`     | Right-click context menus on nodes             |

### Logging

| Variable                  | Default | Description                                          |
| ------------------------- | ------- | ---------------------------------------------------- |
| `STRATOSORT_CONSOLE_LOGS` | `0`     | Enable console logging in production (`1` to enable) |

### Development

| Variable                             | Default      | Description                                   |
| ------------------------------------ | ------------ | --------------------------------------------- |
| `NODE_ENV`                           | `production` | Set to `development` for dev mode features    |
| `REACT_DEVTOOLS`                     | `false`      | Set to `true` to enable React DevTools in dev |
| `STRATOSORT_SCAN_STRUCTURE_DELAY_MS` | -            | Dev-only delay for folder scan IPC (ms)       |

### Runtime Configuration

| Variable                 | Default | Description                                                                     |
| ------------------------ | ------- | ------------------------------------------------------------------------------- |
| `STRATOSORT_RUNTIME_DIR` | -       | Override bundled runtime root (deprecated; only used for embedded OCR binaries) |

The AI stack runs fully in-process. No external runtime staging is required.

## Performance Constants

All timing and tuning constants are centralized in `src/shared/performanceConstants.js`. These are
organized into categories:

### TIMEOUTS (milliseconds)

| Constant             | Value   | Description                            |
| -------------------- | ------- | -------------------------------------- |
| `DEBOUNCE_INPUT`     | 300     | Input debounce delay                   |
| `AI_ANALYSIS_SHORT`  | 30,000  | Short AI analysis timeout              |
| `AI_ANALYSIS_MEDIUM` | 60,000  | Medium AI analysis timeout             |
| `AI_ANALYSIS_LONG`   | 120,000 | Long AI analysis timeout               |
| `AI_ANALYSIS_BATCH`  | 300,000 | Batch analysis timeout (5 min)         |
| `ANALYSIS_LOCK`      | 300,000 | Max lock duration before force release |
| `GLOBAL_ANALYSIS`    | 600,000 | Max total analysis time (10 min)       |

### RETRY Configuration

| Constant              | Value      | Description                    |
| --------------------- | ---------- | ------------------------------ |
| `MAX_ATTEMPTS_LOW`    | 2          | Low-priority retry attempts    |
| `MAX_ATTEMPTS_MEDIUM` | 3          | Medium-priority retry attempts |
| `MAX_ATTEMPTS_HIGH`   | 5          | High-priority retry attempts   |
| `FILE_OPERATION`      | 3 attempts | File operation retry config    |
| `AI_ANALYSIS`         | 2 attempts | AI analysis retry config       |

### CACHE Limits

| Constant              | Value | Description               |
| --------------------- | ----- | ------------------------- |
| `MAX_FILE_CACHE`      | 500   | Maximum cached files      |
| `MAX_IMAGE_CACHE`     | 300   | Maximum cached images     |
| `MAX_EMBEDDING_CACHE` | 1000  | Maximum cached embeddings |
| `MAX_ANALYSIS_CACHE`  | 200   | Maximum cached analyses   |

### BATCH Processing

| Constant                  | Value | Description                      |
| ------------------------- | ----- | -------------------------------- |
| `MAX_CONCURRENT_FILES`    | 5     | Max files processed concurrently |
| `MAX_CONCURRENT_ANALYSIS` | 3     | Max concurrent AI analyses       |
| `EMBEDDING_BATCH_SIZE`    | 50    | Embeddings per batch             |
| `EMBEDDING_PARALLEL_SIZE` | 10    | Parallel embedding operations    |

### THRESHOLDS

| Constant                           | Value | Description                   |
| ---------------------------------- | ----- | ----------------------------- |
| `CONFIDENCE_LOW`                   | 0.3   | Low confidence threshold      |
| `CONFIDENCE_MEDIUM`                | 0.6   | Medium confidence threshold   |
| `CONFIDENCE_HIGH`                  | 0.8   | High confidence threshold     |
| `DEFAULT_CONFIDENCE_PERCENT`       | 70    | Default document confidence   |
| `DEFAULT_IMAGE_CONFIDENCE_PERCENT` | 75    | Default image confidence      |
| `FOLDER_MATCH_CONFIDENCE`          | 0.55  | Min score for folder matching |

### FILE_SIZE Limits

| Constant               | Value  | Description                       |
| ---------------------- | ------ | --------------------------------- |
| `MAX_DOCUMENT_SIZE`    | 50 MB  | Maximum document file size        |
| `MAX_IMAGE_SIZE`       | 20 MB  | Maximum image file size           |
| `MAX_UPLOAD_SIZE`      | 100 MB | Maximum upload size               |
| `LARGE_FILE_THRESHOLD` | 10 MB  | Threshold for large file handling |

### CONCURRENCY

| Constant          | Value | Description                       |
| ----------------- | ----- | --------------------------------- |
| `MIN_WORKERS`     | 1     | Minimum analysis workers          |
| `DEFAULT_WORKERS` | 3     | Default analysis workers          |
| `MAX_WORKERS`     | 8     | Maximum analysis workers          |
| `FOLDER_SCAN`     | 50    | Concurrent folder scan operations |

## Configuration Files

### User Settings

User settings are persisted in the application's data directory:

- **Windows**: `%APPDATA%/stratosort/settings.json`
- **macOS**: `~/Library/Application Support/stratosort/settings.json`
- **Linux**: `~/.config/stratosort/settings.json`

### Configuration Schema

Configuration validation is defined in `src/shared/config/configSchema.js`. The schema ensures type
safety and provides default values for all settings.

## Modifying Configuration

### Via Environment Variables

Set environment variables before launching the application:

```bash
# Linux/macOS
export MAX_IMAGE_CACHE=500
./stratosort

# Windows (PowerShell)
$env:MAX_IMAGE_CACHE = "500"
.\stratosort.exe
```

### Via Settings UI

Most user-facing settings can be configured through the Settings phase in the application UI.

## Troubleshooting

### GPU Issues

If experiencing rendering problems:

```bash
export STRATOSORT_FORCE_SOFTWARE_GPU=1
```

### Model Download Issues

If AI analysis fails due to missing models:

```bash
npm run setup:models
npm run setup:models:check
```

### Vector DB Issues

The Orama index is stored locally and rebuilt on demand. If results look stale, re-run analysis or
trigger a rebuild from the app UI.
