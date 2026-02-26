# GitHub Actions Configuration

## Overview

This repository is configured with automated dependency updates and release builds.

## Workflows

### 1. Dependabot Configuration (`.github/dependabot.yml`)

- **Automatically creates PRs** for dependency updates daily
- Groups minor and patch updates together
- Labels PRs with `dependencies` and `automerge`

### 2. Dependabot Auto-merge (`.github/workflows/dependabot-automerge.yml`)

- **Automatically merges** safe dependency updates
- Enables auto-merge for all Dependabot PRs
- Immediately merges patch and minor updates if checks pass
- Major updates wait for manual review

**Optional Setup**: If your repository has branch protection requiring PR approval:

1. Create a Personal Access Token (PAT) with `repo` scope
2. Add it as a repository secret named `DEPENDABOT_PAT`
3. Uncomment the auto-approve step in the workflow

### 3. CI (`.github/workflows/ci.yml`)

- **lint-and-format**: format:check, lint
- **test**: Jest with coverage (matrix: Windows, Ubuntu, macOS), enforces 50% thresholds
- **build**: Production build (Windows)
- **ipc-contract-check**: generate:channels:check, verify:ipc-handlers
- **e2e**: Playwright E2E tests (Ubuntu)
- Triggered on pushes and PRs to main/master/develop

### 4. Windows Release Builds (`.github/workflows/release.yml`)

#### Automatic Releases

- **Triggers on version tags** (e.g., `v1.0.0`, `v2.1.3`)
- **Quality gates first**: format:check, lint, test:coverage, verify:ipc-handlers, build (must pass
  before packaging)
- Builds Windows installer
- Publishes to GitHub Releases with `checksums-windows.sha256`

To create a release:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

#### Manual Builds

- Go to Actions → "Windows Dist (Manual)" → Run workflow
- Artifacts and `checksums-windows.sha256` are uploaded to the workflow run

## Build Outputs

### Windows

- **NSIS Installer**: `StratoSortCore-Setup-<version>.exe`
- **Portable**: `StratoSortCore-<version>-win-x64.exe`
- **Checksums**: `checksums-windows.sha256`
- **Updater metadata**: `latest.yml`, `*.blockmap`

### macOS (manual only)

- **DMG**: `StratoSortCore-<version>-mac-arm64.dmg`
- **ZIP**: `StratoSortCore-<version>-mac-arm64.zip`
- **Checksums**: `checksums-macos.sha256`

### Linux (manual only)

- **AppImage**: `StratoSortCore-<version>-linux-x64.AppImage`
- **DEB**: `StratoSortCore-<version>-linux-x64.deb`

## Configuration Files

### `electron-builder.json`

- Configures build outputs and installer settings
- Publishing is handled by GitHub Actions; build commands use `--publish never`
- Artifact naming follows `electron-builder.json` conventions for each target.

## Next Release References

Before cutting the next tag, confirm these docs stay aligned:

1. `README.md` version badge and release links
2. `CHANGELOG.md` new version section + `[Unreleased]` compare base
3. `docs/RELEASING.md` checklist and artifact naming

## Required Secrets

### Built-in (no setup needed)

- `GITHUB_TOKEN`: Automatically provided by GitHub Actions

### Optional

- `DEPENDABOT_PAT`: Personal Access Token for auto-approving PRs (only if branch protection requires
  reviews)
- `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`: Enable Authenticode signing for Windows release
  artifacts
- `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`: Enable macOS signing + notarization

When signing/notarization secrets are not configured, release workflows still publish normal GitHub
releases with unsigned binaries. SmartScreen/Gatekeeper warnings are expected in that mode.

## Testing Locally

### Build Windows installer:

```bash
npm run dist:win
```

### Build without packaging (faster):

```bash
npx electron-builder --win --dir
```

Output location: `release/build/`

## Troubleshooting

### Dependabot PRs not auto-merging

1. Check if branch protection requires reviews
2. If yes, add `DEPENDABOT_PAT` secret
3. Ensure required status checks are passing

### Release not publishing

1. Ensure tag follows format `v*.*.*`
2. Check Actions tab for build errors
3. Verify `GITHUB_TOKEN` is available (automatic in Actions)

### Build errors

1. Run `npm ci` to ensure clean dependencies
2. Run `npm run build` before electron-builder
3. Check `release/build/` for partial outputs
