# StratoSort Core — Install Guide

**One download. No command line. No extra software.**

This guide is for people who download the installer from
[Releases](https://github.com/iLevyTate/StratoSortCore/releases). If you're a developer building
from source, see [GETTING_STARTED.md](GETTING_STARTED.md).

---

## Before You Start

| Requirement    | Details                                                   |
| :------------- | :-------------------------------------------------------- |
| **Windows**    | Windows 10 or 11 (64-bit)                                 |
| **macOS**      | macOS 10.15 or later (Intel or Apple Silicon)             |
| **RAM**        | 8GB minimum, 16GB recommended                             |
| **Disk space** | ~5GB for AI models (downloaded on first run)              |
| **Internet**   | Needed once to download AI models; app runs offline after |

---

## Step 1: Download

1. Go to [StratoSort Core Releases](https://github.com/iLevyTate/StratoSortCore/releases)
2. Download the installer for your system:
   - **Windows:** `StratoSortCore-Setup-X.X.X.exe` or `StratoSortCore-X.X.X-win-x64.exe`
   - **macOS:** `StratoSortCore-X.X.X-mac-arm64.dmg` (Apple Silicon) or
     `StratoSortCore-X.X.X-mac-x64.dmg` (Intel)
3. (Optional but recommended) Download the checksum file for your platform:
   - **Windows:** `checksums-windows.sha256`
   - **macOS:** `checksums-macos.sha256`

---

## Optional: Verify Download Integrity

### Windows (PowerShell)

```powershell
Get-FileHash .\StratoSortCore-Setup-X.X.X.exe -Algorithm SHA256
```

Compare the hash output to the matching entry in `checksums-windows.sha256`.

### macOS (Terminal)

```bash
shasum -a 256 StratoSortCore-X.X.X-mac-arm64.dmg
```

Compare the hash output to the matching entry in `checksums-macos.sha256`.

---

## Step 2: Run the Installer

### Windows

1. Double-click the downloaded file.
2. If Windows SmartScreen shows **"Windows protected your PC"**:
   - Click **"More info"**
   - Click **"Run anyway"**
3. Follow the installer (choose install location, shortcuts, etc.).
4. Launch StratoSort Core from the Start menu or desktop shortcut.

> **Why this warning?** The app is not code-signed yet. SmartScreen flags unsigned apps. You can
> review the [source code](https://github.com/iLevyTate/StratoSortCore) to verify it before running.

### macOS

1. Double-click the downloaded DMG.
2. Drag **StratoSort Core** to Applications.
3. Eject the DMG and open StratoSort Core from Applications.
4. If you see **"StratoSort Core cannot be opened because the developer cannot be verified"**:
   - **Option A:** Right-click the app → **Open** → **Open** in the dialog.
   - **Option B:** Open **System Settings** → **Privacy & Security** → scroll down → click **Open
     Anyway** next to StratoSort Core.

> **Why this warning?** The app is not notarized by Apple yet. Gatekeeper blocks unsigned apps by
> default. You can review the [source code](https://github.com/iLevyTate/StratoSortCore) before
> running.

---

## Step 3: First Launch — Download AI Models

On first launch, StratoSort will ask you to download AI models. **This is the only download you
approve in the app.**

1. When the setup wizard appears, click **"Download Base Models"** or **"Download recommended
   models"**.
2. Wait for the models to download (~3–5GB). Progress is shown in the app.
3. When complete, you can start using StratoSort.

**What gets downloaded?** Text (Qwen2.5 7B), vision (LLaVA 1.6 Mistral), and embedding (Nomic)
models in GGUF format (~5GB total). They are stored locally and never sent anywhere. The vision
runtime is already bundled—no extra download for that.

---

## Summary

| Step          | What you do                                 |
| :------------ | :------------------------------------------ |
| **Download**  | One installer file from GitHub Releases     |
| **Install**   | Run it; allow it if your OS shows a warning |
| **First run** | Approve model download in the app           |
| **Done**      | Use StratoSort; everything runs locally     |

**No terminal. No Python. No Docker. No API keys.**

---

## Troubleshooting

### Windows: "This app has been blocked for your protection"

- Click **More info** → **Run anyway**.
- If you don't see "Run anyway", your organization may have blocked unsigned apps. You would need to
  install on a personal device or ask your IT admin.

### macOS: App won't open even after Right-click → Open

- Go to **System Settings** → **Privacy & Security**.
- Scroll to the **Security** section.
- Look for a message about StratoSort Core being blocked and click **Open Anyway**.

### Models failed to download

- Check your internet connection.
- Try again from **Settings** → **Model management** → **Download Base Models**.
- Ensure you have ~5GB free disk space.

### Vision / image analysis not working

- The vision runtime is bundled. If it still fails, check **Settings** → **Llama** for GPU or model
  status.
- Ensure the vision model was downloaded (part of the base models).

---

## Security

StratoSort Core:

- Runs 100% locally after model download
- Does not collect or send any data
- Is open source: you can inspect the code at
  [github.com/iLevyTate/StratoSortCore](https://github.com/iLevyTate/StratoSortCore)

The "developer cannot be verified" / SmartScreen warnings appear because the app is not yet signed
with a publisher certificate. That affects trust prompts only—not how the app works.

---

## Next Steps

- **Learn the app:** [User Guide](./USER_GUIDE.md)
- **Help test and report bugs:** [Beta Tester Guide](./BETA_TESTER_GUIDE.md)
