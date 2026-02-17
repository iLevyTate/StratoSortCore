<p align="center">
  <img src="assets/stratosort-logo.png" alt="StratoSort Logo" width="128" />
</p>

<h1 align="center">StratoSort Core</h1>

<p align="center">
  <strong>Intelligent File Organization with Privacy-First Local AI</strong>
</p>

<p align="center">
  <a href="https://github.com/iLevyTate/StratoSortCore/releases"><img src="https://img.shields.io/badge/version-2.0.1-blue?style=flat-square" alt="Version" /></a>
  <a href="https://github.com/iLevyTate/StratoSortCore/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Personal_Use_Only-blue?style=flat-square" alt="License" /></a>
  <a href="https://github.com/iLevyTate/StratoSortCore/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/iLevyTate/StratoSortCore/ci.yml?style=flat-square&label=CI" alt="CI Status" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/node-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#download">Download</a> •
  <a href="#support-and-feedback">Support</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#contributing">Contributing</a> •
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

StratoSort Core helps you organize messy files with local AI that runs on your machine. It analyzes
content (not just filenames), suggests where files belong, and gives you semantic search with
Knowledge OS and graph tools. Your data stays local, and you can start with a normal installer - no
CLI setup required.

## Download

### End Users (No CLI)

<p>
  <a href="https://github.com/iLevyTate/StratoSortCore/releases"><img src="https://img.shields.io/badge/Download-Latest%20Release-2ea44f?style=for-the-badge" alt="Download Latest Release" /></a>
</p>

