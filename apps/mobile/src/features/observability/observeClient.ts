import Constants from "expo-constants";
import type { Observe as ObserveApi } from "expo-observe";

// Expo Observe's native side throws without an EAS project id, and importing the package calls it
// at once, so a build without one would fail before the app registers. It loads only with an id.
const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;

export const observe: typeof ObserveApi | null =
  typeof projectId === "string" && projectId !== ""
    ? (require("expo-observe") as typeof import("expo-observe")).Observe
    : null;
