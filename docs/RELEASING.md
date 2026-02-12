# Releasing StratoSort Core

This guide documents the release process and best practices for Windows builds. It is designed to
ensure releases are reproducible, include bundled runtimes, and publish checksums + clear notes.

## Release Checklist (Windows)

1. **Update versions**
   - Bump `version` in `package.json`
   - Update `CHANGELOG.md` under **[Unreleased]**
2. **Build & smoke test**
   - `npm run dist:win`
   - Install the generated `StratoSortCore-Setup-*.exe`

- Confirm AI Model Setup wizard shows **Bundled** for OCR runtime
- Confirm “Download Base Models” works (models are not bundled)

5. **Generate checksums**
   - The workflow generates `checksums.sha256` automatically
   - If building locally, generate with:
     ```powershell
     Get-ChildItem release/build -File |
       Where-Object { $_.Name -match 'StratoSortCore-.*|latest\\.yml|\\.blockmap' } |
       ForEach-Object {
         $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
         "$hash *$($_.Name)"
       } | Out-File release/build/checksums.sha256 -Encoding ASCII
     ```
6. **Release notes**
   - Summarize major changes
   - Explicitly note: bundled runtimes are included; models download after install
   - Link to `CHANGELOG.md` for full detail
   - The release workflow pulls the matching `CHANGELOG.md` section into the release body

## Tag-Triggered Releases (Recommended)

1. Create the tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
2. The **Release** workflow will:
   - Build the Windows installer
   - Publish artifacts + `checksums.sha256`

## Publishing Notes

- Release publishing is handled by GitHub Actions workflows.
- Local builds use `--publish never` and do not upload artifacts.
- `electron-builder.json` publish metadata is used for update metadata, not for CI publishing.

## Manual Windows Build (Local)

```powershell
npm ci
npm run dist:win
```

Artifacts are under `release/build/`:

- `StratoSortCore-Setup-*.exe`
- `StratoSortCore-*-win-*.exe` (portable)
- `latest.yml`
- `*.blockmap`
- `checksums.sha256`

## Notes on AI Stack

- The AI stack (node-llama-cpp, Orama) runs fully in-process. No external runtimes are bundled.
- Models are **not** bundled. The app provides a one-click model download in the Settings panel.
- Tesseract OCR auto-installs or falls back to bundled `tesseract.js`.