- **Windows/macOS installers:**
  [GitHub Releases](https://github.com/iLevyTate/StratoSortCore/releases)
- **Step-by-step install help:** [Install Guide](docs/INSTALL_GUIDE.md)
- **How to use the app:** [User Guide](docs/USER_GUIDE.md)
- **Want to help test?** [Beta Tester Guide](docs/BETA_TESTER_GUIDE.md)

## Support and Feedback

If you run into an issue or have an idea, these links are the fastest way to help:

- **Issues tab:** [View all issues](https://github.com/iLevyTate/StratoSortCore/issues)
- **Report a bug:**
  [Open bug report template](https://github.com/iLevyTate/StratoSortCore/issues/new?template=bug_report.md)
- **Request a feature:**
  [Open feature request issue](https://github.com/iLevyTate/StratoSortCore/issues/new)
- **Contributing guide:** [CONTRIBUTING.md](CONTRIBUTING.md)

## Demo

<p align="center">
  <strong>See StratoSort in action</strong>
</p>

> **Desktop:** Video plays directly below | **Mobile:** Click the filename to watch

https://github.com/user-attachments/assets/7cd1f974-33cb-4d2d-ac8d-ea30c015389b

## What's New in v2.0.0

- **In-Process AI Engine** — Embedded `node-llama-cpp` and `Orama`. No more background services to
  manage!
- **Zero-Setup Experience** — Just install and run. Models are downloaded automatically.
- **GPU Acceleration** — Automatic detection of Metal (macOS), CUDA (Windows/Linux), or Vulkan.
- **Performance Boost** — Faster startup, lower memory footprint, and improved search latency.

See **[CHANGELOG.md](CHANGELOG.md)** for complete release notes.

## Provenance

StratoSort Core is the successor to the original
[StratoSort Stack (legacy repository)](https://github.com/iLevyTate/elstratosort). This repository
represents a clean break starting from v2.0.0, focusing on a streamlined, in-process AI
architecture. For versions prior to v2.0.0, or to view the legacy codebase, please visit the
original repository.

## Features

| Feature                   | Description                                                                         |
| :------------------------ | :---------------------------------------------------------------------------------- |
| **Local AI Intelligence** | Built-in AI (node-llama-cpp) to understand file content, not just filenames         |
| **Privacy-First Design**  | Zero data exfiltration. All processing happens locally on your device               |
| **Smart Folder Watcher**  | Real-time monitoring that automatically analyzes and sorts new files as they arrive |
| **Image Understanding**   | Vision models and OCR categorize screenshots, photos, and scanned documents         |
| **Knowledge Graph**       | Interactive visualization of file relationships, clusters, and semantic connections |
| **Semantic Search**       | Find files by meaning using Orama Vector Search and AI Re-Ranking                   |
| **Safe Operations**       | Full Undo/Redo capability for all file moves and renames                            |

## Quick Start

### End Users — One Download, No CLI

1. **[Download the installer](https://github.com/iLevyTate/StratoSortCore/releases)** for Windows or
   macOS.
2. **Run it** — allow the app if your OS shows a security prompt (see
   [Install Guide](docs/INSTALL_GUIDE.md)).
3. **First launch** — choose a model profile and approve the download (~2-5GB, one-time).

No terminal, Python, Docker, or API keys. See the full **[Install Guide](docs/INSTALL_GUIDE.md)**
for step-by-step instructions on both platforms and how to handle unsigned-app prompts.

### Prerequisites

| Requirement          | Specification                                                   |
| :------------------- | :-------------------------------------------------------------- |
| **Operating System** | Windows 10/11 (64-bit), macOS 10.15+, or Linux                  |
| **Memory**           | 8GB RAM minimum (16GB recommended for best performance)         |
| **Storage**          | ~2-5GB for AI models (depends on profile chosen)                |
| **GPU (Optional)**   | NVIDIA CUDA, Apple Metal, or Vulkan-compatible for acceleration |

### Developers — Build from Source

```bash
git clone https://github.com/iLevyTate/StratoSortCore.git
cd StratoSortCore
npm ci
npm run dev
```

**First Launch:** The app automatically downloads required AI models (GGUF format) on first run. GPU
acceleration is auto-detected.

**Default Models (Base Small):** Llama 3.2 3B (text), LLaVA Phi-3 Mini (vision), all-MiniLM-L6-v2
(embeddings). A "Better Quality" profile with larger models is available during setup. Change
defaults in `src/shared/aiModelConfig.js`. See [docs/CONFIG.md](docs/CONFIG.md) for details.

## Advanced Capabilities

### Smart Folders and Watchers

Define categories with natural language descriptions. The Smart Folder Watcher monitors your
downloads or designated folders, automatically analyzing new items and routing them based on content
understanding.

### Vision and OCR

StratoSort Core doesn't just read text files—it uses computer vision to interpret images and
Tesseract OCR to extract text, enabling automatic organization of receipts, screenshots, and scanned
PDFs.

### Semantic Search and Re-Ranking

Search implies meaning. The built-in ReRanker Service uses a compact LLM to evaluate results,
surfacing conceptually relevant matches rather than simple keyword hits.

## Privacy and Security

| Principle                 | Implementation                                         |
| :------------------------ | :----------------------------------------------------- |
| **100% Local Processing** | No internet required after model download              |
| **Zero Telemetry**        | No data collection or tracking of any kind             |
| **Open Source**           | Full source code available for inspection              |
| **Secure by Default**     | Context isolation, input validation, path sanitization |

See **[SECURITY.md](SECURITY.md)** for the complete security policy.

## Documentation

| Document                                           | Description                              |
| :------------------------------------------------- | :--------------------------------------- |
| **[Install Guide](docs/INSTALL_GUIDE.md)**         | End-user install (Windows & Mac, no CLI) |
| **[User Guide](docs/USER_GUIDE.md)**               | Feature walkthrough for everyday use     |
| **[Beta Tester Guide](docs/BETA_TESTER_GUIDE.md)** | Testing + bug reporting for contributors |
| **[Getting Started](docs/GETTING_STARTED.md)**     | Developer setup and build guide          |
| **[Architecture](docs/ARCHITECTURE.md)**           | System design and data flow              |
| **[Graph Features](docs/FEATURES_GRAPH.md)**       | Knowledge Graph capabilities             |
| **[IPC Contracts](docs/IPC_CONTRACTS.md)**         | IPC communication specifications         |
| **[Motion System](docs/MOTION_SYSTEM.md)**         | UI animation timing and easing standards |
| **[Release Guide](docs/RELEASING.md)**             | Release process and checks               |

## Contributing

Contributions are welcome. Please see **[CONTRIBUTING.md](CONTRIBUTING.md)** for guidelines.

1. Fork the repository
2. Create a feature branch
3. Make changes and verify with `npm test`
4. Submit a Pull Request

## Inspiration and Related Projects

StratoSort builds on ideas from the growing ecosystem of AI-powered file organization:

| Project                                                                       | Description                                                            |
| :---------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| **[llama-fs](https://github.com/iyaja/llama-fs)**                             | Self-organizing filesystem with Llama 3; pioneered watch mode learning |
| **[Local-File-Organizer](https://github.com/QiuYannnn/Local-File-Organizer)** | Privacy-first organizer using Llama3.2 and LLaVA                       |
| **[ai-file-sorter](https://github.com/hyperfield/ai-file-sorter)**            | Cross-platform desktop app with preview and undo                       |
| **[Hazel](https://www.noodlesoft.com/)**                                      | Industry standard Mac file automation                                  |
| **[Sparkle](https://makeitsparkle.co/)**                                      | Mac AI organizer using GPT-4/Gemini                                    |

## License

**StratoSort Personal Use License 1.0.0** (Based on PolyForm Noncommercial)

See **[LICENSE](LICENSE)** for details.

---

<p align="center">
  <a href="https://github.com/iLevyTate/StratoSortCore">GitHub</a> •
  <a href="https://github.com/iLevyTate/StratoSortCore/issues">Report Bug</a> •
  <a href="https://github.com/iLevyTate/StratoSortCore/issues">Request Feature</a>
</p>

<p align="center">
  Built with <a href="https://github.com/withcatai/node-llama-cpp">node-llama-cpp</a> and <a href="https://orama.com">Orama</a>
</p>

<p align="center">
  © 2026 StratoSort Team
</p>
