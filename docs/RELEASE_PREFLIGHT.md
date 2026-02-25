# StratoSort Release Preflight

Run this before creating a beta/release tag.

## Quick check (fast)

Use this to quickly catch native runtime breakage:

```bash
npm run preflight:release:quick
```

This verifies Electron-runtime loading for:

- `sharp`
- `better-sqlite3`
- `@napi-rs/canvas`
- `lz4-napi`
- `node-llama-cpp`

## Full check (recommended before tag)

Use this before every beta/release tag:

```bash
npm run preflight:release
```

On the current platform this runs:

1. Native module verification (`verify:native-modules`)
2. Clean `release/build`
3. Platform dist build (for example, `dist:win` on Windows)
4. Packaged artifact verification (`verify-packaged-artifacts`)

## Wizard regression checks

Run these to ensure first-install/model wizard flow did not regress:

```bash
npx jest --config test/jest.config.js test/components/WelcomePhase.test.js test/components/ModelSetupWizard.test.js
npx jest --config test/jest.config.js test/components/PhaseRenderer.test.js test/phaseTransitions.test.js
```

## Pass criteria

Do not tag until all of the following are true:

- Preflight command exits with code `0`
- Wizard/phase regression suites pass
- Dist artifacts are generated under `release/build`
- No unexpected warnings/errors in command output

## CI workflows that enforce these checks

- `/.github/workflows/release.yml` (Windows release)
- `/.github/workflows/mac-release.yml` (macOS release)
- `/.github/workflows/manual-dist.yml` (manual dist builds)

## Notes for unsigned mode

If signing/notarization secrets are not set:

- Windows and mac builds still produce unsigned artifacts
- Tag-triggered workflows still publish a normal GitHub release
- Security prompts are expected (SmartScreen/Gatekeeper)
- Native and packaged integrity checks still run
