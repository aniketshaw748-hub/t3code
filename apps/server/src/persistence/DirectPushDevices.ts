import { DirectPushPreferences, type DirectPushDeviceRegistrationInput } from "@t3tools/contracts";
import { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type DirectPushDeviceRepositoryError,
} from "./Errors.ts";

const DeviceRow = Schema.Struct({
  deviceId: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  label: Schema.String,
  appVersion: Schema.NullOr(Schema.String),
  packageName: Schema.String,
  pushToken: Schema.String,
  preferences: Schema.fromJsonString(DirectPushPreferences),
  lastAggregate: Schema.NullOr(Schema.fromJsonString(RelayAgentActivityAggregateState)),
  lastDeliveryAt: Schema.NullOr(Schema.String),
  lastDeliveryOk: Schema.NullOr(Schema.Number),
  lastDeliveryError: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type DirectPushDeviceRecord = typeof DeviceRow.Type;

export class DirectPushDeviceRepository extends Context.Service<
  DirectPushDeviceRepository,
  {
    readonly list: Effect.Effect<
      ReadonlyArray<DirectPushDeviceRecord>,
      DirectPushDeviceRepositoryError
    >;
    /** Upserts by device id; a token another device held moves here, as FCM tokens are per install. */
    readonly upsert: (input: {
      readonly registration: DirectPushDeviceRegistrationInput;
      readonly sessionId: string | null;
      readonly now: string;
    }) => Effect.Effect<void, DirectPushDeviceRepositoryError>;
    readonly remove: (deviceId: string) => Effect.Effect<void, DirectPushDeviceRepositoryError>;
    readonly removeForSession: (
      sessionId: string,
    ) => Effect.Effect<void, DirectPushDeviceRepositoryError>;
    /** Forgets a token FCM reported UNREGISTERED, unless the device re-registered a new one. */
    readonly removeToken: (input: {
      readonly deviceId: string;
      readonly pushToken: string;
    }) => Effect.Effect<void, DirectPushDeviceRepositoryError>;
    readonly markDelivery: (input: {
      readonly deviceId: string;
      readonly at: string;
      readonly ok: boolean;
      readonly error: string | null;
      /** Undefined keeps the stored baseline; failed sends never move it. */
      readonly aggregate?: RelayAgentActivityAggregateState | null;
    }) => Effect.Effect<void, DirectPushDeviceRepositoryError>;
  }
>()("t3/persistence/DirectPushDevices/DirectPushDeviceRepository") {}

const sqlError = (operation: string) => (cause: unknown) =>
  new PersistenceSqlError({ operation, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: DeviceRow,
    execute: () => sql`
      SELECT
        device_id AS "deviceId",
        session_id AS "sessionId",
        label,
        app_version AS "appVersion",
        package_name AS "packageName",
        push_token AS "pushToken",
        preferences_json AS "preferences",
        last_aggregate_json AS "lastAggregate",
        last_delivery_at AS "lastDeliveryAt",
        last_delivery_ok AS "lastDeliveryOk",
        last_delivery_error AS "lastDeliveryError",
        updated_at AS "updatedAt"
      FROM direct_push_devices
      ORDER BY created_at
    `,
  });
  const encodePreferences = Schema.encodeEffect(Schema.fromJsonString(DirectPushPreferences));
  const encodeAggregate = Schema.encodeEffect(
    Schema.NullOr(Schema.fromJsonString(RelayAgentActivityAggregateState)),
  );
  const encodeError = (cause: Schema.SchemaError) =>
    PersistenceDecodeError.fromSchemaError("DirectPushDevice", cause);

  return DirectPushDeviceRepository.of({
    list: listRows(undefined).pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError((cause) =>
        Schema.isSchemaError(cause)
          ? PersistenceDecodeError.fromSchemaError("DirectPushDevice", cause)
          : new PersistenceSqlError({ operation: "listDirectPushDevices", cause }),
      ),
      Effect.withSpan("DirectPushDeviceRepository.list"),
    ),
    upsert: Effect.fn("DirectPushDeviceRepository.upsert")(function* (input) {
      const registration = input.registration;
      const preferencesJson = yield* encodePreferences(registration.preferences).pipe(
        Effect.mapError(encodeError),
      );
      yield* sql`
        DELETE FROM direct_push_devices
        WHERE push_token = ${registration.pushToken} AND device_id <> ${registration.deviceId}
      `.pipe(Effect.mapError(sqlError("claimDirectPushToken")));
      yield* sql`
        INSERT INTO direct_push_devices (
          device_id, session_id, label, platform, app_version, android_api_level, package_name,
          push_token, preferences_json, created_at, updated_at
        ) VALUES (
          ${registration.deviceId}, ${input.sessionId}, ${registration.label},
          ${registration.platform}, ${registration.appVersion ?? null},
          ${registration.androidApiLevel ?? null}, ${registration.packageName},
          ${registration.pushToken}, ${preferencesJson},
          ${input.now}, ${input.now}
        )
        ON CONFLICT (device_id) DO UPDATE SET
          session_id = excluded.session_id,
          label = excluded.label,
          platform = excluded.platform,
          app_version = excluded.app_version,
          android_api_level = excluded.android_api_level,
          package_name = excluded.package_name,
          push_token = excluded.push_token,
          preferences_json = excluded.preferences_json,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError(sqlError("upsertDirectPushDevice")));
    }),
    remove: Effect.fn("DirectPushDeviceRepository.remove")(function* (deviceId) {
      yield* sql`DELETE FROM direct_push_devices WHERE device_id = ${deviceId}`.pipe(
        Effect.mapError(sqlError("removeDirectPushDevice")),
      );
    }),
    removeForSession: Effect.fn("DirectPushDeviceRepository.removeForSession")(
      function* (sessionId) {
        yield* sql`DELETE FROM direct_push_devices WHERE session_id = ${sessionId}`.pipe(
          Effect.mapError(sqlError("removeDirectPushDevicesForSession")),
        );
      },
    ),
    removeToken: Effect.fn("DirectPushDeviceRepository.removeToken")(function* (input) {
      yield* sql`
        DELETE FROM direct_push_devices
        WHERE device_id = ${input.deviceId} AND push_token = ${input.pushToken}
      `.pipe(Effect.mapError(sqlError("removeDirectPushToken")));
    }),
    markDelivery: Effect.fn("DirectPushDeviceRepository.markDelivery")(function* (input) {
      const ok = input.ok ? 1 : 0;
      if (input.aggregate === undefined) {
        return yield* sql`
          UPDATE direct_push_devices
          SET last_delivery_at = ${input.at}, last_delivery_ok = ${ok},
            last_delivery_error = ${input.error}
          WHERE device_id = ${input.deviceId}
        `.pipe(Effect.asVoid, Effect.mapError(sqlError("markDirectPushDelivery")));
      }
      const aggregate = yield* encodeAggregate(input.aggregate).pipe(Effect.mapError(encodeError));
      yield* sql`
        UPDATE direct_push_devices
        SET last_delivery_at = ${input.at}, last_delivery_ok = ${ok},
          last_delivery_error = ${input.error}, last_aggregate_json = ${aggregate}
        WHERE device_id = ${input.deviceId}
      `.pipe(Effect.mapError(sqlError("markDirectPushDelivery")));
    }),
  });
});

export const layer = Layer.effect(DirectPushDeviceRepository, make);
