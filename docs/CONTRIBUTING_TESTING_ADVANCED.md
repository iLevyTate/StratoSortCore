# Manual Testing Contributor Guide (Intermediate/Advanced)

A streamlined guide for contributors comfortable with Git, GitHub, and command-line tools.

---

## Quick Start

### Option A: Test from Release Build

```bash
# Download latest release from:
# https://github.com/iLevyTate/elstratosort/releases/latest
```

### Option B: Test from Source (Recommended for deeper testing)

```bash
git clone https://github.com/iLevyTate/elstratosort.git
cd elstratosort
npm ci
npm run dev
```

### Prerequisites

- Node.js 18+
- 8GB+ RAM, 12GB+ disk space
- Ollama (auto-installed on first run, or: `winget install Ollama.Ollama`)
- Python 3.9+ (for ChromaDB)

---

## Testing Workflow

### 1. Environment Setup

```bash
# Verify Ollama is running
ollama list

# Pull required models if not present
ollama pull llama3.2
ollama pull mxbai-embed-large

# Optional: Start ChromaDB manually
pip install chromadb
# App handles ChromaDB lifecycle automatically
```

### 2. Test Matrix

| Category      | Tests            | Priority |
| ------------- | ---------------- | -------- |
| Installation  | INS-01 to INS-03 | High     |
| File Analysis | ANA-01 to ANA-05 | High     |
| Organization  | ORG-01 to ORG-05 | High     |
| Smart Folders | SMT-01 to SMT-03 | Medium   |
| Search/Graph  | SRC-01 to SRC-04 | Medium   |
| Automation    | AUT-01 to AUT-02 | Medium   |
| Settings      | SET-01 to SET-02 | Low      |
| Edge Cases    | EDG-01 to EDG-04 | High     |

Full test specifications: [REGRESSION_TEST_PLAN.md](../REGRESSION_TEST_PLAN.md)

---

## Test Categories

### Installation & Setup (INS)

| ID     | Test           | What to Verify                                       |
| ------ | -------------- | ---------------------------------------------------- |
| INS-01 | Clean install  | Installer completes, shortcuts created, app launches |
| INS-02 | First run      | Ollama/model detection, download flow (~6GB)         |
| INS-03 | Update install | Settings/data preserved after upgrade                |

### Core Analysis (ANA)

| ID     | Test              | Commands/Steps                                            |
| ------ | ----------------- | --------------------------------------------------------- |
| ANA-01 | PDF analysis      | Select text-rich PDF, verify summary/category/confidence  |
| ANA-02 | Image/OCR         | Select screenshot/photo, verify content extraction        |
| ANA-03 | Unsupported type  | Try `.exe`, `.bin` - should fail gracefully               |
| ANA-04 | Batch (10+ files) | Mixed file types, verify queue/progress                   |
| ANA-05 | Cancel            | Start batch, cancel mid-process, verify UI responsiveness |

### Organization (ORG)

| ID     | Test               | What to Verify                              |
| ------ | ------------------ | ------------------------------------------- |
| ORG-01 | Review suggestions | AI reasoning visible, folder path shown     |
| ORG-02 | Manual override    | Can change destination, preference saved    |
| ORG-03 | Execute move       | Files moved on disk, notification shown     |
| ORG-04 | Undo               | Files restored to original location         |
| ORG-05 | Collision handling | Rename/Skip/Overwrite prompt or auto-rename |

### Smart Folders (SMT)

| ID     | Test               | What to Verify                                                  |
| ------ | ------------------ | --------------------------------------------------------------- |
| SMT-01 | Create folder      | Settings > Smart Folders, add description, embeddings generated |
| SMT-02 | Semantic matching  | Receipt matches "Invoices" folder via content, not filename     |
| SMT-03 | Update description | Changed description affects matching behavior                   |

### Search & Graph (SRC)

| ID     | Test             | What to Verify                                       |
| ------ | ---------------- | ---------------------------------------------------- |
| SRC-01 | Semantic search  | `Ctrl+K`, query returns semantically related files   |
| SRC-02 | Graph navigation | Click nodes, pan canvas, edges connect related items |
| SRC-03 | View toggle      | Graph ↔ List switch, metadata visible in list        |
| SRC-04 | Autocomplete     | Type-ahead suggestions from files/tags/folders       |

### Automation (AUT)

| ID     | Test              | What to Verify                                            |
| ------ | ----------------- | --------------------------------------------------------- |
| AUT-01 | Downloads watcher | Enable in settings, download file, auto-analysis triggers |
| AUT-02 | Folder watcher    | Add source folder, drop file externally, detection works  |

### Edge Cases (EDG)

| ID     | Test              | What to Verify                                       |
| ------ | ----------------- | ---------------------------------------------------- |
| EDG-01 | Offline           | Disconnect internet, analysis still works (local AI) |
| EDG-02 | Corrupt file      | 0-byte or corrupted PDF - graceful error, no crash   |
| EDG-03 | Large file        | 100MB+ PDF - timeout/warning, no crash               |
| EDG-04 | Permission denied | Move to read-only folder - clear error message       |

---

## Debugging Tips

### View Logs

