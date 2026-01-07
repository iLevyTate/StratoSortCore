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
  ; Create a marker file to indicate first run
  FileOpen $0 "$INSTDIR\first-run.marker" w
  FileWrite $0 "This file indicates StratoSort needs to set up AI components on first launch"
  FileClose $0

  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\StratoSort"
  CreateShortcut "$SMPROGRAMS\StratoSort\StratoSort.lnk" "$INSTDIR\StratoSort.exe"
  CreateShortcut "$SMPROGRAMS\StratoSort\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut is handled by electron-builder's createDesktopShortcut option
!macroend

!macro customUnInstall
  ; Remove shortcuts
  Delete "$SMPROGRAMS\StratoSort\StratoSort.lnk"
  Delete "$SMPROGRAMS\StratoSort\Uninstall.lnk"
  RMDir "$SMPROGRAMS\StratoSort"

  ; Clean up first-run marker
  Delete "$INSTDIR\first-run.marker"

  ; Ask about app data
  MessageBox MB_YESNO "Remove all StratoSort settings and data?" IDNO SkipAppData
    RMDir /r "$APPDATA\StratoSort"
  SkipAppData:
!macroend


