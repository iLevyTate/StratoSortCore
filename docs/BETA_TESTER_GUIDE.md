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

1. Download the latest `.exe` from [Releases](https://github.com/iLevyTate/StratoSortCore/releases).
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

### First Launch

1. In the setup wizard, choose **Download recommended models** (one-time download).
2. Wait until setup finishes.
3. Continue into the app workflow.

---

## Part 2: Run a Useful Beta Test Session

Use this short checklist to create high-value feedback:

1. **Setup phase**
   - Add at least 3-5 Smart Folders.
   - Include clear folder descriptions.
2. **Discover phase**
   - Analyze a mixed batch (documents, images, screenshots, PDFs).
3. **Organize phase**
   - Accept some suggestions, reject others, test rename options.
4. **Search / Knowledge OS**
   - Try natural-language queries in search.
   - Open the Knowledge Graph view and inspect relationships.
5. **Settings**
   - Review these sections at minimum:
     - **AI Configuration**
     - **Performance**
     - **Default Locations**
     - **Application**
6. **Undo/Redo safety**
   - Perform a few file operations and verify undo/redo behavior.

Tip: Real-world folders (Downloads, screenshots, invoices, project docs) are better test data than
synthetic files.

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

### Sharing logs with bug reports

StratoSort can export logs from **Settings → Application preferences → Troubleshooting Logs**.

| Option                | When to use                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| **Export (Redacted)** | Default for bug reports. Removes file paths and document analysis content. Safe to attach publicly. |
| **Export Full**       | Only if a maintainer asks. Includes full paths and crash dumps. Keep private.                       |

**Steps:**

1. Open **Settings** → **Application preferences**.
2. Under **Troubleshooting Logs**, click **Export (Redacted)**.
3. Save the `.zip` file (e.g. to Desktop).
4. When filing a bug report, drag the zip into the GitHub issue or use **Attach files**.
5. Add a note like: _"Logs attached (redacted). Error occurred when [brief context]."_

Redacted logs still include error messages, stack traces, file types, and operation flow—enough for
most debugging. If we need more detail, we’ll ask you to share a full export privately.

**Manual log locations** (if you prefer copying files yourself):

- **Windows:** `%APPDATA%/stratosort/logs/`
- **macOS:** `~/Library/Logs/stratosort/`
- **Linux:** `~/.config/stratosort/logs/`

### High-quality bug report example

> **Title:** Knowledge OS search returns zero results after embedding model switch  
> **Steps:**
>
> 1. Open Settings -> AI Configuration -> Default AI models
> 2. Change Embedding Model
> 3. Return to search and query "invoice from last month"  
>    **Expected:** Existing indexed files still appear, or app prompts to rebuild before search  
>    **Actual:** Empty results + warning about model mismatch  
>    **Environment:** Windows 11, app 2.0.x installer, RTX 3060, 32GB RAM  
>    **Logs:** attached redacted export (Settings → Export Redacted)

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