```bash
# Development mode - logs appear in terminal
npm run dev

# Production - check Electron logs
# Windows: %APPDATA%/El StratoSort/logs/
# macOS: ~/Library/Logs/El StratoSort/
# Linux: ~/.config/El StratoSort/logs/
```

### DevTools

```bash
# In dev mode, DevTools opens automatically
# In production, enable via menu or Ctrl+Shift+I
```

### Service Status

```bash
# Check Ollama
curl http://localhost:11434/api/tags

# Check ChromaDB (if running separately)
curl http://localhost:8000/api/v1/heartbeat
```

### Common Issues

| Symptom                | Likely Cause             | Debug Steps                            |
| ---------------------- | ------------------------ | -------------------------------------- |
| Analysis stuck         | Ollama not running       | `ollama serve`, check port 11434       |
| Search returns nothing | ChromaDB not initialized | Check logs for ChromaDB errors         |
| Models not loading     | Insufficient VRAM/RAM    | Try smaller model, check Task Manager  |
| File move fails        | Permission issue         | Check folder permissions, run as admin |

---

## Bug Report Template

```markdown
## Bug Report

### Environment

- **OS:** Windows 11 / macOS 14.x / Ubuntu 22.04
- **Version:** v1.x.x (from source / release build)
- **Node:** v18.x.x (if from source)
- **Ollama:** v0.x.x (`ollama --version`)
- **GPU:** NVIDIA RTX 3080 / Apple M2 / CPU only

### Test Reference

- **Test ID:** ANA-04
- **Category:** Core Analysis

### Description

[Concise description of the issue]

### Reproduction Steps

1.
2.
3.

### Expected vs Actual

- **Expected:**
- **Actual:**

### Logs/Screenshots

<details>
<summary>Console Output</summary>
```

[paste relevant logs]

```

</details>

### Additional Context
- Frequency: Always / Sometimes / Once
- Workaround found: Yes/No
- Related issues: #xxx
```

### Submit via CLI (gh)

```bash
# If you have GitHub CLI installed
gh issue create --repo iLevyTate/elstratosort \
  --title "Bug: [Brief description]" \
  --body-file bug-report.md \
  --label "bug"
```

---

## Performance Testing

### Metrics to Capture

```bash
# Monitor during testing
# Windows
tasklist /FI "IMAGENAME eq El StratoSort.exe" /FO LIST

# macOS/Linux
ps aux | grep -i stratosort
```

### Benchmark Scenarios

| Scenario             | Target  | How to Test                  |
| -------------------- | ------- | ---------------------------- |
| Startup time         | < 5s    | Time from launch to UI ready |
| Single file analysis | < 30s   | Standard 2MB PDF             |
| Batch (20 files)     | < 5 min | Mixed file types             |
| Search response      | < 2s    | After indexing complete      |
| Memory usage         | < 2GB   | During batch analysis        |

---

## Integration Testing Points

### IPC Boundaries

Test the renderer ↔ main process communication:

- File selection dialog invocation
- Analysis request/response
- Settings persistence
- Undo/redo state sync

### External Service Integration

| Service     | Test Method                                         |
| ----------- | --------------------------------------------------- |
| Ollama      | Kill service mid-analysis, verify graceful handling |
| ChromaDB    | Corrupt vector DB, verify rebuild behavior          |
| File System | Simulate full disk, verify error handling           |

---

## Contributing Your Results

### Via Pull Request (Preferred)

If you update test documentation or find reproducible issues with fixes:

```bash
git checkout -b test/fix-ana-04-batch-issue
# Make changes
git commit -m "test: document ANA-04 batch analysis edge case"
git push origin test/fix-ana-04-batch-issue
gh pr create
```

### Via Issue

For bugs without fixes - use the template above.

### Via Discussion

For questions or test methodology suggestions:

```
https://github.com/iLevyTate/elstratosort/discussions
```

---

## Test Data Resources

### Sample Files for Testing

Create a test corpus:

```
test-files/
├── pdf/
│   ├── invoice-sample.pdf      # Text-heavy
│   ├── scanned-receipt.pdf     # OCR required
│   └── large-document.pdf      # 50MB+
├── images/
│   ├── screenshot.png          # UI screenshot
│   ├── photo.jpg               # Natural image
│   └── receipt-photo.jpg       # OCR required
├── docs/
│   ├── report.docx
│   └── spreadsheet.xlsx
└── edge-cases/
    ├── empty.txt               # 0 bytes
    ├── corrupted.pdf           # Invalid PDF header
    └── special-chars-!@#.pdf   # Filename edge case
```

---

## Quick Reference

| Action         | Command/Location             |
| -------------- | ---------------------------- |
| Run tests      | `npm test`                   |
| E2E tests      | `npm run test:e2e`           |
| Dev mode       | `npm run dev`                |
| Lint           | `npm run lint`               |
| Full test plan | `../REGRESSION_TEST_PLAN.md` |
| Architecture   | `docs/ARCHITECTURE.md`       |
| Report bug     | `gh issue create`            |

---

## Questions?

- Check [existing issues](https://github.com/iLevyTate/elstratosort/issues)
- Review [TESTING_STRATEGY.md](./TESTING_STRATEGY.md)
- Open a [discussion](https://github.com/iLevyTate/elstratosort/discussions)
