# Configuration Reference

This document lists all environment variables and configuration options available in StratoSort.

## Dependency Installation (Beta)

> **⚠️ Beta Notice**: The automatic dependency installation feature (`npm run setup:deps`) is
> currently in beta and may not work reliably on all systems. For full functionality, we recommend
> installing dependencies manually via CLI as described below.

### Manual Installation via CLI

If the automatic setup scripts fail or you prefer manual installation, follow these steps:

#### 1. Install Ollama

| Platform | Command                                                   |
| -------- | --------------------------------------------------------- |
| Windows  | `winget install Ollama.Ollama` or download from ollama.ai |
| macOS    | `brew install ollama` or download from ollama.ai          |
| Linux    | `curl -fsSL https://ollama.ai/install.sh \| sh`           |

#### 2. Pull Required AI Models

```bash
# Ensure Ollama is running
ollama serve

# Pull models (~6GB total download)
ollama pull llama3.2:latest      # Text analysis
ollama pull gemma3:latest        # Vision/image analysis (multimodal)
ollama pull mxbai-embed-large    # Embedding model
```

#### 3. Install ChromaDB (Requires Python 3.8+)

```bash
# Windows
pip install --user chromadb

# macOS/Linux
pip3 install --user chromadb
```

#### 4. Verify Installation

```bash
# Test Ollama
curl http://127.0.0.1:11434/api/tags

# Test ChromaDB
python -c "import chromadb; print('ChromaDB OK')"
```

### Automatic Setup Commands (Beta)

These commands attempt to auto-detect and install dependencies but may not work on all systems:

```bash
npm run setup:deps           # Install both Ollama and ChromaDB
npm run setup:ollama         # Install Ollama + pull models
npm run setup:chromadb       # Install ChromaDB Python module
npm run setup:ollama:check   # Verify Ollama installation
npm run setup:chromadb:check # Verify ChromaDB installation
```

## Environment Variables

### Ollama Configuration

| Variable            | Default                  | Description                                 |
| ------------------- | ------------------------ | ------------------------------------------- |
| `OLLAMA_BASE_URL`   | `http://127.0.0.1:11434` | Base URL for the Ollama API server          |
| `OLLAMA_HOST`       | `http://127.0.0.1:11434` | Alternative to `OLLAMA_BASE_URL`            |
| `OLLAMA_NUM_GPU`    | Auto-detected            | Number of GPU layers to use                 |
| `OLLAMA_NUM_THREAD` | Auto-detected            | Number of CPU threads for inference         |
| `OLLAMA_NUM_BATCH`  | Auto-detected            | Batch size for prompt processing            |
| `OLLAMA_KEEP_ALIVE` | `10m`                    | How long to keep the model loaded in memory |

### ChromaDB Configuration

| Variable                      | Default                 | Description                                                                            |
| ----------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `CHROMA_SERVER_URL`           | `http://127.0.0.1:8000` | Full URL for ChromaDB server. If set and reachable, skips local installation/spawning. |
| `CHROMA_SERVER_PROTOCOL`      | `http`                  | Protocol for ChromaDB connection (used if `CHROMA_SERVER_URL` is not set)              |
| `CHROMA_SERVER_HOST`          | `127.0.0.1`             | ChromaDB server hostname (used if `CHROMA_SERVER_URL` is not set)                      |
| `CHROMA_SERVER_PORT`          | `8000`                  | ChromaDB server port (used if `CHROMA_SERVER_URL` is not set)                          |
| `CHROMA_SERVER_COMMAND`       | -                       | Custom command to spawn ChromaDB server (advanced use only)                            |
| `STRATOSORT_DISABLE_CHROMADB` | `0`                     | Set to `1` to disable ChromaDB integration entirely                                    |

**External ChromaDB (Docker/Remote)**:

- Set `CHROMA_SERVER_URL` to point to an external ChromaDB instance (e.g.,
  `http://192.168.1.100:8000`).
- The app will verify the server is reachable and skip local Python/pip installation.
- Useful for Docker deployments or shared ChromaDB instances.

### ChromaDB Cache Tuning

| Variable                         | Default  | Description                                |
| -------------------------------- | -------- | ------------------------------------------ |
| `CHROMA_QUERY_CACHE_SIZE`        | `200`    | Maximum number of cached query results     |
| `CHROMA_QUERY_CACHE_TTL_MS`      | `120000` | Cache entry time-to-live (2 minutes)       |
| `STRATOSORT_CHROMA_CACHE_SIZE`   | -        | Alternative to `CHROMA_QUERY_CACHE_SIZE`   |
| `STRATOSORT_CHROMA_CACHE_TTL_MS` | -        | Alternative to `CHROMA_QUERY_CACHE_TTL_MS` |

### Performance Tuning

| Variable                   | Default | Description                                     |
| -------------------------- | ------- | ----------------------------------------------- |
| `MAX_IMAGE_CACHE`          | `300`   | Maximum cached image analyses (50-1000)         |
| `AUTO_ORGANIZE_BATCH_SIZE` | `10`    | Files processed per auto-organize batch (1-100) |

### GPU Configuration

| Variable                        | Default | Description                               |
| ------------------------------- | ------- | ----------------------------------------- |
| `STRATOSORT_FORCE_SOFTWARE_GPU` | `0`     | Set to `1` to force software rendering    |
| `ELECTRON_FORCE_SOFTWARE`       | `0`     | Alternative software rendering flag       |
| `ANGLE_BACKEND`                 | `d3d11` | ANGLE backend for GPU rendering (Windows) |
| `STRATOSORT_GL_IMPLEMENTATION`  | -       | Override OpenGL implementation            |

### Development

| Variable         | Default      | Description                                   |
| ---------------- | ------------ | --------------------------------------------- |
| `NODE_ENV`       | `production` | Set to `development` for dev mode features    |
| `REACT_DEVTOOLS` | `false`      | Set to `true` to enable React DevTools in dev |

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
| `OLLAMA_API`          | 3 attempts | Ollama API retry config        |

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
export OLLAMA_BASE_URL=http://192.168.1.100:11434
export MAX_IMAGE_CACHE=500
./stratosort

# Windows (PowerShell)
$env:OLLAMA_BASE_URL = "http://192.168.1.100:11434"
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

### ChromaDB Connection Issues

**Local ChromaDB (default)**:

- The app auto-installs ChromaDB via `pip install --user chromadb` on first run.
- Spawns `chroma run --path <data-dir>` automatically when needed.
- Verify installation: `npm run setup:chromadb:check`

**External ChromaDB (Docker/remote)**:

- Set `CHROMA_SERVER_URL` to your external server:
  ```bash
  export CHROMA_SERVER_URL=http://192.168.1.100:8000  # Linux/macOS
  $env:CHROMA_SERVER_URL = "http://192.168.1.100:8000"  # Windows PowerShell
  ```
- Verify it's reachable:
  ```bash
  curl http://192.168.1.100:8000/api/v1/heartbeat
  ```

### Ollama Connection Issues

Verify Ollama is running:

```bash
curl http://127.0.0.1:11434/api/tags
```

Override the connection URL if needed:

```bash
export OLLAMA_BASE_URL=http://custom-host:11434
```
