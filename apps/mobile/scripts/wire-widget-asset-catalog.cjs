"use strict";

// One-off: apply the widget asset-catalog wiring to the already-generated
// ios/ project so the current build compiles ExpoWidgetsTarget/Assets.xcassets
// without a full `expo prebuild`. The durable equivalent lives in
// plugins/withWidgetLogoAsset.cjs and runs on prebuild.

const path = require("path");
const fs = require("fs");

const xcodePath = require.resolve("xcode", {
  paths: [
    require.resolve("@expo/config-plugins", { paths: [require.resolve("expo/package.json")] }),
  ],
});
const xcode = require(xcodePath);
const { addWidgetAssetCatalog } = require("../plugins/lib/addWidgetAssetCatalog.cjs");

const iosDirectory = path.join(__dirname, "..", "ios");
const xcodeProjects = fs
  .readdirSync(iosDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"));

if (xcodeProjects.length !== 1) {
  throw new Error(
    `Expected one generated Xcode project in ${iosDirectory}, found ${xcodeProjects.length}.`,
  );
}

const pbxprojPath = path.join(iosDirectory, xcodeProjects[0].name, "project.pbxproj");
const proj = xcode.project(pbxprojPath);
proj.parseSync();

const added = addWidgetAssetCatalog(proj, { targetName: "ExpoWidgetsTarget" });

if (added) {
  fs.writeFileSync(pbxprojPath, proj.writeSync());
  console.log("Added widget asset-compile phase to ExpoWidgetsTarget.");
} else {
  console.log("No change: phase already present.");
}
