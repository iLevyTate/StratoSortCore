# El StratoSort

<p align="center">
  <img src="assets/stratosort-logo.png" alt="El StratoSort Logo" width="128" />
</p>

<p align="center">
  <strong>Smart File Organization with Local AI</strong>
</p>

<p align="center">
  <a href="https://github.com/iLevyTate/elstratosort/releases"><img src="https://img.shields.io/badge/version-1.2.1-blue?style=flat-square" alt="Version" /></a>
  <a href="https://github.com/iLevyTate/elstratosort/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Personal_Use_Only-blue?style=flat-square" alt="License" /></a>
  <a href="https://github.com/iLevyTate/elstratosort/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/iLevyTate/elstratosort/ci.yml?style=flat-square&label=CI" alt="CI Status" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/node-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#documentation">Docs</a> &bull;
  <a href="#contributing">Contributing</a> &bull;
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

**El StratoSort** turns file chaos into order using privacy-first local AI. It automatically
categorizes, tags, and organizes your documents completely offline—leveraging **Ollama** for
intelligence and **ChromaDB** for semantic search—ensuring your personal data stays 100% on your
machine.

## What's New in v1.2.1

- **Settings Backup & Restore** - Create snapshots, export/import settings, and recover quickly
- **User Data Migration** - Automatically restores legacy settings, history, and UI state on upgrade
- **Smarter Semantic Matching** - Richer embedding summaries improve folder suggestions and search
- **Update Experience** - Better update progress reporting and safer apply flow
- **Search & Chat Quality** - Improved retrieval tuning and fallback responses for clearer answers

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

## Features

| Feature                      | Description                                                                               |
| :--------------------------- | :---------------------------------------------------------------------------------------- |
| **🧠 Local AI Intelligence** | Powered by **Ollama** (LLMs + Vision) to understand file content, not just filenames.     |
| **🔒 Privacy-First**         | Zero data exfiltration. All processing happens locally on your device.                    |
| **👀 Smart Folder Watcher**  | Real-time monitoring that automatically analyzes and sorts new files as they arrive.      |
| **📸 Image Understanding**   | Uses vision models and OCR to categorize screenshots, photos, and scanned documents.      |
| **🕸️ Knowledge Graph**       | Interactive visualization of your file relationships, clusters, and semantic connections. |
| **🔍 Semantic Search**       | Find files by _meaning_ (e.g., "vacation photos") using Vector Search and AI Re-Ranking.  |
| **🛡️ Safe Operations**       | Full Undo/Redo capability for all file moves and renames.                                 |

## Quick Start

### Prerequisites

- **OS**: Windows 10/11 (Recommended), macOS 10.15+, or Linux.
- **RAM**: 8GB+ recommended.
- **Tools**: [Ollama](https://ollama.ai) (Required for AI), Python 3.9+ (For ChromaDB).

### Installation

```bash
git clone https://github.com/iLevyTate/elstratosort.git
cd elstratosort
npm ci
npm run dev
```

**First Launch:** The app will guide you through setting up Ollama, downloading the necessary AI
models, and installing the vector database.

> **Note:** El StratoSort is developed with a Windows-first approach. While releases are published
> for all major platforms, only the Windows build is robustly tested.

For detailed instructions, see the **[Getting Started Guide](docs/GETTING_STARTED.md)**.

## Privacy & Security

| Principle             | Implementation                                         |
| :-------------------- | :----------------------------------------------------- |
| **100% Local**        | No internet required after initial setup               |
| **No Tracking**       | Zero data collection or telemetry                      |
| **Open Source**       | Full source code available for inspection              |
| **Secure by Default** | Context isolation, input validation, path sanitization |

See [SECURITY.md](SECURITY.md) for our security policy.

## Advanced Capabilities

### 📂 Smart Folders & Watchers

Define categories with natural language descriptions. The **Smart Folder Watcher** monitors your
downloads or designated folders, automatically analyzing new items and moving them to the right
place based on their content.

### 🖼️ Vision & OCR

El StratoSort doesn't just read text files. It uses computer vision to "see" your images and
Tesseract OCR to read text inside them, allowing you to organize receipts, screenshots, and scanned
PDFs automatically.

### 🧠 Semantic Search & Re-Ranking

Search implies meaning. The built-in **ReRanker Service** uses a small LLM to evaluate search
results, ensuring the top results are conceptually relevant to your query, not just keyword matches.

## Documentation

| Document                                   | Description                  |
| :----------------------------------------- | :--------------------------- |
| [Getting Started](docs/GETTING_STARTED.md) | Installation and setup guide |
| [Architecture](docs/ARCHITECTURE.md)       | System design and data flow  |
| [Learning Guide](docs/LEARNING_GUIDE.md)   | Codebase onboarding          |
| [Graph Features](docs/FEATURES_GRAPH.md)   | Knowledge Graph capabilities |
| [IPC Contracts](docs/IPC_CONTRACTS.md)     | IPC communication specs      |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch
3. Make changes and verify with `npm test`
4. Submit a Pull Request

## License

Stratosort Personal Use License 1.0.0 (Based on PolyForm Noncommercial) - See [LICENSE](LICENSE) for
details.

---

<p align="center">
  <a href="https://github.com/iLevyTate/elstratosort">GitHub</a> &bull;
  <a href="https://github.com/iLevyTate/elstratosort/issues">Report Bug</a> &bull;
  <a href="https://github.com/iLevyTate/elstratosort/issues">Request Feature</a>
</p>

<p align="center">
  Built with <a href="https://ollama.ai">Ollama</a> and <a href="https://www.trychroma.com">ChromaDB</a>
</p>
