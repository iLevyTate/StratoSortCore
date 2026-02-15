# Getting Started with StratoSort Core

<p align="center">
  <img src="https://img.shields.io/badge/setup%20time-~10%20minutes-blue?style=flat-square" alt="Setup Time" />
  <img src="https://img.shields.io/badge/difficulty-beginner-green?style=flat-square" alt="Difficulty" />
</p>

This guide will walk you through setting up **StratoSort Core** on your local machine.

## Table of Contents

- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Detailed Setup Instructions](#detailed-setup-instructions)
- [Release Process (Developers)](#release-process-developers)
- [Troubleshooting](#troubleshooting)

## System Requirements

Before you begin, ensure your system meets the following requirements. StratoSort Core runs a fully
local, in-process AI stack and does not rely on external servers.

### System Dependencies Chart

| Component       | Purpose                  | Requirement / Setup                                       |
| :-------------- | :----------------------- | :-------------------------------------------------------- |
| **Node.js**     | Core Application Runtime | v18+ (Included in installer; dev needs node installed)    |
| **GGUF Models** | Local AI Inference       | Auto-downloaded on first use (`npm run setup:models`)     |
| **Orama**       | Vector Search DB         | Bundled in the app (no external install)                  |
| **Tesseract**   | Image Text Recognition   | Auto-installed (Win/Mac/Linux) with tesseract.js fallback |
| **GPU**         | AI Acceleration          | Optional but recommended (4GB+ VRAM)                      |

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/iLevyTate/StratoSortCore.git
cd StratoSortCore
```

### 2. Install Dependencies

```bash
npm ci
```

> Note: `npm install`/`npm ci` runs `postinstall`, which rebuilds native modules and runs setup
> scripts (best-effort). To skip, set `SKIP_APP_DEPS=1` before installing.

### 3. Start the Application

```bash
npm run dev
```

---

## Detailed Setup Instructions

On the first launch, the application will attempt to automatically set up all necessary AI
dependencies (models + OCR).

### Platform Notes

- **Windows:** Models download on first use. Tesseract auto-installs via `winget`/`chocolatey` and
  falls back to bundled `tesseract.js`. Click “Install All (Background)” on first launch to download
  models.
- **macOS/Linux:** Models download on first use. Tesseract auto-installs via brew/apt and falls back
  to `tesseract.js` if native install is unavailable.
- **In-app setup:** The Settings panel lets you configure models and verify OCR status.

### Setup Workflow (No-CLI first run)

The following flowchart illustrates the automated setup process that runs on first launch:

```mermaid
graph TD
    Start([Start App / Setup]) --> CheckModels{Models Found?}
    CheckModels -- No --> DownloadModels[Download Models]
    CheckModels -- Yes --> CheckTess
    DownloadModels --> CheckTess

    %% Tesseract Flow
    CheckTess{Tesseract OCR?}
    CheckTess -- No --> AutoTess[Try Auto-Install<br/>(winget/brew/apt)]
    AutoTess -- Success --> Ready
    AutoTess -- Failed --> ManualTess[User Action Required:<br/>Manual Install]
    CheckTess -- Yes --> Ready([App Ready 🚀])
    ManualTess --> Ready

    classDef default fill:#f9f9f9,stroke:#333,stroke-width:1px;
    classDef success fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef warning fill:#fff3e0,stroke:#e65100,stroke-width:2px;

    class Ready success;
    class ManualTess warning;
```

### Startup Preflight Checks

On each launch, StratoSort Core runs preflight checks to verify model availability, vector DB
readiness, and OCR health. If a service is slow to respond, you can raise the timeout using
`SERVICE_CHECK_TIMEOUT` (ms). Check logs if the app reports missing or unreachable dependencies.

### Tesseract OCR Setup

StratoSort Core uses **Tesseract OCR** to read text from images. The setup script attempts to
install Tesseract automatically and falls back to the bundled `tesseract.js` implementation if
native install is unavailable:

- **Windows**: Uses `winget` or `chocolatey`
- **macOS**: Uses `brew`
- **Linux**: Uses `apt-get`

#### Language Data (tessdata)

Tesseract requires language data files to recognize text. The app configures this automatically:

- **System-installed Tesseract**: Uses the system tessdata directory (e.g.
  `/usr/share/tesseract-ocr/5/tessdata`, `/opt/homebrew/share/tessdata`, or
  `C:\Program Files\Tesseract-OCR\tessdata`).

To use additional languages beyond English, install language packs for your Tesseract installation.

If automatic installation fails, please install Tesseract manually:

- **Windows**: [Install Tesseract via UB-Mannheim](https://github.com/UB-Mannheim/tesseract/wiki) or
  run `winget install Tesseract-OCR.Tesseract`
- **macOS**: `brew install tesseract`
- **Linux**: `sudo apt-get install tesseract-ocr`

After manual installation:

1. Restart the application.
2. If Tesseract is installed in a non-standard location, set `TESSERACT_PATH` to the binary path.
3. If language data is in a non-standard location, set `TESSDATA_PREFIX` to the tessdata directory.

#### Fallback Behavior

If native Tesseract is unavailable, the app falls back to `tesseract.js`. This fallback:

- Works without a system install
- Supports English only (`eng`)
- Can be slower on large images

Check logs for `[OCR]` messages to confirm which backend is active.

#### Adding Additional Languages

To use languages other than English:

1. **System Tesseract**:
   - Windows: Download `.traineddata` files from https://github.com/tesseract-ocr/tessdata and place
     them in `C:\Program Files\Tesseract-OCR\tessdata\`.
   - macOS: `brew install tesseract-lang`
   - Linux: `sudo apt-get install tesseract-ocr-[lang]` (e.g., `tesseract-ocr-fra`)
2. **Verify**: Run `tesseract --list-langs` to see available languages.

Note: The app currently defaults to English (`eng`). Multi-language selection is planned.

### One-click background setup

On first launch, open the AI Setup modal and click **Install All (Background)**. This will:

- Download the recommended text/vision/embedding GGUF models
- Ensure OCR is available (bundled Tesseract or JS fallback)

The UI stays usable while installs/downloads run in the background.

---

## Release Process (Developers)

For release steps (runtime staging, checksums, and notes), see the [Release Guide](RELEASING.md).

## Troubleshooting

If you encounter issues during setup:

1.  **Check Logs**:
    - Windows: `%APPDATA%/stratosort/logs/`
    - macOS: `~/Library/Logs/stratosort/`
    - Linux: `~/.config/stratosort/logs/`

2.  **Verify Models**:
    - Run `npm run setup:models:check` to verify models are available.

3.  **Run Setup Script Manually**:
    - You can trigger dependency setup manually via:
    ```bash
    npm run setup:deps
    npm run setup:models
    ```

---

## Next Steps

Once setup is complete, you're ready to start organizing your files:

1. **Add Smart Folders** - Configure folders with keywords and descriptions
2. **Enable Auto-Organization** - Turn on folder watching in Settings
3. **Explore the Knowledge Graph** - Visualize relationships between your files

For more information, see the [main README](../README.md) or explore the [documentation](README.md).

---

<p align="center">
  Need help? <a href="https://github.com/iLevyTate/StratoSortCore/issues">Open an issue</a> on GitHub.
</p>
