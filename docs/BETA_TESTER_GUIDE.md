# StratoSort Core Beta Tester Guide

This guide is for people who want to help test StratoSort Core without using the command line.

If you can install an app, use it for normal work, and share clear bug reports, you can contribute.

---

## Quick Links

- **Download:** [Latest release installers](https://github.com/iLevyTate/StratoSortCore/releases)
- **Install help:** [INSTALL_GUIDE.md](./INSTALL_GUIDE.md)
- **Bug reports:**
  [Open a bug report](https://github.com/iLevyTate/StratoSortCore/issues/new?template=bug_report.md)
- **General issues:** [Issues board](https://github.com/iLevyTate/StratoSortCore/issues)

---

## Who This Guide Is For

- You want to help improve StratoSort Core.
- You prefer installers over building from source.
- You can spend a little time reproducing issues and reporting them clearly.

---

## Part 1: Install

Use the full install walkthrough here: [INSTALL_GUIDE.md](./INSTALL_GUIDE.md). The short version is
below.

### Step 1 — Download the right file

Go to **[Releases](https://github.com/iLevyTate/StratoSortCore/releases)** and download **one file**
for your system. Always pick the **installer** version — it includes automatic updates so you always
test the latest build.

| Your computer                                  | Download this file                            |
| :--------------------------------------------- | :-------------------------------------------- |
| **Windows PC** (any 64-bit)                    | **`StratoSortCore-Setup-X.X.X.exe`**          |
| **Mac with Apple Silicon** (M1 / M2 / M3 / M4) | **`StratoSortCore-X.X.X-mac-arm64.dmg`**      |
| **Mac with Intel chip**                        | **`StratoSortCore-X.X.X-mac-x64.dmg`**        |
| **Linux** (any 64-bit distro)                  | **`StratoSortCore-X.X.X-linux-x64.AppImage`** |

> **Not sure which Mac you have?** Click the **Apple menu** (top-left) → **About This Mac**. If it
> says **M1, M2, M3, M4** (or any "M" chip), download the `arm64` version. If it says **Intel**,
> download the `x64` version.

> **Why the installer and not the portable/deb?** The installer versions include automatic updates.
> As a beta tester you want the latest fixes delivered automatically — no need to manually
> re-download after every release.

### Step 2 — Install and run

**Windows:**

1. Double-click `StratoSortCore-Setup-X.X.X.exe`.
2. If SmartScreen appears, click **More info** → **Run anyway**.
3. Follow the installer and launch from the Start menu or desktop shortcut.

**macOS:**

1. Double-click the `.dmg` and drag **StratoSort Core** into Applications.
2. Open the app. If macOS blocks it: right-click the app → **Open** → **Open** in the dialog.

**Linux:**

1. Make executable: `chmod +x StratoSortCore-*.AppImage`
2. Double-click to run, or launch from a terminal.

### Step 3 — First launch model setup

1. The **AI Model Setup** wizard appears on first launch.
2. Choose a profile:
   - **Base (Small & Fast)** — works on all hardware, ~2 GB download.
   - **Better Quality (Larger)** — better results on 16 GB+ RAM with GPU, ~5 GB download.
3. Wait for models to download. Progress is shown in the app.
4. Click **Get Started** when complete.

Models are stored locally and never sent anywhere. You can change profiles later in **Settings** →
**AI Configuration**.

---

## Part 2: Run a Useful Beta Test Session

Use this checklist to create high-value feedback. Look for anything unexpected — wrong suggestions,
confusing UI, slow performance, or outright errors.

1. **Setup phase**
   - Add at least 3-5 Smart Folders with clear descriptions.
   - Look for: Does the UI make it obvious how to add/edit/remove folders?
2. **Discover phase**
   - Analyze a mixed batch (documents, images, screenshots, PDFs).
   - Look for: Do analysis results make sense? Are categories accurate? How long does it take?
3. **Organize phase**
   - Accept some suggestions, reject others, test rename options.
   - Look for: Are suggested destinations correct? Do renames follow your naming rules?
4. **Search / Knowledge OS**
   - Try natural-language queries in search (Ctrl+K / Cmd+K on macOS).
   - Open the Knowledge Graph view and inspect relationships.
   - Look for: Are results relevant? Does the graph show meaningful connections?
5. **Settings**
   - Walk through each section:
     - **AI Configuration** — model status, model selection, embedding rebuild
     - **Performance** — auto-organize toggle, background mode
     - **Default Locations** — naming conventions, default paths
     - **Application** — log export, settings backup/restore
   - Look for: Do all toggles work? Are labels clear? Anything confusing?
6. **Undo/Redo**
   - Organize a few files, then undo. Re-do. Undo again.
   - Look for: Do files actually move back? Is the history accurate?

**Tip:** Real-world folders (Downloads, screenshots, invoices, project docs) produce better test
results than synthetic files.

---

## Part 3: How To Report Bugs So They Are Actionable

Submit reports with this template:
[Bug report form](https://github.com/iLevyTate/StratoSortCore/issues/new?template=bug_report.md)

### Include these every time

- **Clear title:** what broke, where.
- **Reproduction steps:** exact step-by-step path.
- **Expected behavior:** what should happen.
- **Actual behavior:** what happened instead.
- **Environment details:**
  - OS + version (e.g. Windows 11 23H2, macOS 15.2 Sequoia, Ubuntu 24.04)
  - App version (shown in **Settings** → **About** or the title bar)
  - Install type: installer or portable
  - Hardware notes (RAM / GPU) if the issue is performance or AI related

### Attach useful evidence

- Screenshot or short screen recording.
- **Logs** (see below).
- Any visible error text (copy the exact message).

### How to get logs

Open **Settings** → **Application** → **Troubleshooting Logs**:

| Option          | When to use                                                               |
| :-------------- | :------------------------------------------------------------------------ |
| **Open Folder** | Browse log files directly on disk. Useful for picking specific log files. |
| **Export Logs** | Creates a shareable log file for bug reports. Attach to GitHub issue.     |

**Steps:**

1. Open **Settings** → **Application**.
2. Under **Troubleshooting Logs**, click **Export Logs**.
3. Save the file (e.g. to Desktop).
4. When filing a bug report, drag the file into the GitHub issue or use **Attach files**.
5. Add a note like: _"Logs attached. Error occurred when [brief context]."_

**Manual log locations** (if you prefer copying files yourself):

- **Windows:** `%APPDATA%\StratoSort Core\logs\`
- **macOS:** `~/Library/Application Support/StratoSort Core/logs/`
- **Linux:** `~/.config/StratoSort Core/logs/`

### High-quality bug report example

> **Title:** Knowledge OS search returns zero results after embedding model switch **Steps:**
>
> 1. Open Settings → AI Configuration → Default AI models
> 2. Change Embedding Model
> 3. Return to search and query "invoice from last month" **Expected:** Existing indexed files still
>    appear, or app prompts to rebuild before search **Actual:** Empty results + warning about model
>    mismatch **Environment:** Windows 11, app 2.0.1 installer, RTX 3060, 32 GB RAM **Logs:**
>    attached export (Settings → Export Logs)

---

## Part 4: Other Ways To Contribute (No Coding Required)

- Confirm bugs reported by others (same issue, same version, same/different OS).
- Test a new release and report regressions.
- Suggest UX improvements with screenshots and concrete before/after notes.
- Improve docs when something feels unclear.

---

## Part 5: If You Do Want To Contribute Code Later

Start here: [CONTRIBUTING.md](../CONTRIBUTING.md)

You can help as a tester today and become a code contributor later. Both are valuable.
