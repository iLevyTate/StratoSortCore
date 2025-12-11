# El StratoSort

![Coverage](https://img.shields.io/badge/coverage-73.4%25-orange)

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

1. Go to [Releases](https://github.com/stratosort/stratosort/releases/latest) and download
   `StratoSort-Setup-1.0.0.exe` (produced at `release/build/StratoSort-Setup-1.0.0.exe` after
   building).
2. Run the installer and follow the wizard.
3. On first launch, the app will verify AI components and guide you through any required Ollama
   setup (one-time, ~6GB).

### macOS

- Download `StratoSort-1.0.0.dmg` from
  [Releases](https://github.com/stratosort/stratosort/releases/latest).
- Open the DMG, drag StratoSort to Applications, then launch to complete AI setup.

### Linux

- Download `StratoSort-1.0.0.AppImage` from
  [Releases](https://github.com/stratosort/stratosort/releases/latest).
- Make it executable: `chmod +x StratoSort-1.0.0.AppImage`
- Run it: `./StratoSort-1.0.0.AppImage`

## Getting Started

New to StratoSort? See the [Quick Start Guide](QUICK_START.md) for a five-minute walkthrough.

1. Launch StratoSort to check AI readiness.
2. Select files or folders to organize.
3. Analyze for AI-driven suggestions.
4. Review suggestions.
5. Organize with one click.
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
git clone https://github.com/stratosort/stratosort.git
cd stratosort
npm install  # Automatically sets up Ollama and AI models
npm run dev  # Start development mode
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

- Windows: `release/build/StratoSort-Setup-1.0.0.exe`
- macOS: `release/build/StratoSort-1.0.0.dmg`
- Linux: `release/build/StratoSort-1.0.0.AppImage`

### Testing

```bash
npm test                    # Run all tests
npm run lint                # Check code style
npm run setup:ollama        # Set up Ollama and models
npm run setup:ollama:check  # Verify Ollama installation
```

### Architecture Overview

- Electron multi-process: sandboxed React renderer communicating with the Node.js main process via
  IPC.
- Data plane: ChromaDB stores embeddings; backend services orchestrate analysis and organization.
- State: Redux Toolkit with persistence middleware in the renderer.
- Security: Context isolation with a constrained preload bridge (`window.electronAPI`).
- Further detail: see `docs/ARCHITECTURE.md` and `docs/DI_PATTERNS.md`.

### Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make changes.
4. Run tests and linting.
5. Submit a pull request.

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Dependency Injection Patterns](docs/DI_PATTERNS.md)
- [Learning Guide](docs/LEARNING_GUIDE.md)
- [Reference & Glossary](docs/REFERENCE_AND_GLOSSARY.md)
- [Code Examples](docs/CODE_EXAMPLES.md)
- [Organization Guide](ORGANIZATION_SUGGESTIONS_GUIDE.md)
- [Ollama Setup Guide](OLLAMA_SETUP_GUIDE.md)
- [API Documentation](docs/API.md)

## Troubleshooting

### AI Models Not Working

- Run `npm run setup:ollama:check` to verify installation.
- Ensure Ollama is running: `ollama serve`.
- Check Settings → AI Configuration.

### Files Not Moving

- Check file permissions.
- Ensure destination folders exist.
- Review the operation log.

### Performance Issues

- Close other applications.
- Check available disk space.
- Consider using smaller AI models.

## License

MIT License - See [LICENSE](LICENSE) for details.

## Links

- Homepage: [stratosort.com](https://stratosort.com)
- GitHub: [github.com/stratosort/stratosort](https://github.com/stratosort/stratosort)
- Issues: [Report a bug](https://github.com/stratosort/stratosort/issues)
- Ollama: [ollama.ai](https://ollama.ai)

## Acknowledgments

- Powered by [Ollama](https://ollama.ai) for local AI
- Built with [Electron](https://www.electronjs.org/) and [React](https://reactjs.org/)
- UI components from [Tailwind CSS](https://tailwindcss.com/)

---

Built for privacy-conscious users.
