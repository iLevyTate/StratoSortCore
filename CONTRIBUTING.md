# Contributing to El StratoSort

<p align="center">
  <img src="https://img.shields.io/badge/contributions-welcome-brightgreen?style=flat-square" alt="Contributions Welcome" />
  <img src="https://img.shields.io/badge/PRs-welcome-blue?style=flat-square" alt="PRs Welcome" />
</p>

Thanks for your interest in contributing! This guide covers how to set up the repo, make changes,
and submit a high-quality pull request.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Pull Request Checklist](#pull-request-checklist)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

Be respectful, constructive, and kind. If you are unsure about behavior, default to being helpful.

## Getting Started

### Prerequisites

| Requirement | Version       | Notes                                        |
| ----------- | ------------- | -------------------------------------------- |
| Node.js     | See `.nvmrc`  | Use nvm for version management               |
| npm         | Latest        | Comes with Node.js                           |
| OS          | Windows 10/11 | Recommended; other OS builds are best-effort |

### Setup

```powershell
git clone https://github.com/iLevyTate/elstratosort.git
cd elstratosort
npm ci
npm run dev
```

## Where to Learn the Codebase

| Document                                       | Purpose                       |
| ---------------------------------------------- | ----------------------------- |
| [Learning Guide](docs/LEARNING_GUIDE.md)       | Onboarding and glossary       |
| [Architecture](docs/ARCHITECTURE.md)           | System design and data flow   |
| [DI Patterns](docs/DI_PATTERNS.md)             | Dependency injection patterns |
| [Error Handling](docs/ERROR_HANDLING_GUIDE.md) | Error handling standards      |
| [Code Quality](docs/CODE_QUALITY_STANDARDS.md) | Style and review expectations |

## Development Workflow

1. Create a feature branch from the current default branch.
2. Make focused changes that keep scope tight and tests relevant.
3. Run tests and linting (see below).
4. Open a PR with a clear description and test results.

## Testing

### Automated

```powershell
npm run lint
npm test
```

See `TESTING.md` for test patterns, goals, and manual verification checklists.

## Pull Request Checklist

- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] Manual testing done when changes affect user flows
- [ ] Docs updated for new behavior or configuration
- [ ] PR description includes what changed and why

## Reporting Issues

Please use [GitHub Issues](https://github.com/iLevyTate/elstratosort/issues) with:

- Clear reproduction steps
- Expected vs actual behavior
- Relevant logs (found in `%APPDATA%/El StratoSort/logs/` on Windows)
- System information (OS, Node version)

---

<p align="center">
  Thank you for helping make El StratoSort better!
</p>
