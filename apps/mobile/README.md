# KamiCode Mobile

> [!WARNING]
> KamiCode Mobile is currently in development and is not distributed yet. Build it from source with an Expo development client.

## Quickstart

> [!NOTE]
> Uses native modules so using Expo Go is not supported. You need to use the Expo Dev Client.

This app has three variants:

- `development`: Expo dev client, installable side-by-side as `KamiCode Dev`
- `preview`: persistent internal preview build, installable side-by-side as `KamiCode Preview`
- `production`: store/release build as `KamiCode`

Run commands from `apps/mobile`.

Kami Connect is optional and disabled in a fresh clone. Public configuration belongs in the
repository-root `.env` or `.env.local`, not an `apps/mobile/.env` file. See
[`../../.env.example`](../../.env.example).

## Development

Start Metro for the dev client:

```bash
vp run dev:client
```

Build and run the local iOS dev client:

```bash
vp run ios:dev
```

If your Xcode account only has a Personal Team, use a bundle identifier you control and opt into the
reduced-capability local build. Personal Team builds omit the widget extension, push entitlement, and
native Sign in with Apple entitlement; builds without this opt-in are unchanged.

```bash
KAMICODE_IOS_PERSONAL_TEAM=1 \
KAMICODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.kamicode.dev \
vp run ios:dev
```

Build and install a self-contained Release app that does not need Metro:

```bash
vp run ios:release
```

The Personal Team equivalent also needs a unique bundle identifier:

```bash
KAMICODE_IOS_PERSONAL_TEAM=1 \
KAMICODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.kamicode \
vp run ios:release
```

Build and run the local iOS preview app:

```bash
vp run ios:preview
```

Force the review diff highlighter engine:

```bash
EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=javascript vp run ios:dev
```

`javascript` is the default and recommended setting for the review diff screen. Set `EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=native` only when you explicitly want to test the native Shiki engine.

Inspect the resolved Expo config for a variant:

```bash
vp run config:dev
vp run config:preview
```

Run static checks for mobile native code:

```bash
node ../../scripts/mobile-native-static-check.ts
```

The native lint task runs SwiftLint for Swift plus ktlint and detekt for Kotlin. Missing native tools are reported as warnings and skipped locally. CI installs the default toolset from `apps/mobile/Brewfile` before running the native checks.

## EAS Builds

CI uses Expo fingerprinting with the `preview:dev` profile to reuse an existing compatible build when possible, or start a new internal EAS build when native runtime inputs change. Production and default local builds continue to use the `appVersion` runtime policy.

Before enabling EAS builds for this fork, create a KamiCode Expo project and configure these
GitHub repository variables:

- `KAMICODE_MOBILE_EXPO_OWNER`
- `KAMICODE_MOBILE_EXPO_PROJECT_ID`

Store `EXPO_TOKEN` as a GitHub Actions secret. For preview or production EAS environments, set
`KAMICODE_CLERK_PUBLISHABLE_KEY`, `KAMICODE_CLERK_JWT_TEMPLATE`, and
`KAMICODE_RELAY_URL`. The inherited `T3CODE_*` names remain accepted as compatibility aliases.
Without a KamiCode Expo project id, local builds work but OTA updates and EAS workflows stay
disabled instead of targeting the upstream T3 project.

Create a PR preview dev-client build manually:

```bash
vp run eas:ios:preview:dev
```

Create a cloud dev-client build:

```bash
vp run eas:ios:dev
```

Create a persistent preview build:

```bash
vp run eas:ios:preview
```

Android equivalents:

```bash
vp run eas:android:dev
vp run eas:android:preview:dev
vp run eas:android:preview
```
