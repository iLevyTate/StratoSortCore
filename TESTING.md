# ElStratoSort Testing Guide

**Version:** 2.0.0 **Date:** 2026-01-18 **Purpose:** The single source of truth for testing
ElStratoSort—from quick manual checks to deep automated regression suites.

---

## ⚡ 1. Quick Manual Checklist (QA)

Use this guide for a 5-minute pre-release verification.

### A. Launch & Setup

- [ ] **Startup:** Splash screen shows "Connecting to AI..." and completes successfully.
- [ ] **UI Density:** Verify cards/buttons on the "Setup" screen have ample breathing room (32px
      `spacious` layout).
- [ ] **Smart Folders:**
  - [ ] Create a folder named "Test Docs".
  - [ ] Click "Generate with AI" (description should auto-fill).
  - [ ] Save; verify it appears in the grid.

### B. Discovery & Analysis

- [ ] **Import:** Drag & drop a mixed batch (PDF, Image, Text) into the window.
- [ ] **Analysis:** Progress bar moves; files appear with correct icons and AI-generated tags.
- [ ] **Edge Cases:** Drop a 0-byte file or `.tmp` file—app should ignore or handle gracefully
      without crashing.

### C. Organization & Actions

- [ ] **Suggestions:** Verify AI suggests "Test Docs" for relevant content.
- [ ] **Confidence:** Scores are dynamic (e.g., 85%, 92%), not stuck at a default value.
- [ ] **Execution:**
  - [ ] Click "Organize Files"; verify files actually move on disk.
  - [ ] Click "Undo"; verify files return to original location.

### D. Knowledge Graph (Visuals)

- [ ] **Layout:** Graph is aligned and readable (not a "hairball").
- [ ] **Color Coding:** Nodes are colored by type (Blue=Docs, Purple=Images).
- [ ] **Interactivity:**
  - [ ] Hover over a connection line: Tooltip says **"Relationship Analysis"** and explains _why_
        (e.g., "Both are Invoices").
  - [ ] Search (Ctrl+K): Typing filters the graph nodes in real-time.

### E. Resilience

- [ ] **Settings Persistence:** Change Theme/Naming Strategy → Restart App → Verify saved.
- [ ] **Offline Mode:** Disconnect internet → Analyze file → Verify success (Local AI).

---

## 🤖 2. Automated Testing

For developers and CI pipelines.

### Run Tests

```powershell
# Unit & Integration Tests (Fast)
npm test

# End-to-End Tests (Slow, requires build)
npm run build
npm run test:e2e

# Run specific suite
npm test -- settings-service
```

### Coverage Goals

- **Unit/Integration:** 70%+ (Focus: Business logic, Services)
- **E2E:** Critical paths only (Startup, Analysis flow, Organization)

---

## 🧠 3. Testing Strategy & Critical Paths

Where to focus your testing efforts.

### Priority 1: File Analysis Pipeline

**Risk:** High. If this fails, the app does nothing.

- **Path:** User Selects → Validation → Extraction → LLM Analysis → Results.
- **Key Services:** `FileAnalysisService.js`, `OllamaService.js`.
- **Test For:** Corrupted PDFs, Password-protected files, 0-byte files.

### Priority 2: Organization System

**Risk:** High (Data Loss).

- **Path:** Suggestion → User Confirm → Move File → Undo.
- **Key Services:** `OrganizationSuggestionService.js`, `UndoRedoService.js`.
- **Test For:** Permission denied, Disk full, Filename collisions.

### Priority 3: IPC & Resilience

**Risk:** Medium.

- **Path:** Renderer ↔ Main Process Communication.
- **Test For:** App resuming after sleep, rapid-fire IPC calls, offline handling.

---

## 🛠️ 4. Debugging & Troubleshooting

### Log Locations

- **Windows:** `%APPDATA%/El StratoSort/logs/`
- **macOS:** `~/Library/Logs/El StratoSort/`
- **Linux:** `~/.config/El StratoSort/logs/`

### Common Issues

| Symptom                  | Probable Cause               | Fix                                               |
| ------------------------ | ---------------------------- | ------------------------------------------------- |
| **Analysis Stuck**       | Ollama service down          | Run `ollama serve` in terminal. Check port 11434. |
| **No Text in Images**    | Tesseract missing            | Install Tesseract (see README).                   |
| **Search Empty**         | ChromaDB issue               | Check logs. Verify python/pip dependencies.       |
| **Graph "Congested"**    | Similarity threshold too low | Adjust `threshold` in `UnifiedSearchModal.jsx`.   |
| **"Cannot find module"** | Stale Webpack cache          | Run `npm run clean`.                              |

---

## 🐛 5. Reporting Bugs

If you find an issue, please report it on GitHub with:

1. **Steps to Reproduce:** Exact sequence of clicks.
2. **Environment:** OS Version, RAM, Ollama Version.
3. **Logs:** Attach relevant snippets from the log files above.
