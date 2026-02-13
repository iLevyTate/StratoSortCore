# Monitor-DevLogs.ps1
# Monitors the latest Cursor terminal log for StratoSort errors and events.

$terminalsDir = Join-Path $PSScriptRoot ".cursor\projects\c-Users-benja-Documents-GitHub-StratoSortCore\terminals"

function Get-LatestTerminalFile {
    Get-ChildItem -Path $terminalsDir -Filter "*.txt" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$latestFile = Get-LatestTerminalFile

if (-not $latestFile) {
    Write-Host "No terminal logs found in $terminalsDir" -ForegroundColor Red
    exit 1
}

Write-Host "Monitoring log file: $($latestFile.Name)" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray

Get-Content -Path $latestFile.FullName -Tail 100 -Wait | ForEach-Object {
    $line = $_
    
    # Naming Convention (Green)
    if ($line -match "\[SMART-FOLDER-WATCHER\] Applied naming convention") {
        Write-Host $line -ForegroundColor Green
    }
    # Errors (Red)
    elseif ($line -match "Error" -or $line -match "Exception" -or $line -match "\[AI-ANALYSIS-FAILED\]" -or $line -match "\[OCR\] .* failed") {
        Write-Host $line -ForegroundColor Red
    }
    # Warnings / OCR Issues (Yellow)
    elseif ($line -match "\[PDF\] No extractable text" -or $line -match "Hallucination" -or $line -match "WARN") {
        Write-Host $line -ForegroundColor Yellow
    }
    # Success (Cyan)
    elseif ($line -match "\[AI-ANALYSIS-SUCCESS\]") {
        Write-Host $line -ForegroundColor Cyan
    }
    # Default (Gray)
    else {
        Write-Host $line -ForegroundColor Gray
    }
}
