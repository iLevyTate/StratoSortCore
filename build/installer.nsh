; StratoSort Custom Installer Hooks
; This file contains custom NSIS code that runs during installation
; NOTE: This is the basic version. installer-themed.nsh is used by default.

!macro customInstall
  ; Clear stale markers from previous installs to ensure fresh setup
  Delete "$INSTDIR\first-run.marker"
  Delete "$LOCALAPPDATA\StratoSort\first-run.marker"
  Delete "$LOCALAPPDATA\StratoSort\dependency-setup-complete.marker"

  ; Create app data directory if it doesn't exist
  CreateDirectory "$LOCALAPPDATA\StratoSort"

  ; Note: App handles first-run detection via dependency-setup-complete.marker
  ; Deleting markers above ensures fresh install triggers setup

  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\StratoSort"
  CreateShortcut "$SMPROGRAMS\StratoSort\StratoSort.lnk" "$INSTDIR\StratoSort.exe"
  CreateShortcut "$SMPROGRAMS\StratoSort\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut is handled by electron-builder's createDesktopShortcut option

  ; Write uninstaller registry entry for Add/Remove Programs
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort" "DisplayName" "StratoSort"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort" "DisplayIcon" "$\"$INSTDIR\StratoSort.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort" "Publisher" "StratoSort"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort" "NoRepair" 1
!macroend

!macro customUnInstall
  ; Remove shortcuts
  Delete "$SMPROGRAMS\StratoSort\StratoSort.lnk"
  Delete "$SMPROGRAMS\StratoSort\Uninstall.lnk"
  RMDir "$SMPROGRAMS\StratoSort"

  ; Clean up first-run markers from both possible locations
  Delete "$INSTDIR\first-run.marker"
  Delete "$LOCALAPPDATA\StratoSort\first-run.marker"
  Delete "$LOCALAPPDATA\StratoSort\dependency-setup-complete.marker"

  ; Remove uninstaller registry entry
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StratoSort"

  ; Clean up file association registry entries created by electron-builder
  DeleteRegKey HKCU "Software\Classes\StratoSort.pdf"
  DeleteRegKey HKCU "Software\Classes\StratoSort.doc"
  DeleteRegKey HKCU "Software\Classes\StratoSort.docx"
  DeleteRegKey HKCU "Software\Classes\StratoSort.xlsx"
  DeleteRegKey HKCU "Software\Classes\StratoSort.pptx"
  DeleteRegKey HKCU "Software\Classes\StratoSort.txt"
  DeleteRegKey HKCU "Software\Classes\StratoSort.md"

  ; Remove application capabilities registry entries
  DeleteRegKey HKCU "Software\Classes\Applications\StratoSort.exe"
  DeleteRegKey HKCU "Software\StratoSort"

  ; Ask about app data (includes ChromaDB data, settings, logs)
  MessageBox MB_YESNO "Remove all StratoSort settings and data?$\r$\n$\r$\nThis includes:$\r$\n• AI embedding database (ChromaDB)$\r$\n• User settings and preferences$\r$\n• Application logs" IDNO SkipAppData
    RMDir /r "$APPDATA\StratoSort"
    ; Also clean up Local AppData (contains Electron cache, chromadb data)
    RMDir /r "$LOCALAPPDATA\StratoSort"
  SkipAppData:
!macroend