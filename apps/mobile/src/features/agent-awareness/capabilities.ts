import Constants from "expo-constants";
import { Platform } from "react-native";
import { supportsAndroidAgentNotifications } from "./androidNotifications";

/** False for Android builds made without a Firebase config, which cannot get a push token. */
export function isPushConfigured() {
  return Platform.OS !== "android" || Constants.expoConfig?.extra?.androidPushConfigured === true;
}

export function supportsAgentAwarenessPush() {
  if (!isPushConfigured()) return false;
  return Platform.OS === "android"
    ? supportsAndroidAgentNotifications()
    : Platform.OS === "ios" && Constants.expoConfig?.extra?.iosPersonalTeamBuild !== true;
}
