# StratoSort Windows Installer Theming

This folder contains branding assets for the NSIS installer wizard on Windows.

## Image Assets

| File | Dimensions | Purpose |
|------|-----------|---------|
| `welcome.png` | 164x314 px | Left sidebar on Welcome/Finish pages |
| `finish.png` | 164x314 px | Left sidebar on Uninstall pages |
| `header.png` | 150x57 px | Header banner on all pages |
| `dmg-background.png` | 660x400 px | macOS DMG background (not NSIS) |

## Configuration

The NSIS installer is configured via:

1. **electron-builder.json** - Main build configuration
   - `nsis.include` points to `build/installer-themed.nsh`
   - Icons, shortcuts, and installation options

2. **build/installer-themed.nsh** - NSIS customization script
   - Welcome/Finish page text
   - Image references
   - Custom install/uninstall hooks
   - Abort warning dialogs

## Features

The installer includes:
- Custom branded images on all pages
- Welcome page with app description
- Directory selection with custom text
- Finish page with "Launch now" checkbox
- Start Menu shortcuts (StratoSort folder)
- Desktop shortcut (optional)
- First-run marker file for AI setup prompt
- Clean uninstall with optional app data removal

## Building

```bash
npm run setup:runtime
npm run dist:win
```

The installer will be output to `release/build/StratoSort-Setup-{version}.exe`

## Notes

- Keep file names exactly as listed
- Files live under `assets/installer/` because `electron-builder.json` sets `buildResources` to `assets`
- PNG images are automatically converted to BMP format by electron-builder
- The `BUILD_RESOURCES_DIR` variable in NSH files points to the `assets` folder


