# StratoSort Documentation Index

This directory contains comprehensive documentation for the StratoSort codebase. Use this guide to
find the right documentation for your needs.

## Quick Links

| Document                                                 | Description                                | Audience       |
| -------------------------------------------------------- | ------------------------------------------ | -------------- |
| [CONFIG.md](./CONFIG.md)                                 | Installation, dependencies & configuration | All users      |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                     | High-level system design and data flow     | All developers |
| [CODE_QUALITY_STANDARDS.md](./CODE_QUALITY_STANDARDS.md) | Coding standards and style guide           | All developers |
| [ERROR_HANDLING_GUIDE.md](./ERROR_HANDLING_GUIDE.md)     | Error handling patterns and best practices | All developers |

## Installation & Dependencies

> **⚠️ Beta Notice**: The automatic dependency installation feature is in beta. See
> [CONFIG.md](./CONFIG.md#dependency-installation-beta) for manual CLI installation instructions.

- **[CONFIG.md](./CONFIG.md)** - Complete dependency installation guide including:
  - Manual CLI installation for Ollama and ChromaDB
  - Required AI models and how to pull them
  - Environment variable reference
  - Troubleshooting tips

## Architecture & Design

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture diagram showing the relationship
  between Renderer, IPC, and Main processes
- **[DI_PATTERNS.md](./DI_PATTERNS.md)** - Dependency injection patterns and ServiceContainer usage

## Development Standards

- **[CODE_QUALITY_STANDARDS.md](./CODE_QUALITY_STANDARDS.md)** - Comprehensive style guide covering:
  - Naming conventions
  - Function length and complexity guidelines
  - JSDoc documentation standards
  - Code review checklist

- **[IMPORT_PATH_STANDARDS.md](./IMPORT_PATH_STANDARDS.md)** - Import path conventions for
  main/renderer/shared modules

- **[ERROR_HANDLING_GUIDE.md](./ERROR_HANDLING_GUIDE.md)** - Centralized error handling patterns and
  utilities

## Performance & Optimization

- **[LLM_OPTIMIZATION.md](./LLM_OPTIMIZATION.md)** - AI/LLM performance tuning strategies
- **[OPTIMIZATION_DIAGRAM.md](./OPTIMIZATION_DIAGRAM.md)** - Visual optimization flow diagrams

> Legacy/per-version performance reports have been archived locally to `docs/.legacy/archived-docs/`
> (gitignored).

## Testing

- **[TESTING_STRATEGY.md](./TESTING_STRATEGY.md)** - Test organization, patterns, and coverage goals

## Utilities & Helpers

- **[EDGE_CASE_UTILITIES_GUIDE.md](./EDGE_CASE_UTILITIES_GUIDE.md)** - Edge case handling utilities
  documentation

> Legacy migration notes have been archived locally to `docs/.legacy/archived-docs/` (gitignored).

## Maintenance

- **`REFACTORING_CANDIDATES.md`** - (Archived locally; gitignored)
- **`BUGFIXES.md`** - (Archived locally; gitignored)

> **Note:** Legacy development reports and session logs have been archived to `docs/.legacy/` (not
> tracked in git).

## Configuration

Environment variables and configuration are centralized in:

- `src/shared/performanceConstants.js` - All timing and performance tuning constants
- `src/shared/config/configSchema.js` - Configuration schema definitions
- See [CONFIG.md](./CONFIG.md) for environment variable reference

## Directory Structure

```
docs/
├── README.md                        # This index file
├── ARCHITECTURE.md                  # System design
├── CODE_EXAMPLES.md                 # Common patterns
├── CODE_QUALITY_STANDARDS.md        # Style guide
├── CONFIG.md                        # Environment variables
├── DI_PATTERNS.md                   # Dependency injection
├── ERROR_HANDLING_GUIDE.md          # Error patterns
├── IMPORT_PATH_STANDARDS.md         # Import conventions
├── LEARNING_GUIDE.md                # Developer onboarding
├── LLM_OPTIMIZATION.md              # AI tuning
├── OPTIMIZATION_DIAGRAM.md          # Optimization visuals
├── REFERENCE_AND_GLOSSARY.md        # Terms and concepts
├── TESTING_STRATEGY.md              # Test strategy
└── .legacy/                         # Local-only archived docs/reports (gitignored)
```

## Contributing

When adding new documentation:

1. Follow the naming convention: `UPPERCASE_WITH_UNDERSCORES.md`
2. Add an entry to this README.md index
3. Include a clear description of the document's purpose
4. Link to related documents where appropriate
