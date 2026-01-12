# Manual Test Plan for El StratoSort

This document outlines the manual testing procedures for El StratoSort. It covers installation, core
functionality, advanced features, and edge cases to ensure the application's reliability and user
experience.

**Version:** 1.1 **Last Updated:** 2026-01-10

## 1. Prerequisites & Environment

- **OS:** Windows 10/11 (Primary), macOS/Linux (Secondary)
- **Hardware:** Minimum 8GB RAM, 12GB+ free disk space.
- **External Dependencies:**
  - Ollama installed and running (or capable of being installed by the app).
  - ChromaDB (local instance managed by app).

---

## 2. Installation & First Run

| ID         | Test Case           | Steps                                                                                                                                            | Expected Result                                                                                                           | Pass/Fail |
| :--------- | :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :-------- |
| **INS-01** | **Clean Install**   | 1. Run the installer (Windows `.exe`, macOS `.dmg`, or Linux `.AppImage`).<br>2. Complete the installation wizard.<br>3. Launch the application. | App installs without errors. Shortcuts created. App launches successfully.                                                |           |
| **INS-02** | **First Run Setup** | 1. Launch app on a fresh system (or after clearing app data).<br>2. Observe startup checks.                                                      | App detects missing Ollama/Models. Prompts user to download/install dependencies. Downloads complete successfully (~6GB). |           |
| **INS-03** | **App Update**      | 1. Install an older version (if available).<br>2. Run the latest installer over it.                                                              | App updates successfully. User settings and data are preserved.                                                           |           |

---

## 3. Core File Analysis

| ID         | Test Case                       | Steps                                                                                                                               | Expected Result                                                                              | Pass/Fail |
| :--------- | :------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :-------- |
| **ANA-01** | **Single PDF Analysis**         | 1. Go to "Discover" tab.<br>2. Click "Select Content" (or Folder icon).<br>3. Select a text-rich PDF file.<br>4. Wait for analysis. | File appears in list. AI generates a summary/category. Confidence score is displayed.        |           |
| **ANA-02** | **Image Analysis (OCR/Vision)** | 1. Click "Select Content".<br>2. Select an image (screenshot or photo).                                                             | App analyzes image content (e.g., "receipt", "landscape"). Relevant keywords extracted.      |           |
| **ANA-03** | **Unsupported File Type**       | 1. Add a file type not typically text/image (e.g., `.exe`, `.bin`).                                                                 | App handles gracefully. May skip analysis or tag as "Unknown" without crashing.              |           |
| **ANA-04** | **Batch Analysis**              | 1. Click "Select Content".<br>2. Select 10+ mixed files (PDF, JPG, Docx).                                                           | All files are queued. Progress bar updates. Analysis completes for all files.                |           |
| **ANA-05** | **Cancel Analysis**             | 1. Start a large batch analysis.<br>2. Click "Cancel" or "Stop".                                                                    | Processing stops. Remaining files are marked as pending or cancelled. UI remains responsive. |           |

---

## 4. Organization & File Operations

| ID         | Test Case              | Steps                                                                        | Expected Result                                                                                   | Pass/Fail |
| :--------- | :--------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :-------- |
| **ORG-01** | **Review Suggestions** | 1. Analyze a file.<br>2. Click on the file card to view details.             | Detailed AI reasoning shown. Suggested folder path is visible.                                    |           |
| **ORG-02** | **Manual Override**    | 1. Analyze a file.<br>2. Manually change the destination folder or category. | New destination is saved. App remembers this preference if applicable.                            |           |
| **ORG-03** | **Execute Move**       | 1. Select one or more analyzed files.<br>2. Click "Organize" / "Apply".      | Files are moved to the target directories on disk. Success notification appears.                  |           |
| **ORG-04** | **Undo Operation**     | 1. Perform **ORG-03**.<br>2. Immediately click "Undo".                       | Files are moved back to their original location. Folder structure cleaned up if empty (optional). |           |
| **ORG-05** | **File Collision**     | 1. Move a file to a folder where a file with the same name exists.           | App prompts for resolution (Rename, Skip, Overwrite) or auto-renames (e.g., `file (1).pdf`).      |           |

---

## 5. Smart Folders (ChromaDB)

