# StratoSort Core Documentation Index

This directory contains comprehensive documentation for the StratoSort codebase. Use this guide to
find the right documentation for your needs.

## Quick Links

| Document                                                 | Description                                           | Audience       |
| -------------------------------------------------------- | ----------------------------------------------------- | -------------- |
| [CONFIG.md](./CONFIG.md)                                 | Installation, dependencies & configuration            | All users      |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                     | High-level system design and data flow                | All developers |
| [LEARNING_GUIDE.md](./LEARNING_GUIDE.md)                 | Codebase learning guide with glossary & code examples | New developers |
| [CODE_QUALITY_STANDARDS.md](./CODE_QUALITY_STANDARDS.md) | Coding standards and style guide                      | All developers |
| [ERROR_HANDLING_GUIDE.md](./ERROR_HANDLING_GUIDE.md)     | Error handling patterns and best practices            | All developers |

## Installation & Dependencies

> **Note**: Model setup is handled by `setup:models` (OCR uses system Tesseract or the JS fallback).
> See [CONFIG.md](./CONFIG.md#model--ocr-setup) for details.

- **[CONFIG.md](./CONFIG.md)** - Complete setup guide including:
  - Default AI models (text, vision, embedding)
  - Model download and OCR setup
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

- **[TESTING.md](../TESTING.md)** - **Single Source of Truth** for:
  - Quick Manual QA Checklist
  - Automated Test Commands
  - Critical Path Strategy
  - Debugging Tips

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
├── DI_PATTERNS.md                       # Dependency injection
├── ERROR_HANDLING_GUIDE.md              # Error patterns
├── GRAPH_INTEGRATION_PLAN.md            # Graph feature roadmap
└── LEARNING_GUIDE.md                    # Developer onboarding (glossary + examples)
```

## Contributing

When adding new documentation:

1. Follow the naming convention: `UPPERCASE_WITH_UNDERSCORES.md`
2. Add an entry to this README.md index
3. Include a clear description of the document's purpose
4. Link to related documents where appropriate
