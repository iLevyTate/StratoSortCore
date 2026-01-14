# StratoSort Documentation Index

This directory contains comprehensive documentation for the StratoSort codebase. Use this guide to
find the right documentation for your needs.

## Quick Links

| Document                                                               | Description                                           | Audience       |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | -------------- |
| [CONFIG.md](./CONFIG.md)                                               | Installation, dependencies & configuration            | All users      |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                                   | High-level system design and data flow                | All developers |
| [LEARNING_GUIDE.md](./LEARNING_GUIDE.md)                               | Codebase learning guide with glossary & code examples | New developers |
| [CODE_QUALITY_STANDARDS.md](./CODE_QUALITY_STANDARDS.md)               | Coding standards and style guide                      | All developers |
| [ERROR_HANDLING_GUIDE.md](./ERROR_HANDLING_GUIDE.md)                   | Error handling patterns and best practices            | All developers |
| [CONTRIBUTING_TESTING_BEGINNER.md](./CONTRIBUTING_TESTING_BEGINNER.md) | Manual testing guide for beginners                    | Contributors   |
| [CONTRIBUTING_TESTING_ADVANCED.md](./CONTRIBUTING_TESTING_ADVANCED.md) | Manual testing guide for advanced users               | Contributors   |

## Installation & Dependencies

> **Beta Notice**: The automatic dependency installation feature is in beta. See
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
- **[LEARNING_GUIDE.md](./LEARNING_GUIDE.md)** - Comprehensive developer onboarding guide covering:
  - Architecture, design patterns, and data flow
  - AI/ML concepts and resilience engineering
  - Expanded glossary of terms
  - Code examples for common patterns

## Development Standards

- **[CODE_QUALITY_STANDARDS.md](./CODE_QUALITY_STANDARDS.md)** - Comprehensive style guide covering:
  - Naming conventions
  - Function length and complexity guidelines
  - JSDoc documentation standards
  - Code review checklist

- **[ERROR_HANDLING_GUIDE.md](./ERROR_HANDLING_GUIDE.md)** - Centralized error handling patterns and
  utilities

## Testing

- **[TESTING_STRATEGY.md](./TESTING_STRATEGY.md)** - Test organization, patterns, and coverage goals

See also: [REGRESSION_TEST_PLAN.md](../REGRESSION_TEST_PLAN.md) - Complete test case specifications

## Contributing (Manual Testing)

Want to help test El StratoSort? No coding experience required! Choose the guide that matches your
experience level:

| Guide                                                                  | Who It's For          | Description                                                                                  |
| ---------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| [CONTRIBUTING_TESTING_BEGINNER.md](./CONTRIBUTING_TESTING_BEGINNER.md) | Beginners             | Step-by-step instructions including how to install, test features, and report bugs on GitHub |
| [CONTRIBUTING_TESTING_ADVANCED.md](./CONTRIBUTING_TESTING_ADVANCED.md) | Intermediate/Advanced | Streamlined guide for those comfortable with Git, CLI, and debugging                         |

## Active Development

- **[GRAPH_INTEGRATION_PLAN.md](./GRAPH_INTEGRATION_PLAN.md)** - Graph visualization feature roadmap
  and implementation status

## Configuration

Environment variables and configuration are centralized in:

- `src/shared/performanceConstants.js` - All timing and performance tuning constants
- `src/shared/config/configSchema.js` - Configuration schema definitions
- See [CONFIG.md](./CONFIG.md) for environment variable reference

## Directory Structure

```
docs/
├── README.md                            # This index file
├── ARCHITECTURE.md                      # System design
├── CODE_QUALITY_STANDARDS.md            # Style guide
├── CONFIG.md                            # Environment variables
├── CONTRIBUTING_TESTING_BEGINNER.md     # Manual testing guide (beginners)
├── CONTRIBUTING_TESTING_ADVANCED.md     # Manual testing guide (advanced)
├── DI_PATTERNS.md                       # Dependency injection
├── ERROR_HANDLING_GUIDE.md              # Error patterns
├── GRAPH_INTEGRATION_PLAN.md            # Graph feature roadmap
├── LEARNING_GUIDE.md                    # Developer onboarding (glossary + examples)
├── TESTING_STRATEGY.md                  # Test strategy
└── .legacy/                             # Local-only archived docs/reports (gitignored)
```

## Contributing

When adding new documentation:

1. Follow the naming convention: `UPPERCASE_WITH_UNDERSCORES.md`
2. Add an entry to this README.md index
3. Include a clear description of the document's purpose
4. Link to related documents where appropriate
