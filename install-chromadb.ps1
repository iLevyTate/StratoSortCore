Write-Host "====================================" -ForegroundColor Cyan
Write-Host "ChromaDB Installation Script" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check for Python installation
Write-Host "Checking for Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = & py -3 --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Python 3 found: $pythonVersion" -ForegroundColor Green
    } else {
        throw "Python not found"
    }
} catch {
    Write-Host "ERROR: Python 3 is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Python 3 from https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "Make sure to check 'Add Python to PATH' during installation." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host ""

# Upgrade pip
Write-Host "Upgrading pip..." -ForegroundColor Yellow
& py -3 -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to upgrade pip" -ForegroundColor Red
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host ""

# Install chromadb
Write-Host "Installing ChromaDB package..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray
Write-Host ""

& py -3 -m pip install chromadb
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install chromadb" -ForegroundColor Red
    Write-Host ""
    Write-Host "If you're getting permission errors, try:" -ForegroundColor Yellow
    Write-Host "  1. Run PowerShell as Administrator" -ForegroundColor Yellow
    Write-Host "  2. Or install with: py -3 -m pip install chromadb --user" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Green
Write-Host "ChromaDB installed successfully!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
Write-Host ""

# Verify installation
Write-Host "Verifying ChromaDB installation..." -ForegroundColor Yellow
$verifyScript = @"
import chromadb
print(f'ChromaDB version: {chromadb.__version__}')
"@

try {
    $result = & py -3 -c $verifyScript 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host $result -ForegroundColor Green
        Write-Host "ChromaDB is working correctly!" -ForegroundColor Green
    } else {
        throw "Import failed"
    }
} catch {
    Write-Host "WARNING: ChromaDB module import test failed" -ForegroundColor Red
    Write-Host "Please check the installation manually" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "You can now restart StratoSort and ChromaDB should start automatically." -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")