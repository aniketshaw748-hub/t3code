import { BRAND } from "@t3tools/contracts/brand";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { Linking, Platform } from "react-native";

interface AndroidAgentNotifications {
  configure(deviceId: string, userId: string, scheme: string, ongoingEnabled: boolean): void;
  clear(): void;
  setThreadOnScreen?(path: string | null): void;
  openLiveUpdateSettings?(): boolean;
  showShowcaseActivity?(scheme: string, data: Record<string, string>): void;
  getState?(): Partial<AndroidNotificationState>;
  openNotificationSettings?(channel: string | null): boolean;
}

export interface AndroidNotificationState {
  readonly notificationsEnabled: boolean;
  readonly alertsBlocked: boolean;
  readonly activityBlocked: boolean;
  readonly bubblesSupported: boolean;
  readonly bubblesBlocked: boolean;
  /** The `user_id` messages must carry; "direct" while paired hosts send notifications. */
  readonly registeredUserId: string;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<AndroidAgentNotifications>("T3AgentNotifications")
    : null;

export function supportsAndroidAgentNotifications(): boolean {
  return typeof native?.configure === "function" && typeof native?.clear === "function";
}

function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  return (Array.isArray(scheme) ? scheme[0] : scheme) ?? BRAND.urlSchemes.production;
}

export function configureAndroidAgentNotifications(
  deviceId: string,
  userId: string,
  ongoingEnabled: boolean,
): void {
  native?.configure?.(deviceId, userId, appScheme(), ongoingEnabled);
}

export function showAndroidShowcaseAgentActivity(data: Record<string, string>): boolean {
  if (!native?.showShowcaseActivity) return false;
  native.showShowcaseActivity(appScheme(), data);
  return true;
}

export function clearAndroidAgentNotifications(): void {
  native?.clear?.();
}

export function setAndroidThreadOnScreen(path: string | null): void {
  native?.setThreadOnScreen?.(path);
}

export function supportsAndroidLiveUpdateSettings(): boolean {
  return Platform.OS === "android" && Number(Platform.Version) >= 36;
}

export async function openAndroidLiveUpdateSettings(): Promise<void> {
  if (!native?.openLiveUpdateSettings?.()) {
    await Linking.openSettings();
  }
}

export function readAndroidNotificationState(): AndroidNotificationState | null {
  const state = native?.getState?.();
  if (!state) return null;
  return {
    notificationsEnabled: state.notificationsEnabled === true,
    alertsBlocked: state.alertsBlocked === true,
    activityBlocked: state.activityBlocked === true,
    bubblesSupported: state.bubblesSupported === true,
    bubblesBlocked: state.bubblesBlocked === true,
    registeredUserId: state.registeredUserId ?? "",
  };
}

/** A channel's settings page, or the app's bubble settings when `channel` is null. */
export async function openAndroidNotificationSettings(channel: string | null): Promise<void> {
  if (!native?.openNotificationSettings?.(channel)) {
    await Linking.openSettings();
  }
}
