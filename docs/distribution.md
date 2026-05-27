# Distribution

KamiCode currently ships team builds through GitHub Releases.

The first supported target is Windows x64. macOS and Linux packaging can be restored later, but keeping the initial release path narrow makes updates easier to verify.

## User Download Link

Use this stable link for the latest Windows installer:

```text
https://github.com/camie-ace/KamiCode/releases/latest/download/KamiCode-Setup-x64.exe
```

The installer filename is intentionally stable across releases so this link does not change.

## Publish A Release

From `main`:

```bash
git pull --ff-only origin main
git tag v0.1.0
git push origin v0.1.0
```

The `Release` GitHub Actions workflow builds and uploads:

```text
KamiCode-Setup-x64.exe
KamiCode-Setup-x64.exe.blockmap
latest.yml
```

Electron auto-update uses `latest.yml` and the `.blockmap` file to find and install newer versions.

## Manual Release

You can also run the `Release` workflow manually from GitHub Actions and provide a version like `0.1.0`.

## Local Build

To build the Windows installer locally:

```powershell
cd "C:\Users\THIS PC\KamiCode\T3Code"

node scripts/build-desktop-artifact.ts `
  --platform win `
  --target nsis `
  --arch x64 `
  --build-version 0.1.0 `
  --verbose
```

Artifacts are written to `release/`.

## Signing

The current internal release path is unsigned. Windows may show SmartScreen warnings.

Do not spend time on signing until the basic install and auto-update loop has been tested by the team.
