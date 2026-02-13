# StratoSort Core - Project Intelligence

## What This Is

StratoSort Core is a privacy-first, local AI-powered document organizer built with Electron 40+. It
uses **node-llama-cpp** for in-process LLM inference and **Orama** for vector search. All processing
happens on-device with zero external dependencies - no data leaves the machine.

## Tech Stack

- **Runtime:** Electron 40 (main + renderer + preload processes)
- **Frontend:** React 19 + Redux Toolkit + Tailwind CSS 4 + Framer Motion
- **AI Backend:** node-llama-cpp (in-process LLM) + Orama (in-process vectors) + Tesseract.js (OCR)
- **Build:** Webpack 5 (3 configs: main, preload, renderer) + Babel 7
- **Package:** electron-builder 26 (NSIS/Portable on Windows, DMG on macOS, AppImage on Linux)
- **Test:** Jest 30 + Playwright 1.58
- **Lint:** ESLint 9 (FlatConfig) + Prettier 3

## Architecture

### Process Model

- **Main process** (`src/main/simple-main.js`): Window management, 30+ services, IPC server,
  LlamaService/OramaVectorService orchestration
- **Preload** (`src/preload/preload.js`): Secure IPC bridge with rate limiting (200 req/s), input
  sanitization, path validation, timeout handling
- **Renderer** (`src/renderer/`): React SPA with Redux state, no direct Node.js access

### Key Directories

```
src/main/services/       # 30+ backend services (LlamaService, OramaVectorService, SearchService, etc.)
src/main/analysis/       # Document/image analysis pipeline + embedding queue
src/main/core/           # Electron lifecycle, window creation, auto-updater, IPC registry
src/main/ipc/            # IPC handler registrations
src/renderer/components/ # React components organized by feature (discover/, organize/, search/, settings/, setup/)
src/renderer/store/      # Redux slices, middleware (persistence, IPC), thunks, selectors
src/shared/              # Cross-process utilities (logger, security, config schemas, constants)
test/                    # 264+ test files (unit, integration, e2e, perf, stress)
scripts/                 # 14 build/setup scripts (models, Tesseract, icons, runtime)
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
  `npm run generate:channels:check` to verify channel consistency.
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

1. **No code signing** - electron-builder.json has no certificate config
2. **No macOS notarization** - `@electron/notarize` installed but not configured
3. **No remote logging** - all logs stay on device (privacy-first by design; Sentry opt-in via
   `SENTRY_DSN`)
4. **Accessibility minimal** - some ARIA present but no formal WCAG audit performed

### Resolved Gaps

- ~~Sandbox disabled~~ - Sandbox enabled (`sandbox: true` in `src/main/core/createWindow.js`);
  preload is webpack-bundled, no runtime `require()`.
- ~~CSP allows 'unsafe-eval'~~ - CSP uses `script-src 'self'` with no `unsafe-eval`
  (`src/main/core/createWindow.js`).
- ~~No state schema versioning~~ - Migration framework implemented in
  `src/renderer/store/migrations.js` (`CURRENT_STATE_VERSION = 2`) with version stamping in
  `persistenceMiddleware.js`.
- ~~No crash reporting~~ - Sentry integration added (`src/main/simple-main.js`); local
  `electron-crashReporter` fallback writes to `crash-dumps/` when `SENTRY_DSN` is not set.
- ~~Test coverage unknown~~ - 50% global thresholds (branches/functions/lines/statements) enforced
  in `test/jest.config.js`; 346 suites / 5,500+ tests passing.

## Cursor Rules & Commands

The following capabilities are available as Cursor Rules. You can invoke them by asking for the
specific audit or check in natural language.

| Request               | Purpose                               | Rule File                               |
| :-------------------- | :------------------------------------ | :-------------------------------------- |
| "Run security audit"  | Full Electron security audit          | `.cursor/rules/audit-security.mdc`      |
| "Harden electron"     | Verify sandbox, CSP, webPreferences   | `.cursor/rules/harden-electron.mdc`     |
| "Audit IPC"           | Validate IPC contracts and security   | `.cursor/rules/audit-ipc.mdc`           |
| "Check test coverage" | Run tests, analyze coverage gaps      | `.cursor/rules/check-coverage.mdc`      |
| "Pre-release check"   | Pre-release checklist validation      | `.cursor/rules/check-prerelease.mdc`    |
| "Performance audit"   | Performance and memory analysis       | `.cursor/rules/audit-perf.mdc`          |
| "Accessibility audit" | Accessibility/WCAG compliance audit   | `.cursor/rules/audit-a11y.mdc`          |
| "Dependency audit"    | Dependency security and license audit | `.cursor/rules/audit-deps.mdc`          |
| "Check build"         | Build config and packaging validation | `.cursor/rules/check-build.mdc`         |
| "Validate state"      | State persistence and migration audit | `.cursor/rules/validate-state.mdc`      |
| "Fix production gaps" | Interactive production gap fixer      | `.cursor/rules/fix-production-gaps.mdc` |