| ID         | Test Case               | Steps                                                                                                                                          | Expected Result                                                                                           | Pass/Fail |
| :--------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- | :-------- |
| **SMT-01** | **Create Smart Folder** | 1. Go to Settings -> Smart Folders.<br>2. Create a new folder "Invoices".<br>3. Add description: "Receipts, bills, and payment confirmations." | Folder created. Embeddings generated for the description.                                                 |           |
| **SMT-02** | **Matching Logic**      | 1. Add a receipt PDF into the app (via Select Content).<br>2. Observe suggested folder.                                                        | App suggests "Invoices" folder based on semantic match, even if the word "Invoice" isn't in the filename. |           |
| **SMT-03** | **Update Description**  | 1. Change description of "Invoices" to "Only utility bills".<br>2. Add a generic receipt.                                                      | Matching behavior changes (might be less likely to match generic receipt now).                            |           |

---

## 6. Search & Graph Visualization

| ID         | Test Case            | Steps                                                                                                    | Expected Result                                                                                       | Pass/Fail |
| :--------- | :------------------- | :------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :-------- |
| **SRC-01** | **Semantic Search**  | 1. Press `Ctrl/Cmd + K` or click Search icon.<br>2. Enter a query (e.g., "medical records").             | Modal opens. Results appear showing files related to "medical records" even if filenames don't match. |           |
| **SRC-02** | **Graph Navigation** | 1. In Search Modal, verify "Graph" view is active.<br>2. Click on a file node.<br>3. Drag canvas to pan. | Node details appear. Canvas pans smoothly. Related nodes are connected by edges.                      |           |
| **SRC-03** | **View Toggle**      | 1. Switch from "Graph" to "List" view in Search Modal.                                                   | Results display as a standard list. All metadata is visible.                                          |           |
| **SRC-04** | **Autocomplete**     | 1. Start typing in search box.                                                                           | Suggestions appear based on previous files/tags/folders.                                              |           |

---

## 7. Automation (Watchers)

| ID         | Test Case                | Steps                                                                                          | Expected Result                                                                                   | Pass/Fail |
| :--------- | :----------------------- | :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :-------- |
| **AUT-01** | **Downloads Watcher**    | 1. Enable "Watch Downloads" in Settings.<br>2. Download a PDF file from the browser.           | App detects new file. Automatically analyzes it. (Depending on settings: auto-moves or notifies). |           |
| **AUT-02** | **Smart Folder Watcher** | 1. Set up a source folder to watch.<br>2. Add files to that folder externally (File Explorer). | App detects and processes files.                                                                  |           |

---

## 8. Settings & Persistence

| ID         | Test Case           | Steps                                                                                               | Expected Result                                        | Pass/Fail |
| :--------- | :------------------ | :-------------------------------------------------------------------------------------------------- | :----------------------------------------------------- | :-------- |
| **SET-01** | **Change Settings** | 1. Change AI model (e.g., Llama3 to Mistral if avail).<br>2. Toggle "Dark Mode".<br>3. Restart App. | Settings persist after restart.                        |           |
| **SET-02** | **Model Download**  | 1. Select a model not currently downloaded.<br>2. Trigger download.                                 | Download progress shown. Model active upon completion. |           |

---

## 9. Resilience & Edge Cases

| ID         | Test Case             | Steps                                                                           | Expected Result                                                                                  | Pass/Fail |
| :--------- | :-------------------- | :------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------- | :-------- |
| **EDG-01** | **Offline Mode**      | 1. Disconnect Internet.<br>2. Launch App and Analyze files.                     | App functions 100% (since AI is local). No errors about network.                                 |           |
| **EDG-02** | **Corrupt File**      | 1. Create a 0-byte file or corrupted PDF.<br>2. Select it via "Select Content". | Error logged in UI for that specific file. App continues processing other files.                 |           |
| **EDG-03** | **Large File**        | 1. Try to analyze a >100MB PDF.                                                 | App attempts analysis. Should likely timeout or give a warning if too large, but must not crash. |           |
| **EDG-04** | **Permission Denied** | 1. Try to move a file to a Read-Only system folder.                             | Operation fails gracefully with a clear error message.                                           |           |
