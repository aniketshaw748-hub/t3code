import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * `user_id` the host stamps into direct FCM messages. The phone's native handler drops
 * messages whose `user_id` differs, so a phone configured for a relay account ignores them.
 */
export const DIRECT_PUSH_USER_ID = "direct";

/** Same fields as the relay's agent awareness preferences, so delivery policy is shared. */
export const DirectPushPreferences = Schema.Struct({
  liveActivitiesEnabled: Schema.Boolean,
  notificationsEnabled: Schema.Boolean,
  notifyOnApproval: Schema.Boolean,
  notifyOnInput: Schema.Boolean,
  notifyOnCompletion: Schema.Boolean,
  notifyOnFailure: Schema.Boolean,
});
export type DirectPushPreferences = typeof DirectPushPreferences.Type;

export const DirectPushDeviceRegistrationInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  platform: Schema.Literal("android"),
  androidApiLevel: Schema.optionalKey(Schema.Int),
  appVersion: Schema.optionalKey(TrimmedNonEmptyString),
  packageName: TrimmedNonEmptyString,
  pushToken: TrimmedNonEmptyString,
  preferences: DirectPushPreferences,
});
export type DirectPushDeviceRegistrationInput = typeof DirectPushDeviceRegistrationInput.Type;

export const DirectPushRegisterResult = Schema.Struct({
  /** False while the host has no service account, so the phone can say why nothing arrives. */
  configured: Schema.Boolean,
});

export const DirectPushUnregisterInput = Schema.Struct({ deviceId: TrimmedNonEmptyString });

export const DirectPushDeliveryResult = Schema.Struct({
  at: Schema.String,
  ok: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export type DirectPushDeliveryResult = typeof DirectPushDeliveryResult.Type;

export const DirectPushDevice = Schema.Struct({
  deviceId: Schema.String,
  label: Schema.String,
  appVersion: Schema.NullOr(Schema.String),
  notificationsEnabled: Schema.Boolean,
  updatedAt: Schema.String,
  lastDelivery: Schema.NullOr(DirectPushDeliveryResult),
});
export type DirectPushDevice = typeof DirectPushDevice.Type;

export const DirectPushServiceAccountStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("not-configured") }),
  Schema.Struct({
    status: Schema.Literal("configured"),
    path: Schema.String,
    projectId: Schema.String,
    clientEmail: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("invalid"),
    path: Schema.String,
    reason: Schema.String,
  }),
]);
export type DirectPushServiceAccountStatus = typeof DirectPushServiceAccountStatus.Type;

export const DirectPushStatus = Schema.Struct({
  serviceAccount: DirectPushServiceAccountStatus,
  devices: Schema.Array(DirectPushDevice),
});
export type DirectPushStatus = typeof DirectPushStatus.Type;

export const DirectPushSetServiceAccountInput = Schema.Struct({
  /** Absolute path to the Firebase service-account JSON on the host; null forgets it. */
  path: Schema.NullOr(TrimmedNonEmptyString),
});

export const DirectPushSendTestInput = Schema.Struct({
  /** Only this device; every registered device when absent. */
  deviceId: Schema.optionalKey(TrimmedNonEmptyString),
});

export const DirectPushSendTestResult = Schema.Struct({
  deliveries: Schema.Array(
    Schema.Struct({
      deviceId: Schema.String,
      label: Schema.String,
      ok: Schema.Boolean,
      error: Schema.NullOr(Schema.String),
    }),
  ),
});
export type DirectPushSendTestResult = typeof DirectPushSendTestResult.Type;
