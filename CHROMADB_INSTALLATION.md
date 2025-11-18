# ChromaDB Installation Guide

## Overview

ChromaDB is required for StratoSort's semantic search and AI-powered file organization features. This guide will help you install ChromaDB on your Windows system.

## Error: "No module named chromadb"

If you're seeing this error, it means ChromaDB is not installed in your Python environment.

## Quick Installation

### Option 1: Using the Batch Script (Recommended)

1. Double-click `install-chromadb.bat` in the StratoSort directory
2. Follow the prompts
3. Restart StratoSort once installation is complete

### Option 2: Using PowerShell

1. Right-click `install-chromadb.ps1` and select "Run with PowerShell"
2. If you get an execution policy error:
   - Open PowerShell as Administrator
   - Run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
   - Try running the script again
3. Restart StratoSort once installation is complete

### Option 3: Manual Installation

1. Open Command Prompt or PowerShell
2. Run the following commands:

   ```bash
   # Upgrade pip
   py -3 -m pip install --upgrade pip

   # Install ChromaDB
   py -3 -m pip install chromadb
   ```

3. Verify installation:
   ```bash
   py -3 -c "import chromadb; print(chromadb.__version__)"
   ```
4. Restart StratoSort

## Prerequisites

### Python 3

ChromaDB requires Python 3.8 or higher. To check if Python is installed:

```bash
py -3 --version
```

If Python is not installed:

1. Download Python from [python.org](https://www.python.org/downloads/)
2. During installation, **make sure to check "Add Python to PATH"**
3. Restart your computer after installation

## Troubleshooting

### "Python is not recognized as an internal or external command"

- Python is not installed or not in your system PATH
- Reinstall Python and make sure to check "Add Python to PATH"

### Permission Denied Errors

- Run the installation as Administrator
- Or install to user directory: `py -3 -m pip install chromadb --user`

### "Microsoft Visual C++ 14.0 or greater is required"

- Install Visual C++ Build Tools from [Microsoft](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Or install Visual Studio Community with C++ development tools

### ChromaDB Still Not Working After Installation

1. Check if ChromaDB is installed:
   ```bash
   py -3 -m pip list | findstr chromadb
   ```
2. Try reinstalling:
   ```bash
   py -3 -m pip uninstall chromadb
   py -3 -m pip install chromadb
   ```
3. Check for conflicting Python installations:
   ```bash
   where python
   where py
   ```

## Disabling ChromaDB (Fallback Mode)

If you want to run StratoSort without ChromaDB:

1. Set the environment variable: `STRATOSORT_DISABLE_CHROMADB=1`
2. StratoSort will run in degraded mode without semantic search features

## Features That Require ChromaDB

- Semantic file search
- Smart folder suggestions
- AI-powered file organization
- Content-based file matching

Without ChromaDB, StratoSort will still work but will use simpler pattern-based matching instead of semantic understanding.

## Additional Help

If you continue to experience issues:

1. Check the application logs in `%APPDATA%\stratosort\logs`
2. Report issues on the GitHub repository
3. Include your Python version and any error messages
