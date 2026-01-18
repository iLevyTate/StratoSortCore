# Contributing to El StratoSort

Thanks for your interest in contributing. This guide covers how to set up the repo, make changes,
and submit a high-quality pull request.

## Code of Conduct

Be respectful, constructive, and kind. If you are unsure about behavior, default to being helpful.

## Getting Started

### Prerequisites

- Node.js (see `.nvmrc`)
- npm
- Windows 10/11 recommended (other OS builds are best-effort)

### Setup

```powershell
git clone https://github.com/iLevyTate/elstratosort.git
cd elstratosort
npm ci
npm run dev
```

## Where to Learn the Codebase

- `docs/LEARNING_GUIDE.md` for onboarding and glossary
- `docs/ARCHITECTURE.md` for system design and data flow
- `docs/DI_PATTERNS.md` for dependency injection patterns
- `docs/ERROR_HANDLING_GUIDE.md` for error handling standards
- `docs/CODE_QUALITY_STANDARDS.md` for style and review expectations

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

See `docs/TESTING_STRATEGY.md` for test patterns and goals.

### Manual

Use the regression test plan in `REGRESSION_TEST_PLAN.md`.

If you are new to manual testing, start with:

- `docs/CONTRIBUTING_TESTING_BEGINNER.md`
- `docs/CONTRIBUTING_TESTING_ADVANCED.md`

## Pull Request Checklist

- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] Manual testing done when changes affect user flows
- [ ] Docs updated for new behavior or configuration
- [ ] PR description includes what changed and why

## Reporting Issues

Please use GitHub Issues with clear repro steps, expected vs actual behavior, and logs if available.
