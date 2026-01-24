# Getting Started with El StratoSort

<p align="center">
  <img src="https://img.shields.io/badge/setup%20time-~10%20minutes-blue?style=flat-square" alt="Setup Time" />
  <img src="https://img.shields.io/badge/difficulty-beginner-green?style=flat-square" alt="Difficulty" />
</p>

This guide will walk you through setting up **El StratoSort** on your local machine.

## Table of Contents

- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Detailed Setup Instructions](#detailed-setup-instructions)
- [Troubleshooting](#troubleshooting)

## System Requirements

Before you begin, ensure your system meets the following requirements. El StratoSort relies on
several local AI tools that need to be configured correctly.

### System Dependencies Chart

| Component     | Purpose                  | Requirement / Setup                                    |
| :------------ | :----------------------- | :----------------------------------------------------- |
| **Node.js**   | Core Application Runtime | v18+ (Included in installer; dev needs node installed) |
| **Python**    | Vector Database Runtime  | v3.9+ (Must be installed & added to PATH)              |
| **Ollama**    | Local AI Engine          | Auto-installed by App (or manual from ollama.ai)       |
| **ChromaDB**  | Semantic Search DB       | Auto-installed via pip (Requires Python 3.9+)          |
| **Tesseract** | Image Text Recognition   | Auto-installed (Win/Mac/Linux) or manual install       |
| **GPU**       | AI Acceleration          | Optional but recommended (4GB+ VRAM)                   |

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/iLevyTate/elstratosort.git
cd elstratosort
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Start the Application

```bash
npm run dev
```

---

## Detailed Setup Instructions

On the first launch, the application will attempt to automatically set up all necessary AI
dependencies.

### Setup Workflow

The following flowchart illustrates the automated setup process that runs on first launch:

```mermaid
graph TD
    Start([Start App / Setup]) --> CheckOllama{Ollama Installed?}

    %% Ollama Flow
    CheckOllama -- No --> InstallOllama[Install Instructions / Auto]
    InstallOllama --> CheckRunning
    CheckOllama -- Yes --> CheckRunning{Is Service Running?}
    CheckRunning -- No --> StartServer[Start 'ollama serve']
    CheckRunning -- Yes --> CheckModels{Models Found?}
    StartServer --> CheckModels
    CheckModels -- No --> PullModels[Pull AI Models<br/>(llama3, moondream, etc)]
    CheckModels -- Yes --> CheckPython
    PullModels --> CheckPython

    %% ChromaDB Flow
    CheckPython{Python 3.9+?}
    CheckPython -- No --> FailPython[User Action Required:<br/>Install Python 3.9+]
    CheckPython -- Yes --> CheckChroma{ChromaDB Pkg?}
    CheckChroma -- No --> PipInstall[pip install chromadb]
    CheckChroma -- Yes --> CheckTess
    PipInstall --> CheckTess
    FailPython --> CheckTess

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
    class FailPython,ManualTess warning;
```

### ChromaDB Setup

El StratoSort uses **ChromaDB** for vector storage (semantic search). The setup script attempts to
install the Python package automatically using `pip`.

**Requirement:** Python 3.9+ must be installed and added to your system PATH.

If automatic installation fails:

1.  Ensure Python 3.9+ is installed: `python --version`
2.  Install ChromaDB manually: `pip install chromadb`

### Tesseract OCR Setup

El StratoSort uses **Tesseract OCR** to read text from images. The setup script attempts to install
it automatically:

- **Windows**: Uses `winget` or `chocolatey`
- **macOS**: Uses `brew`
- **Linux**: Uses `apt-get`

If automatic installation fails, please install Tesseract manually:

- **Windows**: [Install Tesseract via UB-Mannheim](https://github.com/UB-Mannheim/tesseract/wiki) or
  run `winget install Tesseract-OCR.Tesseract`
- **macOS**: `brew install tesseract`
- **Linux**: `sudo apt-get install tesseract-ocr`

After manual installation, restart the application.

---

## Troubleshooting

If you encounter issues during setup:

1.  **Check Logs**:
    - Windows: `%APPDATA%/El StratoSort/logs/`
    - macOS: `~/Library/Logs/El StratoSort/`
    - Linux: `~/.config/El StratoSort/logs/`

2.  **Verify Ollama**:
    - Run `ollama serve` in a terminal to verify it starts correctly.
    - Check http://localhost:11434 to see if it's running.

3.  **Run Setup Script Manually**:
    - You can trigger the dependency setup manually via:
    ```bash
    npm run setup:deps
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
  Need help? <a href="https://github.com/iLevyTate/elstratosort/issues">Open an issue</a> on GitHub.
</p>
