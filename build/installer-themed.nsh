; StratoSort Themed Installer Hooks (NSIS / MUI2)
; Adds premium branding to the NSIS wizard using images in build resources:
; - assets/installer/header.png  (150x57 px)
; - assets/installer/welcome.png (164x314 px)
; - assets/installer/finish.png  (164x314 px)
;
; Notes:
; - electron-builder sets BUILD_RESOURCES_DIR for us (points at configured buildResources dir).
; - We keep the existing custom install/uninstall hooks (marker + shortcuts).

; ============================================================================
; BRANDING & APPEARANCE
; ============================================================================

; Enable a branded header image across pages
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${BUILD_RESOURCES_DIR}\\installer\\header.png"

; Use branded sidebar images for Welcome/Finish pages
; electron-builder may pre-define these (default nsis3-metro.bmp) via command line.
; We must undef them before overriding to avoid "!define already defined" build failures.
!ifdef MUI_WELCOMEFINISHPAGE_BITMAP
  !undef MUI_WELCOMEFINISHPAGE_BITMAP
!endif
!ifdef MUI_UNWELCOMEFINISHPAGE_BITMAP
  !undef MUI_UNWELCOMEFINISHPAGE_BITMAP
!endif
!define MUI_WELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\\installer\\welcome.png"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\\installer\\finish.png"

; ============================================================================
; WELCOME PAGE CUSTOMIZATION
; ============================================================================
!define MUI_WELCOMEPAGE_TITLE "Welcome to StratoSort Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of StratoSort.$\r$\n$\r$\nStratoSort uses AI to intelligently organize your files into smart folders. After installation, the app will help you set up the optional AI components (Ollama and ChromaDB).$\r$\n$\r$\nClick Next to continue."

; ============================================================================
; FINISH PAGE CUSTOMIZATION
; ============================================================================
!ifdef MUI_FINISHPAGE_RUN
  !undef MUI_FINISHPAGE_RUN
!endif
!ifdef MUI_FINISHPAGE_RUN_TEXT
  !undef MUI_FINISHPAGE_RUN_TEXT
!endif
!define MUI_FINISHPAGE_TITLE "StratoSort Installation Complete"
!define MUI_FINISHPAGE_TEXT "StratoSort has been installed on your computer.$\r$\n$\r$\nWhen you first launch, you'll be guided through setting up AI components for intelligent file organization.$\r$\n$\r$\nClick Finish to exit Setup."

; ============================================================================
; DIRECTORY PAGE CUSTOMIZATION
; ============================================================================
!define MUI_DIRECTORYPAGE_TEXT_TOP "Setup will install StratoSort in the following folder. To install in a different folder, click Browse and select another folder. Click Install to start the installation."

; ============================================================================
; ABORT WARNING
; ============================================================================
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to cancel StratoSort installation?"

; StratoSort Custom Installer Hooks
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
  ; These are created during app registration but not cleaned up automatically
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


