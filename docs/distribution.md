# Distribution

KamiCode ships desktop installers and standalone CLI archives through [GitHub Releases](https://github.com/camie-ace/KamiCode/releases).

## Downloads

The release workflow builds Windows x64/arm64 installers, macOS x64/arm64 disk images, and Linux x64/arm64 AppImages. Installer names include the version and architecture, such as `KamiCode-0.1.10-x64.exe`.

Use the [latest stable release](https://github.com/camie-ace/KamiCode/releases/latest) for stable downloads. Nightlies are marked as prereleases in the release list. Electron auto-update uses the release's channel metadata and blockmap files; keep those assets alongside the installers.

## Publish a release

Run the `Release` workflow manually on `main`, selecting `nightly` to publish a new prerelease. The workflow generates its version, builds the artifacts, runs its quality checks, and publishes updater metadata. Set `publish_only` to `true` to publish artifacts without deploying hosted apps or sending release announcements.

The `preview` channel builds an integration branch without offering it through the nightly updater. Stable releases build the commit of an already published nightly; select `stable` and optionally supply the stable version.

Release builds can run without relay service credentials. KamiCode Connect requires its own configured relay and Clerk deployment. Direct server connections remain available without that hosted service.

## Local build

From the repository root, build a Windows installer with:

```bash
node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64 --build-version 0.1.10 --verbose
```

Use the corresponding platform and target on macOS or Linux. Artifacts are written to `release/`.

## Signing

Signing is enabled when the platform's signing credentials are configured. Unsigned Windows builds may show SmartScreen warnings; unsigned macOS builds require the operating system's manual approval to open.
