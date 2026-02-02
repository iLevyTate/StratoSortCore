@echo off
echo ============================================
echo   StratoSort Installer Builder
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [1/7] Installing dependencies...
call npm ci

if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [2/7] Generating assets...
call npm run generate:assets

if errorlevel 1 (
    echo ERROR: Failed to generate assets
    pause
    exit /b 1
)

echo.
echo [3/7] Staging embedded runtimes...
call npm run setup:runtime

if errorlevel 1 (
    echo ERROR: Failed to stage embedded runtimes
    pause
    exit /b 1
)

echo.
echo [4/7] Building application...
call npm run build

if errorlevel 1 (
    echo ERROR: Build failed
    pause
    exit /b 1
)

echo.
echo [5/7] Checking Ollama setup...
call node scripts/setup-ollama.js --check >nul 2>&1
if errorlevel 1 (
    echo WARNING: Ollama not configured. AI features will be limited.
    echo Run 'npm run setup:ollama' to configure Ollama.
) else (
    echo Ollama is configured and ready!
)

echo.
echo [6/7] Creating Windows installer...
call npx electron-builder --win --publish never --config electron-builder.json

if errorlevel 1 (
    echo ERROR: Installer creation failed
    pause
    exit /b 1
)

echo.
echo [7/7] Build complete!
echo.
echo ============================================
echo   SUCCESS! Installer created
echo ============================================
echo.
echo Installer location:
echo   release\build\StratoSort-Setup-{version}.exe
echo   (Check release\build\ for the exact filename)
echo.
echo You can now:
echo   1. Run the installer to install StratoSort
echo   2. Share it with others
echo   3. Upload it to GitHub Releases
echo.
pause
