# El StratoSort

![Coverage](https://img.shields.io/badge/coverage-76.4%25-orange)

**Smart File Organization with Local AI**

El StratoSort is a privacy-first document organizer that uses local AI to categorize and arrange
files without sending data to the cloud. It is a focused variation of the broader StratoSort family,
retaining the same logo and identity while targeting this branch’s priorities.

![StratoSort Logo](assets/stratosort-logo.png)

## Features

- Local AI analysis powered by Ollama and fully offline
- Smart organization suggestions for files and folders
- Image understanding beyond filenames
- Safe operations with full undo/redo
- Privacy-first by design—no tracking or data exfiltration
- Batch processing for large sets of files
- Smart folders that adapt to user choices

## Download & Install

### Windows

1. Go to [Releases](https://github.com/iLevyTate/elstratosort/releases/latest) and download the
   latest `.exe` installer (produced at `release/build/` after building).
2. Run the installer and follow the wizard.
3. On first launch, the app will verify AI components (Ollama, ChromaDB) and guide you through any
   required setup (one-time, ~6GB for models).

### macOS

- Download the latest `.dmg` from
  [Releases](https://github.com/iLevyTate/elstratosort/releases/latest).
- Open the DMG, drag StratoSort to Applications, then launch to complete AI setup.

### Linux

- Download the latest `.AppImage` from
  [Releases](https://github.com/iLevyTate/elstratosort/releases/latest).
- Make it executable: `chmod +x StratoSort-*.AppImage`
- Run it: `./StratoSort-*.AppImage`

## Getting Started

1. Launch StratoSort — the app will run a preflight check for AI readiness (Ollama and ChromaDB).
2. Select files or folders to organize.
3. Click **Analyze** for AI-driven suggestions.
4. Review suggestions and confidence scores.
5. Click **Organize** to move files, or adjust and re-analyze.
6. Use undo/redo as needed.

## Use Cases

- Downloads folder cleanup
- Photo organization by visual content
- Document management by type and content
- Project file structuring
- Receipt and invoice filing

## System Requirements

### Minimum

- Windows 10/11, macOS 10.15+, or Linux
- 6GB RAM
- 6GB free disk space (for AI models)
- Any modern CPU

### Recommended

- 8GB+ RAM
- 12GB+ free disk space
- GPU with 4GB+ VRAM (optional for faster processing)

## Privacy & Security

- 100% local processing
- No internet required after setup
- No data collection or tracking
- Open source for inspection

## Keyboard Shortcuts

- Undo: `Ctrl+Z` (Windows/Linux) or `Cmd+Z` (Mac)
- Redo: `Ctrl+Shift+Z` or `Ctrl+Y` (Windows/Linux) or `Cmd+Shift+Z` (Mac)
- Select All: `Ctrl+A` (Windows/Linux) or `Cmd+A` (Mac)

## Advanced Features

### Smart Folders

- Configure keywords and descriptions
- AI learns from selections and improves over time

### Auto-Organization

1. Go to Settings → Auto-Organize.
2. Enable "Watch Downloads Folder".
3. Set confidence thresholds.
4. New downloads organize automatically.

### Batch Operations

- Select multiple files/folders
- Analyze and apply suggestions in bulk
- Undo available for entire batch operations

---

## For Developers

### Building from Source

#### Prerequisites

- Node.js 18+ and npm 8+
- Git
- Tesseract OCR installed and on PATH (for PDF/image OCR fallback)

#### Setup

```bash
git clone https://github.com/iLevyTate/elstratosort.git
cd elstratosort
npm install       # Automatically sets up Ollama, ChromaDB, and AI models
npm run dev       # Start development mode
```

> **⚠️ Beta Notice**: The automatic dependency installation feature is currently in beta and may not
> work as expected on all systems. If you encounter issues during `npm install` or the app fails to
> detect Ollama/ChromaDB, please use the manual installation instructions below.

**Automatic Setup Commands** (Beta):

```bash
npm run setup:deps         # Install both Ollama and ChromaDB
npm run setup:ollama       # Install Ollama + pull models
npm run setup:chromadb     # Install ChromaDB Python module
npm run setup:ollama:check # Verify Ollama installation
npm run setup:chromadb:check # Verify ChromaDB installation
```

#### Manual Dependency Installation (Recommended for Full Functionality)

If the automatic setup doesn't work, install dependencies manually via CLI:

**1. Install Ollama**

```bash
# Windows (PowerShell as Administrator)
winget install Ollama.Ollama
# Or download from: https://ollama.ai/download

# macOS
brew install ollama
# Or download from: https://ollama.ai/download

# Linux
curl -fsSL https://ollama.ai/install.sh | sh
```

**2. Pull Required AI Models**

After installing Ollama, pull the required models:

```bash
# Start Ollama service (if not running)
ollama serve

# In a new terminal, pull the models (~6GB total)
ollama pull llama3.2:latest      # Text analysis model
ollama pull gemma3:latest        # Vision/image analysis model (multimodal)
ollama pull mxbai-embed-large    # Embedding model for similarity search
```

**3. Install ChromaDB**

ChromaDB requires Python 3.8+ to be installed on your system.

```bash
# Windows (PowerShell)
pip install --user chromadb

# macOS/Linux
pip3 install --user chromadb
# Or with pipx for isolated installation:
pipx install chromadb
```

**4. Verify Installation**

```bash
# Verify Ollama is running
curl http://127.0.0.1:11434/api/tags
# Or on Windows: Invoke-RestMethod http://127.0.0.1:11434/api/tags

# Verify ChromaDB module is installed
python -c "import chromadb; print('ChromaDB OK')"
# Or: python3 -c "import chromadb; print('ChromaDB OK')"
```

#### Build Commands

- Quick build (Windows): run `BUILD_INSTALLER.bat` or `BUILD_INSTALLER.ps1` to produce an installer
  in `release/build/`.
- Manual builds:

```bash
npm run build        # Build renderer
npm run dist         # Create installer for current platform
npm run dist:win     # Create Windows installer
npm run dist:mac     # Create macOS installer
npm run dist:linux   # Create Linux packages
```

#### Installer Location

After running `npm run dist` or `npm run dist:win`, installers are created in:

- Windows: `release/build/StratoSort-Setup-<version>.exe` (NSIS installer with custom branding)
- macOS: `release/build/StratoSort-<version>.dmg`
- Linux: `release/build/StratoSort-<version>.AppImage`

### Testing

```bash
npm test                     # Run all Jest tests (unit + integration)
npm run test:coverage        # Run tests with coverage report
npm run test:e2e             # Run Playwright E2E tests
npm run lint                 # Check code style (ESLint)
npm run format:check         # Check code formatting (Prettier)
npm run ci                   # Full CI pipeline: format, lint, test, build
```

### Architecture Overview

- **Electron multi-process**: Sandboxed React renderer communicating with the Node.js main process
  via IPC.
- **Data plane**: ChromaDB stores embeddings; backend services orchestrate analysis and
  organization.
- **AI**: Ollama provides local LLM inference (text + vision models); ChromaDB handles vector
  search.
- **State**: Redux Toolkit with persistence middleware in the renderer.
- **Security**: Context isolation with a constrained preload bridge (`window.electronAPI`), IPC
  channel allowlisting, and rate limiting.
- **Dependency Management**: Automated Ollama + ChromaDB installation and startup via preflight
  checks.
- Further detail: see `docs/ARCHITECTURE.md` and `docs/DI_PATTERNS.md`.

### Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make changes.
4. Run tests and linting.
5. Submit a pull request.

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design and data flow
- [Configuration Reference](docs/CONFIG.md) — Environment variables and settings
- [Dependency Injection Patterns](docs/DI_PATTERNS.md) — Service container usage
- [Learning Guide](docs/LEARNING_GUIDE.md) — Onboarding for new developers
- [Reference & Glossary](docs/REFERENCE_AND_GLOSSARY.md) — Terminology and concepts
- [Code Examples](docs/CODE_EXAMPLES.md) — Common patterns and examples
- [Testing Strategy](docs/TESTING_STRATEGY.md) — Test organization and coverage
- [Code Quality Standards](docs/CODE_QUALITY_STANDARDS.md) — Style guide and best practices

## Troubleshooting

### AI Models Not Working

- Run `npm run setup:ollama:check` to verify Ollama installation.
- Ensure Ollama is running: `ollama serve` or let the app auto-start it.
- Check Settings → AI Configuration for model status.
- Re-run setup: `npm run setup:ollama` to pull missing models.

### ChromaDB Connection Issues

- The app auto-starts ChromaDB on first run (Python-based local server).
- To use an external/Dockerized ChromaDB: set `CHROMA_SERVER_URL` (e.g.,
  `http://192.168.1.100:8000`).
- Verify ChromaDB: `curl http://127.0.0.1:8000/api/v1/heartbeat`
- Re-run setup: `npm run setup:chromadb`

### Files Not Moving

- Check file permissions (Windows: ensure files aren't locked by another app).
- Ensure destination folders exist.
- Review the operation log in the app.

### Performance Issues

- Close other applications to free RAM/CPU.
- Check available disk space (models require ~6GB).
- Consider using smaller AI models (e.g., `qwen2.5:3b` instead of `7b`).
- Check `docs/CONFIG.md` for performance tuning variables.

## License

MIT License - See [LICENSE](LICENSE) for details.

## Links

- GitHub: [github.com/iLevyTate/elstratosort](https://github.com/iLevyTate/elstratosort)
- Issues: [Report a bug](https://github.com/iLevyTate/elstratosort/issues)
- Ollama: [ollama.ai](https://ollama.ai)
- ChromaDB: [trychroma.com](https://www.trychroma.com)

## Acknowledgments

- Powered by [Ollama](https://ollama.ai) for local AI
- Built with [Electron](https://www.electronjs.org/) and [React](https://reactjs.org/)
- UI components from [Tailwind CSS](https://tailwindcss.com/)

---

Built for privacy-conscious users.
