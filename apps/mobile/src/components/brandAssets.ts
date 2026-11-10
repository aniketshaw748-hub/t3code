import Constants from "expo-constants";

const appVariant = Constants.expoConfig?.extra?.appVariant;

// Metro resolves only literal paths, so these spell out `BRAND.assets.directory`; a test checks it.
export const BRAND_MARK_SOURCE =
  appVariant === "development"
    ? require("../../../../assets/kavyaan/dev/ios-1024.png")
    : appVariant === "preview"
      ? require("../../../../assets/kavyaan/nightly/ios-1024.png")
      : require("../../../../assets/kavyaan/prod/ios-1024.png");
