!macro customInit
  # Remove shortcuts created by pre-rebrand builds. Never touch the shared
  # t3code program directory or updater cache: an official T3 Code install may
  # own them. The current installer recreates the correct KamiCode shortcut.
  Delete "$DESKTOP\KamiCode (Alpha).lnk"
  Delete "$SMPROGRAMS\KamiCode (Alpha).lnk"
  Delete "$DESKTOP\KamiCode (Dev).lnk"
  Delete "$SMPROGRAMS\KamiCode (Dev).lnk"

  # The 2026-07-10 nightly accidentally installed KamiCode into T3 Code's
  # package directory. Forget only that broken KamiCode registration so this
  # installer never launches an uninstaller from, or reuses, T3 Code's folder.
  ReadRegStr $R0 HKCU "Software\d2bc2073-f4a4-53c2-aab6-e8fbd5d6a5d9" "InstallLocation"
  StrCmp $R0 "$LocalAppData\Programs\t3code" 0 broken_kamicode_registration_cleaned
    # The colliding release preserved a desktop link into T3 Code's folder.
    # Force the stable KamiCode installer identity to recreate its shortcuts.
    DeleteRegValue HKCU "Software\3e155f2a-a3e3-5a89-aef5-f846781094d1" "KeepShortcuts"
    DeleteRegKey HKCU "Software\d2bc2073-f4a4-53c2-aab6-e8fbd5d6a5d9"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\d2bc2073-f4a4-53c2-aab6-e8fbd5d6a5d9"

broken_kamicode_registration_cleaned:
!macroend
