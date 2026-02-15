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

## Part 1: Install (No CLI)

Use the full install walkthrough here: [INSTALL_GUIDE.md](./INSTALL_GUIDE.md).

### Windows

1. Download `StratoSortCore-Setup-X.X.X.exe` from
   [Releases](https://github.com/iLevyTate/StratoSortCore/releases). Use the **Setup** installer
   (not the portable `.exe`) so you receive automatic updates.
2. Run the installer.
3. If SmartScreen appears, click **More info** then **Run anyway**.
4. Launch StratoSort Core.

### macOS

1. Download the matching `.dmg` from
   [Releases](https://github.com/iLevyTate/StratoSortCore/releases):
   - `mac-arm64` for Apple Silicon (M1/M2/M3/M4)
   - `mac-x64` for Intel Macs
2. Drag StratoSort Core into Applications.
3. Open the app.
4. If macOS blocks it, right-click app -> **Open**, or use **System Settings -> Privacy & Security
   -> Open Anyway**.

### Linux

1. Download `StratoSortCore-X.X.X-linux-x64.AppImage` from
   [Releases](https://github.com/iLevyTate/StratoSortCore/releases). Use the **AppImage** (not the
   `.deb`) so you receive automatic updates.
2. Make it executable: `chmod +x StratoSortCore-*.AppImage`
3. Double-click to run, or launch from a terminal.

### First Launch

1. In the setup wizard, choose a model profile (**Base Small** for most hardware, **Better Quality**
   for modern hardware with 16GB+ RAM).
2. Wait until model download finishes.
3. Continue into the app workflow.

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
  - OS + version
  - App version
  - Install type (installer vs source)
  - Hardware notes (RAM/GPU) if performance or AI related

### Attach useful evidence

- Screenshot or short screen recording.
- **Logs** (see below).
- Any visible error text (copy exact message).

### How to get logs

Open **Settings -> Application -> Troubleshooting Logs**:

| Option          | When to use                                                               |
| --------------- | ------------------------------------------------------------------------- |
| **Open Folder** | Browse log files directly on disk. Useful for picking specific log files. |
| **Export Logs** | Creates a shareable log file for bug reports. Attach to GitHub issue.     |

**Steps:**

1. Open **Settings** -> **Application**.
2. Under **Troubleshooting Logs**, click **Export Logs**.
3. Save the file (e.g. to Desktop).
4. When filing a bug report, drag the file into the GitHub issue or use **Attach files**.
5. Add a note like: _"Logs attached. Error occurred when [brief context]."_

**Manual log locations** (if you prefer copying files yourself):

- **Windows:** `%APPDATA%/stratosort/logs/`
- **macOS:** `~/Library/Logs/stratosort/`
- **Linux:** `~/.config/stratosort/logs/`

### High-quality bug report example

> **Title:** Knowledge OS search returns zero results after embedding model switch **Steps:**
>
> 1. Open Settings -> AI Configuration -> Default AI models
> 2. Change Embedding Model
> 3. Return to search and query "invoice from last month" **Expected:** Existing indexed files still
>    appear, or app prompts to rebuild before search **Actual:** Empty results + warning about model
>    mismatch **Environment:** Windows 11, app 2.0.1 installer, RTX 3060, 32GB RAM **Logs:**
>    attached export (Settings -> Export Logs)

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
