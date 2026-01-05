# Changelog

All notable changes to StratoSort will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Smart Folder Watcher**: Automatically analyzes new and modified files in configured smart
  folders (F-1)
- **Undo History Navigation**: Jump to specific points in undo history (L-2)
- **Retry Mechanism**: "Retry Failed Files" button in Discover phase (M-3)
- **Conflict Detection**: Warning banner when multiple files target the same destination path (M-4)
- **AI Description Generation**: "Generate with AI" button for smart folders (C-1)
- Comprehensive test coverage for IPC handlers (settings.js, suggestions.js)
- SECURITY.md with vulnerability disclosure policy
- This CHANGELOG.md file
- E2E tests for semantic search functionality
- E2E tests for smart folder creation and verification
- DevTools auto-open in separate window during development (`npm run dev`)
- Error boundary around AnalysisResultsList to prevent crashes from malformed file data
- `getErrorMessage()` utility for consistent error extraction
- Centralized UI timeout constants (WIDGET_AUTO_SHOW, EMBEDDING_CHECK, STUCK_ANALYSIS_CHECK)

### Fixed

- **Critical**: Smart Folder Watcher race condition where watcher was null during IPC registration
  (NEW-1)
- **Critical**: DownloadWatcher starting before services initialized (C-2)
- **High**: Confidence slider resetting to 75% due to state race conditions (NEW-5/12)
- **High**: Undo/Redo UI not updating despite filesystem changes (H-3)
- **High**: Smart folder path loading race condition showing "Documents" string (H-1)
- **Medium**: Embeddings showing "0" count due to missing auto-refresh (NEW-2/9)
- **Medium**: "File in use" errors during auto-organize (NEW-4)
- **Medium**: Settings debounce flushing on close (H-2)
- **Medium**: Modal backdrop blur/z-index conflicts (F-3, M-1)
- **Medium**: Image files missing keywords in analysis history (NEW-10)
- **Medium**: Watcher reporting high confidence for unrelated files (NEW-11)
- **Critical**: LLM cache contamination causing wrong filename suggestions across file types
  - Added type discriminators (`type: 'document'` / `type: 'image'`) to cache keys
  - Added filename and content length to cache keys for uniqueness
  - Enhanced cache hit logging for debugging
- **Critical**: Stale closure in bulk category change causing wrong files to be updated
  - Used refs to always get latest values at debounce execution time
- **Critical**: Race condition in undo/redo system allowing concurrent action execution
  - Added mutex lock to prevent overlapping operations
  - Exposed `isExecuting` state for UI feedback
- Toast timer reset when parent component re-renders with new callback reference
  - Used ref for onClose callback to maintain timer stability
- ResizeObserver not attaching when container ref is null on first render
  - Switched to callback ref pattern for proper observation
- localStorage access crashes in private browsing mode
  - Wrapped all localStorage operations in try-catch
- Infinite loop potential in persistence middleware
  - Added re-entry guard to prevent recursive saves
- UndoStack listener cleanup on component remount
  - Added mounted state tracking to prevent setState on unmounted components
- Error handling in FloatingSearchContext useEffect
- ProcessingStateService timestamp updates on save
- ESLint warnings in test files
- Navigation selector in E2E tests to target phase navigation buttons specifically
- Unused `useCallback` import in SearchAutocomplete.jsx

### Improved

- **UI**: Replaced emojis with professional Lucide icons (UI-2)
- **UI**: Removed technical "File size limit" settings from UI (UI-1)
- **UI**: Temporarily removed confidence slider to prevent race conditions (NEW-12)
- Accessibility: Added `aria-live="polite"` to AnalysisProgress for screen readers
- Replaced hardcoded timeout values with centralized constants

## [1.0.0] - 2024-12-XX

### Added

#### Core Features

- **AI-Powered Document Organization**: Local LLM analysis using Ollama (llama3.2, llava models)
- **Semantic Search**: Vector-based file search using ChromaDB embeddings
- **Smart Folders**: AI-suggested organization with pattern learning
- **Multi-modal Analysis**: Support for documents (PDF, Word, Excel), images, and code files
- **Batch Processing**: Organize multiple files simultaneously with progress tracking
- **Auto-Organization**: Watch folder monitoring (e.g., Downloads) for automatic sorting

#### User Interface

- Modern React UI with TailwindCSS styling
- Dark/Light/System theme support
- Floating search widget for quick file discovery
- Interactive graph visualization for file relationships
- Drag-and-drop file organization
- Keyboard shortcuts for common operations

#### Organization Intelligence

- Content-based file categorization
- Extension pattern matching
- User behavior learning from accepted suggestions
- Multiple organization strategies (by type, date, project, etc.)
- Confidence scoring for suggestions

#### Data Management

- Settings backup and restore functionality
- Settings import/export with validation
- Undo/redo system for file operations
- Analysis history caching for performance

#### Developer Experience

- Comprehensive test suite (76%+ coverage, 4800+ tests)
- ESLint and Prettier configuration
- CI/CD pipeline with GitHub Actions
- Extensive documentation

### Security

- Context isolation enabled for Electron renderer
- Input validation using Zod schemas
- Path sanitization to prevent traversal attacks
- Prototype pollution protection in settings import
- No external network requests (privacy-first design)

### Technical

- Electron 35+ with modern security defaults
- React 19 with Redux Toolkit for state management
- Webpack 5 build system with code splitting
- Jest and Playwright testing infrastructure
- Multi-platform builds (Windows, macOS, Linux)

---

## Version History Format

### Types of Changes

- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Features that will be removed in future versions
- **Removed**: Features that have been removed
- **Fixed**: Bug fixes
- **Security**: Security-related changes

[Unreleased]: https://github.com/stratosort/stratosort/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/stratosort/stratosort/releases/tag/v1.0.0
