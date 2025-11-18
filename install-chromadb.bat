@echo off
echo ====================================
echo ChromaDB Installation Script
echo ====================================
echo.

REM Check for Python installation
echo Checking for Python installation...
py -3 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python 3 is not installed or not in PATH.
    echo Please install Python 3 from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

echo Python 3 found!
py -3 --version
echo.

REM Install chromadb package
echo Installing ChromaDB package...
echo This may take a few minutes...
echo.

py -3 -m pip install --upgrade pip
if %errorlevel% neq 0 (
    echo ERROR: Failed to upgrade pip
    pause
    exit /b 1
)

py -3 -m pip install chromadb
if %errorlevel% neq 0 (
    echo ERROR: Failed to install chromadb
    echo.
    echo If you're getting permission errors, try running this script as Administrator
    echo Or install manually with: py -3 -m pip install chromadb --user
    pause
    exit /b 1
)

echo.
echo ====================================
echo ChromaDB installed successfully!
echo ====================================
echo.

REM Verify installation
echo Verifying ChromaDB installation...
py -3 -c "import chromadb; print(f'ChromaDB version: {chromadb.__version__}')"
if %errorlevel% neq 0 (
    echo WARNING: ChromaDB module import test failed
    echo Please check the installation manually
) else (
    echo ChromaDB is working correctly!
)

echo.
echo You can now restart StratoSort and ChromaDB should start automatically.
echo.
pause