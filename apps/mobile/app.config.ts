import type { ExpoConfig } from "expo/config";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

type AppVariant = "development" | "preview" | "production";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);
const isIosPersonalTeamBuild =
  (repoEnv.KAMICODE_IOS_PERSONAL_TEAM ?? repoEnv.T3CODE_IOS_PERSONAL_TEAM) === "1";

const personalTeamBundleIdentifier = (
  repoEnv.KAMICODE_IOS_PERSONAL_TEAM_BUNDLE_ID ?? repoEnv.T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID
)?.trim();
const IOS_BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

if (
  isIosPersonalTeamBuild &&
  (!personalTeamBundleIdentifier ||
    !IOS_BUNDLE_IDENTIFIER_PATTERN.test(personalTeamBundleIdentifier))
) {
  throw new Error(
    "KAMICODE_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS identifier such as com.example.kamicode when KAMICODE_IOS_PERSONAL_TEAM=1.",
  );
}

const appleTeamId = (repoEnv.KAMICODE_APPLE_TEAM_ID ?? repoEnv.T3CODE_APPLE_TEAM_ID)
  ?.trim()
  .toUpperCase();
const relyingParty = repoEnv.KAMICODE_MOBILE_RELYING_PARTY?.trim();
const expoOwner = repoEnv.KAMICODE_MOBILE_EXPO_OWNER?.trim();
const expoProjectId = repoEnv.KAMICODE_MOBILE_EXPO_PROJECT_ID?.trim();

const VARIANT_CONFIG: Record<
  AppVariant,
  {
    readonly appName: string;
    readonly scheme: string;
    readonly iosIcon: string;
    readonly splashIcon: string;
    readonly iosBundleIdentifier: string;
    readonly androidPackage: string;
    readonly relyingParty?: string;
  }
> = {
  development: {
    appName: "KamiCode Dev",
    scheme: "kamicode-dev",
    iosIcon: "./assets/icon-composer-dev.icon",
    splashIcon: "./assets/splash-icon-dev.png",
    iosBundleIdentifier: "tech.camie.kamicode.dev",
    androidPackage: "tech.camie.kamicode.dev",
    relyingParty,
  },
  preview: {
    appName: "KamiCode Preview",
    scheme: "kamicode-preview",
    iosIcon: "./assets/icon-composer-prod.icon",
    splashIcon: "./assets/splash-icon-prod.png",
    iosBundleIdentifier: "tech.camie.kamicode.preview",
    androidPackage: "tech.camie.kamicode.preview",
    relyingParty,
  },
  production: {
    appName: "KamiCode",
    scheme: "kamicode",
    iosIcon: "./assets/icon-composer-prod.icon",
    splashIcon: "./assets/splash-icon-prod.png",
    iosBundleIdentifier: "tech.camie.kamicode",
    androidPackage: "tech.camie.kamicode",
    relyingParty,
  },
};

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];

const dmSansFonts = {
  regular: "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf",
  medium: "@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf",
  bold: "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf",
} as const;

const widgetsPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-widgets",
  {
    bundleIdentifier: `${variant.iosBundleIdentifier}.widgets`,
    groupIdentifier: `group.${variant.iosBundleIdentifier}`,
    enablePushNotifications: true,
    // Agent activity can update many times an hour; without the
    // frequent-updates entitlement iOS throttles the update budget sooner.
    frequentUpdates: true,
    widgets: [
      {
        name: "AgentActivity",
        displayName: "Agent Activity",
        description: "Shows the current state of active KamiCode agents.",
        supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
      },
    ],
  },
];

// These aliases match the fonts' PostScript names on iOS. Register the same
// names on Android so React Native and the native composer use one set of
// family names without waiting for runtime font loading.

