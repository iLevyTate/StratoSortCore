# Releasing StratoSort Core

This guide covers release packaging for both Windows and macOS, plus how GitHub Actions publishes
artifacts.

## Release Checklist

1. **Update release metadata**
   - Bump `version` in `package.json`
   - Move release notes from `CHANGELOG.md` **[Unreleased]** to the new version section
2. **Run quality gates**
   - `npm run ci`
3. **Smoke-test installers**
   - Windows: run `npm run dist:win`, install `StratoSortCore-Setup-*.exe`
   - macOS: run `npm run dist:mac`, open `StratoSortCore-*.dmg`
4. **Verify first-run experience**
   - AI setup confirms bundled OCR runtime availability
   - Base-model download works from the app UI
5. **Confirm docs**
   - Ensure `docs/INSTALL_GUIDE.md` matches current installer names and OS prompts
   - Ensure release references are updated for the upcoming tag:
     - `README.md` version badge
     - `CHANGELOG.md` compare links (`[Unreleased]` and new version anchor)
     - `.github/WORKFLOW_README.md` artifact names/checksum filenames

## Tag-Triggered Releases (Recommended)

Push a semver tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

For the next release, replace `X.Y.Z` with the version from `package.json` after you bump it.

This triggers both workflows:

- `release.yml` (Windows)
- `mac-release.yml` (macOS)

Each workflow runs quality gates (format, lint, test:coverage, verify:ipc-handlers, build) before
packaging. Both upload artifacts to the GitHub release for the tag.

## Published Artifacts

Windows workflow publishes:

- `StratoSortCore-Setup-*.exe`
- `StratoSortCore-*-win-*.exe` (portable)
- `latest.yml`
- `*.blockmap`
- `checksums-windows.sha256`

macOS workflow publishes:

- `StratoSortCore-*.dmg`
- `StratoSortCore-*.zip`
- `latest*.yml` (for updater metadata)
- `checksums-macos.sha256`

## Releasing Without Code Signing Certificates

If signing/notarization secrets are not configured, tag-triggered workflows still publish a normal
GitHub release (not a prerelease) with unsigned artifacts.

- Windows: installer and portable EXE are unsigned (SmartScreen warnings are expected).
- macOS: DMG/ZIP are unsigned and not notarized (Gatekeeper warnings are expected).
- Integrity verification still runs in CI:
  - `verify-packaged-artifacts`
  - `verify-updater-metadata`
  - SHA256 checksum generation (`checksums-windows.sha256`, `checksums-macos.sha256`)

Recommended operator practice when releasing unsigned artifacts:

1. Ensure `checksums-*.sha256` files are uploaded with each release.
2. Add a short note in release notes that binaries are unsigned for this release.
3. Verify install flows manually on clean Windows/macOS test machines.

## Manual Dist Workflow

Use `.github/workflows/manual-dist.yml` (`workflow_dispatch`) when you need:

- Windows-only or macOS-only rebuilds
- A draft release with combined artifacts
- Ad-hoc release testing without tagging

## Local Dist Commands

```powershell
npm ci
npm run dist:win
npm run dist:mac
```

All artifacts are written to `release/build/`.

## Local Checksum Commands

Windows checksum file:

```powershell
Get-ChildItem release/build -File |
  Where-Object { $_.Name -match '^StratoSortCore-.*\.(exe|blockmap)$|^latest\.yml$' } |
  ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    "$hash *$($_.Name)"
  } | Out-File release/build/checksums-windows.sha256 -Encoding ASCII
```

macOS checksum file:

```bash
cd release/build
shasum -a 256 StratoSortCore-*.dmg StratoSortCore-*.zip > checksums-macos.sha256
```

## Notes on AI Packaging

- The AI stack (node-llama-cpp + Orama) runs in-process.
- AI models are **not** bundled in installers; users download them in-app.
- OCR runtime support is bundled/fallback-ready via packaged runtime assets.
