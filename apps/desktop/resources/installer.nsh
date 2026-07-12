!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
!define KAMICODE_INSTALLER_GUID "3e155f2a-a3e3-5a89-aef5-f846781094d1"
!define COLLIDING_NIGHTLY_INSTALLER_GUID "d2bc2073-f4a4-53c2-aab6-e8fbd5d6a5d9"

Var LegacyT3CodeCollisionDetected

!macro forgetCollidingKamiCodeRegistration INSTALLER_GUID
  ReadRegStr $R0 HKCU "Software\${INSTALLER_GUID}" "InstallLocation"
  ${If} $R0 == "$LocalAppData\Programs\t3code"
    StrCpy $LegacyT3CodeCollisionDetected "1"
    # Do not let electron-builder launch a KamiCode uninstaller from T3 Code's
    # directory. It could remove files belonging to an official T3 install.
    DeleteRegKey HKCU "Software\${INSTALLER_GUID}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALLER_GUID}"
  ${EndIf}
!macroend

!macro preInit
  StrCpy $LegacyT3CodeCollisionDetected "0"

  # electron-builder resolves an existing installation before customInit. Drop
  # colliding registrations here so the new package name selects
  # Programs\kamicode instead of inheriting Programs\t3code as $INSTDIR.
  !insertmacro forgetCollidingKamiCodeRegistration "${KAMICODE_INSTALLER_GUID}"
  !insertmacro forgetCollidingKamiCodeRegistration "${COLLIDING_NIGHTLY_INSTALLER_GUID}"
!macroend

!macro customInit
  # Remove shortcuts created by pre-rebrand builds. The current installer
  # recreates the correct KamiCode shortcut under Programs\kamicode.
  Delete "$DESKTOP\KamiCode (Alpha).lnk"
  Delete "$SMPROGRAMS\KamiCode (Alpha).lnk"
  Delete "$DESKTOP\KamiCode (Dev).lnk"
  Delete "$SMPROGRAMS\KamiCode (Dev).lnk"

  # A user may already have upgraded KamiCode, leaving no colliding registry
  # entry while T3 Code still loads KamiCode's shared app.asar. Positively
  # identify that state from the generated updater owner/repository.
  IfFileExists "$LocalAppData\Programs\t3code\resources\app-update.yml" 0 legacy_t3code_payload_checked
    ClearErrors
    FileOpen $R0 "$LocalAppData\Programs\t3code\resources\app-update.yml" r
    IfErrors legacy_t3code_payload_checked
    FileRead $R0 $R1
    FileRead $R0 $R2
    FileClose $R0

    # A clean T3 reinstall may have repaired the payload while leaving an old
    # KamiCode registry entry behind. Preserve T3's official updater cache in
    # that case; preInit has already removed only the stale KamiCode entry.
    StrCpy $R3 $R1 16
    StrCmp $R3 "owner: pingdotgg" 0 legacy_t3code_payload_check_kamicode
    StrCpy $R3 $R2 12
    StrCmp $R3 "repo: t3code" 0 legacy_t3code_payload_check_kamicode
    StrCpy $LegacyT3CodeCollisionDetected "0"
    Goto legacy_t3code_payload_checked

legacy_t3code_payload_check_kamicode:
    StrCpy $R3 $R1 16
    StrCmp $R3 "owner: camie-ace" 0 legacy_t3code_payload_checked
    StrCpy $R3 $R2 14
    StrCmp $R3 "repo: KamiCode" 0 legacy_t3code_payload_checked
    StrCpy $LegacyT3CodeCollisionDetected "1"

legacy_t3code_payload_checked:
  ${If} $LegacyT3CodeCollisionDetected == "1"
    # This cache contains installers, never projects or settings. Move the first
    # contaminated cache aside so a pending KamiCode installer cannot overwrite
    # a freshly reinstalled T3 Code. Repeated poisoned caches can be discarded
    # after the preserved copy exists.
    CreateDirectory "$LocalAppData\kamicode-recovery"
    IfFileExists "$LocalAppData\t3code-updater\*.*" 0 legacy_t3code_cache_quarantined
      IfFileExists "$LocalAppData\kamicode-recovery\legacy-t3code-updater\*.*" 0 legacy_t3code_cache_move
        RMDir /r "$LocalAppData\t3code-updater"
        Goto legacy_t3code_cache_quarantined
legacy_t3code_cache_move:
      Rename "$LocalAppData\t3code-updater" "$LocalAppData\kamicode-recovery\legacy-t3code-updater"

legacy_t3code_cache_quarantined:
    FileOpen $R0 "$LocalAppData\kamicode-recovery\legacy-t3code-collision" w
    FileWrite $R0 "1"
    FileClose $R0

    # Force the new isolated installer identity to recreate its shortcuts.
    DeleteRegValue HKCU "Software\${KAMICODE_INSTALLER_GUID}" "KeepShortcuts"
  ${EndIf}
!macroend
!endif
