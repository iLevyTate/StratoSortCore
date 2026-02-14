# StratoSort Core Testing Guide

**Version:** 2.0.1  
**Date:** 2026-02-13  
**Purpose:** Single source of truth for manual QA and automated test expectations.

---

## 1) Quick Manual Checklist (QA)

Use this checklist before release candidates and before merging changes that impact user workflows.

### A. Launch and Baseline

- [ ] App launches without fatal errors.
- [ ] AI setup/readiness state is clear (either ready or setup prompt is shown).
- [ ] Existing settings load correctly (theme, preferences, and configured smart folders).

### B. File Intake and Analysis

- [ ] Import a mixed set of files (PDF, image, and text-based document).
- [ ] Analysis completes and results include classification/tags without UI freezes.
- [ ] Unsupported or empty files are handled gracefully (no crash, clear status).

### C. Organization and Safety

- [ ] Suggestions are sensible for at least one known test folder.
- [ ] Apply organization actions and verify files moved to expected locations.
- [ ] Undo restores files to the original location.
- [ ] Filename collisions/permission issues are surfaced clearly and do not corrupt data.

### D. Search and Graph

- [ ] Unified search returns meaningful results for known test terms.
- [ ] Search filtering updates results in real time.
- [ ] Knowledge graph renders and remains interactive under normal load.

### E. Resilience

- [ ] Restart app and confirm key state persists.
- [ ] Validate core analysis flow still works offline after models are installed.

---

## 2) Automated Test Commands

Run these locally before opening a PR.

```powershell
# Formatting and lint
npm run format:check
npm run lint

# Unit/integration tests
npm test

# Optional deeper coverage
npm run test:integration
npm run test:coverage

# Optional E2E (slower)
npm run build
npm run test:e2e
```

Notes:

- `npm run ci` runs the same baseline checks as CI (`format:check`, `lint`, `test`, `build`).
- Use targeted test commands when iterating (`npm test -- <pattern>`).

---

## 3) Critical Test Focus Areas

Prioritize these paths when time is limited:

1. **Analysis pipeline**: import -> validate -> extract -> classify -> render results.
2. **Organization safety**: suggest -> apply move -> undo/rollback.
3. **Search quality**: semantic search relevance and ranking stability.
4. **IPC resilience**: renderer/main interactions under repeated actions.

---

## 4) Debugging and Troubleshooting

### Log Locations

- **Windows:** `%APPDATA%/stratosort/logs/`
- **macOS:** `~/Library/Logs/stratosort/`
- **Linux:** `~/.config/stratosort/logs/`

### Common Issues

| Symptom                | Probable Cause             | Recommended Fix                                |
| ---------------------- | -------------------------- | ---------------------------------------------- |
| Analysis never starts  | Models unavailable         | Run `npm run setup:models:check`               |
| OCR results are poor   | OCR runtime missing/failed | Run `npm run setup:vision-runtime:check`       |
| Test flakiness         | Stale build artifacts      | Run `npm run clean` then re-run tests          |
| Build/test environment | Dependency drift           | Run `npm ci` to restore lockfile-based install |

---

## 5) Reporting Bugs

When filing a bug report, include:

1. Reproduction steps (exact sequence).
2. Expected behavior and actual behavior.
3. Environment (OS version, app version, hardware details when relevant).
4. Relevant logs from the paths above.
