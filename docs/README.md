# StratoSort Documentation Index

This directory contains the essential documentation for the StratoSort codebase. Use this guide to jump to the right reference quickly.

## Quick Links

| Document                                                 | Description                                       | Audience       |
| -------------------------------------------------------- | ------------------------------------------------- | -------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                     | High-level system design and data flow            | All developers |
| [CODE_QUALITY_STANDARDS.md](./CODE_QUALITY_STANDARDS.md) | Coding standards and style guide                  | All developers |
| [ERROR_HANDLING_GUIDE.md](./ERROR_HANDLING_GUIDE.md)     | Error handling patterns and best practices        | All developers |
| [CONFIG.md](./CONFIG.md)                                 | Environment variables and configuration reference | All developers |

## Architecture & Design

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture diagram showing the relationship between Renderer, IPC, and Main processes.
- **[DI_PATTERNS.md](./DI_PATTERNS.md)** - Dependency injection patterns and ServiceContainer usage.

## Development Standards

- **[CODE_QUALITY_STANDARDS.md](./CODE_QUALITY_STANDARDS.md)** - Comprehensive style guide covering naming conventions, acceptable complexity, and review checklists.
- **[IMPORT_PATH_STANDARDS.md](./IMPORT_PATH_STANDARDS.md)** - Import path conventions for main/renderer/shared modules.

## Reliability & Testing

- **[ERROR_HANDLING_GUIDE.md](./ERROR_HANDLING_GUIDE.md)** - Centralized error handling patterns and utilities.
- **[TESTING_STRATEGY.md](./TESTING_STRATEGY.md)** - Test organization, patterns, and coverage goals.

## Configuration

- `src/shared/performanceConstants.js` - All timing and performance tuning constants.
- `src/shared/config/configSchema.js` - Configuration schema definitions.
- **[CONFIG.md](./CONFIG.md)** - Environment variable reference.

## Directory Structure

```
docs/
├── README.md                        # This index file
├── ARCHITECTURE.md                  # System design
├── CODE_QUALITY_STANDARDS.md        # Style guide
├── CONFIG.md                        # Environment variables
├── DI_PATTERNS.md                   # Dependency injection
├── ERROR_HANDLING_GUIDE.md          # Error patterns
├── IMPORT_PATH_STANDARDS.md         # Import conventions
└── TESTING_STRATEGY.md              # Test strategy
```

## Contributing

When adding new documentation:

1. Follow the naming convention: `UPPERCASE_WITH_UNDERSCORES.md`
2. Add an entry to this README.md index
3. Include a clear description of the document's purpose
4. Link to related documents where appropriate
