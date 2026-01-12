# El StratoSort

![Coverage](https://img.shields.io/badge/coverage-76.4%25-orange)

**Smart File Organization with Local AI**

El StratoSort is a privacy-first document organizer that uses local AI to categorize and arrange
files without sending data to the cloud. It is a focused variation of the broader StratoSort family,
retaining the same logo and identity while targeting this branch’s priorities.

![StratoSort Logo](assets/stratosort-logo.png)

## Features

- **Local AI Analysis**: Powered by **Ollama** and fully offline.
- **Smart Organization**: Automatically categorizes files based on content, not just filenames.
- **Smart Folder Monitoring**: Watches specific folders and organizes new files as they arrive.
- **Image Understanding**: Analyzes visual content to categorize photos and screenshots.
- **Safe Operations**: Full undo/redo capability with history navigation.
- **Privacy-First**: No data exfiltration. All processing happens on your machine.
- **Vector Search**: Uses **ChromaDB** for semantic understanding and retrieval.

## Download & Install

> **Platform support note**: Releases are published for Windows/macOS/Linux, but **only the Windows
> build is robustly tested**. macOS/Linux builds are provided on a best-effort basis.

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

1. **Install**: Follow platform instructions above.
2. **Launch**: StratoSort runs a preflight check for Ollama and ChromaDB.
3. **Discover**: Add files or folders — **analysis starts automatically** as soon as items are
   loaded.
4. **Review**: Check AI suggestions and confidence scores.
5. **Organize**: Apply changes. Undo/redo is always available.

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

**Robustly tested:** Windows 11 (PowerShell, Node 18).  
**macOS/Linux:** Supported, but not yet tested to the same depth as Windows.

## Privacy & Security

- **100% Local**: No internet required after setup.
- **No Tracking**: No data collection or exfiltration.
- **Open Source**: Inspect the code to verify our claims.

## Advanced Features

### Smart Folders

Configure keywords and descriptions. The AI learns from selections and improves over time.

### Auto-Organization

Enable "Watch Downloads Folder" or "Watch Smart Folders" in Settings to automatically analyze and
organize new files.

### Batch Operations

Select multiple files/folders, analyze, and apply suggestions in bulk with full undo support.

---

## For Developers & Contributors

### Tech Stack

- **Electron**: Cross-platform desktop framework
- **React**: UI library
- **Ollama**: Local AI inference (Text/Vision)
- **ChromaDB**: Vector database for semantic search
- **Tailwind CSS**: Styling

### Quick Start

```bash
git clone https://github.com/iLevyTate/elstratosort.git
cd elstratosort
npm ci            # Install dependencies
npm run dev       # Start the app
```

**First Launch:** The app will guide you through installing Ollama and downloading AI models.

### Key Scripts

```bash
npm run dev            # Dev mode
npm run lint           # ESLint
npm test               # Jest unit/integration
npm run build          # Production webpack build
npm run dist:win       # Create Windows installer (run on Windows)
npm run dist:mac       # Create macOS installer (run on macOS)
npm run dist:linux     # Create Linux packages (run on Linux/WSL)
npm run setup:deps     # Install Ollama + ChromaDB (beta)
```

### Building installers

- **Windows (preferred)**: Run the GitHub Actions workflow **“Windows Dist (Manual)”** (Actions →
  select workflow → Run). Artifacts include the NSIS installer, portable EXE, and blockmap. Locally,
  run `npm run dist:win` on Windows.
- **macOS/Linux (optional)**: Build on the target OS with `npm run dist:mac` or
  `npm run dist:linux`. On Windows, Linux builds may require WSL or Developer Mode to allow
  symlinks.

### Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make changes and verify with `npm test`.
4. Submit a Pull Request.

## License

MIT License - See [LICENSE](LICENSE) for details.

## Links

- GitHub: [github.com/iLevyTate/elstratosort](https://github.com/iLevyTate/elstratosort)
- Issues: [Report a bug](https://github.com/iLevyTate/elstratosort/issues)
- Ollama: [ollama.ai](https://ollama.ai)
- ChromaDB: [trychroma.com](https://www.trychroma.com)
