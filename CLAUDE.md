# ElStratoSort - Project Intelligence

## What This Is

ElStratoSort is a privacy-first, local AI-powered document organizer built with Electron 40+. It
uses Ollama for local LLM inference and ChromaDB for vector search. All processing happens
on-device - no data leaves the machine.

## Tech Stack

- **Runtime:** Electron 40 (main + renderer + preload processes)
- **Frontend:** React 19 + Redux Toolkit + Tailwind CSS 4 + Framer Motion
- **AI Backend:** Ollama (LLM/vision) + ChromaDB (vectors) + Tesseract.js (OCR)
- **Build:** Webpack 5 (3 configs: main, preload, renderer) + Babel 7
- **Package:** electron-builder 26 (NSIS/Portable on Windows, DMG on macOS, AppImage on Linux)
- **Test:** Jest 30 + Playwright 1.58
- **Lint:** ESLint 9 (FlatConfig) + Prettier 3

## Architecture

### Process Model

- **Main process** (`src/main/simple-main.js`): Window management, 30+ services, IPC server,
  Ollama/ChromaDB orchestration
- **Preload** (`src/preload/preload.js`): Secure IPC bridge with rate limiting (200 req/s), input
  sanitization, path validation, timeout handling
- **Renderer** (`src/renderer/`): React SPA with Redux state, no direct Node.js access

### Key Directories

```
src/main/services/       # 30+ backend services (OllamaService, SearchService, etc.)
src/main/analysis/       # Document/image analysis pipeline + embedding queue
src/main/core/           # Electron lifecycle, window creation, auto-updater, IPC registry
src/main/ipc/            # IPC handler registrations
src/renderer/components/ # React components organized by feature (discover/, organize/, search/, settings/, setup/)
src/renderer/store/      # Redux slices, middleware (persistence, IPC), thunks, selectors
src/shared/              # Cross-process utilities (logger, security, config schemas, constants)
test/                    # 264+ test files (unit, integration, e2e, perf, stress)
scripts/                 # 14 build/setup scripts (Ollama, ChromaDB, Tesseract, icons, runtime)
```

### Data Flow

- File analysis: User selects files -> Validation -> Document extraction -> LLM analysis -> Vector
  DB storage -> UI display
- Organization: AI suggestions -> User confirmation -> Atomic file move with undo/redo
- Search: Query -> Vector search + full-text (Lunr) -> Re-ranking -> Results

## Development Commands

```bash
npm run dev              # Full dev environment with HMR
npm run build            # Production build (all 3 webpack configs)
npm test                 # Jest unit/integration tests
npm run test:coverage    # Tests with coverage report
npm run test:e2e         # Playwright E2E tests
npm run lint             # ESLint check
npm run format:check     # Prettier check
npm run ci               # format:check + lint + test + build (what CI runs)
npm run dist:win         # Build Windows installer
```

## Conventions

- **IPC channels** are defined in `src/shared/constants.js` and validated in preload. Run
  `npm run preload:check` to verify channel consistency.
- **Services** follow dependency injection patterns documented in `docs/DI_PATTERNS.md`.
- **Error handling** uses custom error types in `src/main/errors/` with a centralized error
  classifier.
- **File operations** use atomic writes via `src/shared/atomicFileOperations.js` (write-to-temp then
  rename).
- **State persistence** uses debounced localStorage writes (1s debounce, 5s max wait) with
  quota-exceeded fallbacks.
- **Logging** uses structured logger from `src/shared/logger.js` with correlation IDs and JSONL
  format.
- **Security config** is centralized in `src/shared/securityConfig.js` (path limits, dangerous
  paths, rate limits, allowlisted settings).

## Known Production Gaps

These are tracked gaps that the project slash commands help address:

1. **Sandbox disabled** in renderer (`src/main/core/createWindow.js:130`) - preload uses `require()`
   for shared modules
2. **CSP allows 'unsafe-eval'** (`src/main/core/createWindow.js:260`)
3. **No crash reporting** - errors logged locally only, no Sentry/BugSnag
4. **No code signing** - electron-builder.json has no certificate config
5. **No macOS notarization** - `@electron/notarize` installed but not configured
6. **No state schema versioning** - persisted Redux state has no version or migration framework
7. **Test coverage unknown** - collection configured but thresholds not enforced
8. **No remote logging** - all logs stay on device
9. **Accessibility minimal** - some ARIA present but no audit performed

## Custom Slash Commands

Use these production-focused commands in Claude Code:

| Command                       | Purpose                               |
| ----------------------------- | ------------------------------------- |
| `/project:security-audit`     | Full Electron security audit          |
| `/project:harden-electron`    | Fix sandbox, CSP, webPreferences      |
| `/project:ipc-audit`          | Validate IPC contracts and security   |
| `/project:test-coverage`      | Run tests, analyze coverage gaps      |
| `/project:pre-release`        | Pre-release checklist validation      |
| `/project:perf-audit`         | Performance and memory analysis       |
| `/project:a11y-audit`         | Accessibility/WCAG compliance audit   |
| `/project:dep-audit`          | Dependency security and license audit |
| `/project:build-check`        | Build config and packaging validation |
| `/project:validate-state`     | State persistence and migration audit |
| `/project:fix-production-gap` | Interactive production gap fixer      |
