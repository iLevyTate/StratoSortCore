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
| **Linux**      | 64-bit distribution (Ubuntu 20.04+, Fedora 38+, etc.)     |
| **RAM**        | 8 GB minimum, 16 GB recommended                           |
| **Disk space** | ~500 MB for the app + ~2-5 GB for AI models               |
| **Internet**   | Needed once to download AI models; app runs offline after |

---

## Step 1: Download the Right File

Go to **[StratoSort Core Releases](https://github.com/iLevyTate/StratoSortCore/releases)** and
download **one file** for your system. Pick the installer version — it includes **automatic
updates** so you always have the latest features and fixes without re-downloading.

### Windows

> **Download: `StratoSortCore-Setup-X.X.X.exe`** (recommended)

This is the full installer with automatic updates built in. It creates a Start Menu shortcut, a
desktop shortcut, and keeps itself up to date in the background.

| File                                 | What it is                         | Auto-updates?                                        |
| :----------------------------------- | :--------------------------------- | :--------------------------------------------------- |
| **`StratoSortCore-Setup-X.X.X.exe`** | **Full installer**                 | **Yes** — updates download and install automatically |
| `StratoSortCore-X.X.X-win-x64.exe`   | Portable (runs without installing) | No — you must re-download each new version manually  |

Only use the portable version if you specifically cannot install software on your machine (e.g.
restricted work computer). The portable version does not auto-update.

### macOS — Which file do I need?

macOS has two versions because Apple makes two types of processors. **You need to pick the one that
matches your Mac.**

**How to check which Mac you have:**

1. Click the **Apple menu** (top-left corner) and select **About This Mac**.
2. Look for the **Chip** or **Processor** line:
   - If it says **Apple M1, M2, M3, M4** (or any "M" chip) — you have **Apple Silicon**.
   - If it says **Intel** — you have an **Intel Mac**.

| Your Mac                                     | Download this file                       | Auto-updates? |
| :------------------------------------------- | :--------------------------------------- | :------------ |
| **Apple Silicon** (M1, M2, M3, M4, or newer) | **`StratoSortCore-X.X.X-mac-arm64.dmg`** | **Yes**       |
| **Intel** (any Intel processor)              | **`StratoSortCore-X.X.X-mac-x64.dmg`**   | **Yes**       |

Both are full installers with automatic updates. Just pick the one that matches your chip.

> **What happens if I pick the wrong one?** The app may not open, or macOS will show an error. Just
> delete it and download the correct version — no harm done.

### Linux

> **Download: `StratoSortCore-X.X.X-linux-x64.AppImage`** (recommended)

The AppImage is a single file that runs on virtually any 64-bit Linux distribution. It includes
automatic updates.

| File                                          | What it is               | Auto-updates?                                        |
| :-------------------------------------------- | :----------------------- | :--------------------------------------------------- |
| **`StratoSortCore-X.X.X-linux-x64.AppImage`** | **AppImage (universal)** | **Yes** — updates download and install automatically |
| `StratoSortCore-X.X.X-linux-x64.deb`          | Debian/Ubuntu package    | No — you must re-download each new version manually  |

Only use the `.deb` if you specifically prefer managing packages with `apt`/`dpkg`. The `.deb` does
not auto-update.

### Quick reference — which file to download

| Your computer                            | Download this one file                    |
| :--------------------------------------- | :---------------------------------------- |
| **Windows PC** (any 64-bit)              | `StratoSortCore-Setup-X.X.X.exe`          |
| **Mac with Apple Silicon** (M1/M2/M3/M4) | `StratoSortCore-X.X.X-mac-arm64.dmg`      |
| **Mac with Intel chip**                  | `StratoSortCore-X.X.X-mac-x64.dmg`        |
| **Linux** (any 64-bit distro)            | `StratoSortCore-X.X.X-linux-x64.AppImage` |

All four of these are full installers with automatic updates included.

---

## Optional: Verify Download Integrity

You can verify that the file you downloaded wasn't corrupted or tampered with. This is optional.

Download the matching checksum file from the same Releases page:

- **Windows:** `checksums-windows.sha256`
- **macOS:** `checksums-macos.sha256`
- **Linux:** `checksums-linux.sha256`

Then run the appropriate command:

### Windows (PowerShell)

```powershell
Get-FileHash .\StratoSortCore-Setup-X.X.X.exe -Algorithm SHA256
```

### macOS (Terminal)

```bash
shasum -a 256 StratoSortCore-X.X.X-mac-arm64.dmg
```

### Linux (Terminal)

```bash
sha256sum StratoSortCore-X.X.X-linux-x64.AppImage
```

Compare the hash output to the matching entry in the checksum file. They should match exactly.

---

## Step 2: Install and Run

### Windows

1. Double-click **`StratoSortCore-Setup-X.X.X.exe`**.
2. **If Windows SmartScreen shows "Windows protected your PC":**
   - Click **"More info"**
   - Click **"Run anyway"**
3. Follow the installer prompts (choose install location, shortcuts, etc.).
4. Launch **StratoSort Core** from the Start menu or desktop shortcut.

> **Why this can happen:** During beta, Windows builds may be unsigned and SmartScreen may warn
> before launch. Verify the download checksum and continue only if it matches the release notes.

### macOS

1. Double-click the downloaded **`.dmg`** file.
2. Drag **StratoSort Core** into the **Applications** folder.
3. Eject the DMG (right-click it in Finder sidebar and select Eject).
4. Open **StratoSort Core** from Applications.
5. **If macOS says "StratoSort Core cannot be opened because the developer cannot be verified":**
   - **Option A (easiest):** Right-click the app in Applications, click **Open**, then click
     **Open** again in the dialog.
   - **Option B:** Open **System Settings** → **Privacy & Security** → scroll down → click **Open
     Anyway** next to StratoSort Core.

> **Why this can happen:** During beta, macOS builds may be unsigned or unnotarized. Gatekeeper can
> also block incomplete/corrupted downloads or wrong-architecture builds. Verify checksums and use
> the correct Intel vs Apple Silicon artifact.

### Linux (AppImage)

1. Make the AppImage executable:

```bash
chmod +x StratoSortCore-X.X.X-linux-x64.AppImage
```

2. Double-click to run, or launch from a terminal:

```bash
./StratoSortCore-X.X.X-linux-x64.AppImage
```

### Linux (Debian package)

1. Install:

```bash
sudo dpkg -i StratoSortCore-X.X.X-linux-x64.deb
```

2. Launch **StratoSort Core** from your application menu.
3. **Important:** The `.deb` version does not auto-update. To get a new version, download and
   install the latest `.deb` from [Releases](https://github.com/iLevyTate/StratoSortCore/releases).

---

## Step 3: First Launch — AI Model Setup

When you open StratoSort for the first time, it will ask you to download AI models. **This is a
one-time download.** After this, the app runs completely offline.

1. The **AI Model Setup** wizard appears automatically.
2. Choose a model profile:

| Profile                     | Best for                                                     | Download size | What you get                                |
| :-------------------------- | :----------------------------------------------------------- | :------------ | :------------------------------------------ |
| **Base (Small & Fast)**     | All computers, including older machines and CPU-only systems | ~2 GB         | Smaller, faster models that work everywhere |
| **Better Quality (Larger)** | Modern hardware with 16 GB+ RAM and a dedicated GPU          | ~5 GB         | Larger models with higher quality analysis  |

3. Click **Download Models** and wait for the progress bars to complete.
4. When all models finish, click **Get Started**.

**What gets downloaded?** Three AI model files for text analysis, image understanding, and semantic
search (GGUF format). They are stored locally on your computer and never sent anywhere.

**Can I change this later?** Yes. Go to **Settings** → **AI Configuration** → **Default AI Models**
to switch profiles or download additional models at any time.

**Can I keep using the app while models download?** Yes. Click **Continue with limited AI** if you
want to explore the app immediately. AI features will become available once the download finishes.

---

## How Automatic Updates Work

If you installed using the recommended installer (Setup `.exe`, `.dmg`, or `.AppImage`), the app
checks for updates automatically:

1. When you launch the app, it checks GitHub Releases for a newer version in the background.
2. If an update is available, it downloads silently.
3. The update installs the next time you restart the app.
4. You don't need to do anything — it just works.

> **Note:** Automatic updates only work with the installer versions. If you chose the portable
> `.exe` or `.deb` package, you must check
> [Releases](https://github.com/iLevyTate/StratoSortCore/releases) periodically and download new
> versions manually.

---

## Summary

| Step          | What you do                                                                      |
| :------------ | :------------------------------------------------------------------------------- |
| **Download**  | One file from GitHub Releases (pick the installer for your OS — see table above) |
| **Install**   | Run the installer; allow it if your OS shows a security warning                  |
| **First run** | Choose a model profile and download AI models (~2-5 GB, one time)                |
| **Updates**   | Automatic — the app handles it in the background                                 |
| **Done**      | Use StratoSort; everything runs locally on your machine                          |

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

### macOS: "StratoSort Core is damaged and can't be opened"

This can happen if the quarantine attribute wasn't cleared. Run this in Terminal:

```bash
xattr -cr /Applications/StratoSort\ Core.app
```

Then try opening the app again.

### Models failed to download

- Check your internet connection.
- Try again from **Settings** → **AI Configuration** → **Model Management** → **Download Models**.
- Ensure you have at least 5 GB of free disk space.
- If downloads keep failing, check if a firewall or VPN is blocking connections to `huggingface.co`.

### Vision / image analysis not working

- Open **Settings** → **AI Configuration** and check that the vision model shows as downloaded.
- If the vision model is missing, download it from the model management section.

### App feels slow or unresponsive

- The "Base (Small & Fast)" model profile uses less RAM and runs faster on older hardware.
- Close other memory-heavy applications while using StratoSort.
- If you have a dedicated GPU (NVIDIA, AMD, or Apple Silicon), StratoSort will use it automatically.

---

## Where does StratoSort store data?

| Data             | Location                                                                                                                    |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **App settings** | Your OS app data folder (automatic)                                                                                         |
| **AI models**    | Inside the app data folder under `models/` (~2-5 GB)                                                                        |
| **Your files**   | StratoSort never copies your files. It reads them in place and only moves them when you approve an organization suggestion. |

StratoSort never sends data over the internet after the initial model download.

---

## Security

StratoSort Core:

- Runs 100% locally after model download
- Does not collect or send any data
- Is open source: you can inspect the code at
  [github.com/iLevyTate/StratoSortCore](https://github.com/iLevyTate/StratoSortCore)

If you see "developer cannot be verified" / SmartScreen warnings during beta, first verify checksums
from the release page and ensure you downloaded the correct OS/architecture artifact before
proceeding.

---

## Next Steps

- **Learn the app:** [User Guide](./USER_GUIDE.md)
- **Help test and report bugs:** [Beta Tester Guide](./BETA_TESTER_GUIDE.md)