const config: ExpoConfig = {
  name: variant.appName,
  slug: "kamicode",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: "0.1.0",
  runtimeVersion: {
    // Fingerprint (not appVersion) so an OTA only reaches binaries whose native
    // project — native deps, config plugins, AND patches/ — matches the update.
    // With appVersion, every 0.1.0 build shares a runtime version, so a JS update
    // could land on a binary missing the native changes it needs and crash.
    policy: process.env.MOBILE_VERSION_POLICY ?? "fingerprint",
  },
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  updates: expoProjectId
    ? {
        enabled: true,
        url: `https://u.expo.dev/${expoProjectId}`,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false },
  ios: {
    icon: variant.iosIcon,
    supportsTablet: true,
    bundleIdentifier: variant.iosBundleIdentifier,
    // Production signing is owned by KamiCode. A fresh clone intentionally has
    // no baked-in Apple team or associated domain from the upstream project.
    appleTeamId: appleTeamId || undefined,
    associatedDomains: variant.relyingParty
      ? [`applinks:${variant.relyingParty}`, `webcredentials:${variant.relyingParty}`]
      : undefined,
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription:
        "Allow KamiCode to connect to KamiCode environments on your local network or tailnet.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    icon: "./assets/icon.png",
    package: variant.androidPackage,
    adaptiveIcon: {
      backgroundColor: "#000000",
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    // Opts into OnBackInvokedCallback-based back dispatch (Android 13+).
    // JS back handling survives it via react-native's Android 16 shim plus
    // withAndroidPredictiveBackCompat on Android 13-15.
    predictiveBackGestureEnabled: true,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-asset",
    [
      "expo-font",
      {
        ios: {
          fonts: [dmSansFonts.regular, dmSansFonts.medium, dmSansFonts.bold],
        },
        android: {
          fonts: [
            {
              fontFamily: "DMSans-Regular",
              fontDefinitions: [{ path: dmSansFonts.regular, weight: 400 }],
            },
            {
              fontFamily: "DMSans-Medium",
              fontDefinitions: [{ path: dmSansFonts.medium, weight: 500 }],
            },
            {
              fontFamily: "DMSans-Bold",
              fontDefinitions: [{ path: dmSansFonts.bold, weight: 700 }],
            },
          ],
        },
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    // appleSignIn must be gated here: withoutIosPersonalTeamCapabilities.cjs runs before
    // plugins earlier in this array, so it cannot strip the entitlement Clerk would add.
    ["@clerk/expo", { theme: "./clerk-theme.json", appleSignIn: !isIosPersonalTeamBuild }],
    "expo-web-browser",
    [
      "expo-quick-actions",
      {
        // Adaptive launcher-shortcut icon; referenced by resource name from
        // the shortcut items set in src/features/shortcuts.
        androidIcons: {
          shortcut_icon: {
            foregroundImage: "./assets/android-icon-foreground.png",
            backgroundColor: "#000000",
          },
        },
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Allow KamiCode to access your camera so you can scan pairing QR codes.",
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: variant.splashIcon,
        resizeMode: "contain",
        backgroundColor: "#000000",
        imageWidth: 220,
        dark: {
          image: variant.splashIcon,
          backgroundColor: "#0a0a0a",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "18.0",
          // AppCheckCore 11.3+ includes Swift and needs module maps for these Objective-C dependencies.
          extraPods: [
            { name: "GoogleUtilities", modular_headers: true },
            { name: "RecaptchaInterop", modular_headers: true },
          ],
        },
      },
    ],
    "./plugins/withIosCocoaPodsUuidCache.cjs",
    // Must be listed BEFORE expo-widgets: same-type mods run last-registered-
    // first, so registering earlier makes this plugin's mods run AFTER
    // expo-widgets' — its dangerous mod wipes ios/ExpoWidgetsTarget/ (which
    // would delete the asset catalog) and its xcodeproj mod creates the widget
    // target (which must exist before the compile phase can be attached).
    ...(!isIosPersonalTeamBuild ? ["./plugins/withWidgetLogoAsset.cjs", widgetsPlugin] : []),
    "./plugins/withIosSceneLifecycle.cjs",
    "./plugins/withAndroidCleartextTraffic.cjs",
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidModernPopupMenu.cjs",
    "./plugins/withAndroidModernAlertDialog.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
    ...(isIosPersonalTeamBuild ? ["./plugins/withoutIosPersonalTeamCapabilities.cjs"] : []),
  ],
  extra: {
    appVariant: APP_VARIANT,
    iosPersonalTeamBuild: isIosPersonalTeamBuild,
    relay: {
      url: repoEnv.KAMICODE_RELAY_URL ?? repoEnv.T3CODE_RELAY_URL ?? null,
    },
    clerk: {
      publishableKey:
        repoEnv.KAMICODE_CLERK_PUBLISHABLE_KEY ?? repoEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
      jwtTemplate:
        repoEnv.KAMICODE_CLERK_JWT_TEMPLATE ?? repoEnv.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ?? null,
    },
    // Native Google sign-in credentials. @clerk/expo reads these from `extra`
    // under their exact env-var names (not nested), and its config plugin reads
    // the iOS URL scheme at prebuild to register it in Info.plist.
    // Unset values must be omitted (not null): the public manifest serializes
    // null to {}, which is truthy and would defeat Clerk's fallback checks.
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME,
    observability: {
      tracesUrl:
        repoEnv.KAMICODE_MOBILE_OTLP_TRACES_URL ??
        repoEnv.EXPO_PUBLIC_OTLP_TRACES_URL ??
        "https://api.axiom.co/v1/traces",
      tracesDataset:
        repoEnv.KAMICODE_MOBILE_OTLP_TRACES_DATASET ??
        repoEnv.EXPO_PUBLIC_OTLP_TRACES_DATASET ??
        null,
      tracesToken:
        repoEnv.KAMICODE_MOBILE_OTLP_TRACES_TOKEN ?? repoEnv.EXPO_PUBLIC_OTLP_TRACES_TOKEN ?? null,
    },
    ...(expoProjectId ? { eas: { projectId: expoProjectId } } : {}),
  },
  ...(expoOwner ? { owner: expoOwner } : {}),
};

export default config;
