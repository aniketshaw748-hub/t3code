import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const FCM_HTTP_STAGE_TIMEOUT = "10 seconds";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_DATA_LIMIT_BYTES = 4096;

export const FcmServiceAccount = Schema.Struct({
  project_id: Schema.NonEmptyString,
  client_email: Schema.NonEmptyString,
  private_key: Schema.NonEmptyString,
});
export type FcmServiceAccount = typeof FcmServiceAccount.Type;
export const decodeFcmServiceAccountJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(FcmServiceAccount),
);

const decodeAccessToken = Schema.decodeUnknownEffect(
  Schema.Struct({ access_token: Schema.NonEmptyString }),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeFcmError = Schema.decodeUnknownOption(
  Schema.Struct({
    error: Schema.Struct({
      status: Schema.optional(Schema.String),
      details: Schema.optional(
        Schema.Array(
          Schema.Struct({
            "@type": Schema.optional(Schema.String),
            errorCode: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  }),
);

export class FcmClientError extends Schema.TaggedError<FcmClientError>()("FcmClientError", {
  operation: Schema.Literals(["configuration", "authorize", "send"]),
  status: Schema.NullOr(Schema.Number),
  reason: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `FCM ${this.operation} failed${this.status === null ? "" : ` (${this.status})`}${
      this.reason ? `: ${this.reason}` : ""
    }.`;
  }
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export interface FcmAssertionInput {
  readonly privateKey: string;
  readonly clientEmail: string;
  readonly issuedAt: number;
}

/** RS256 JWT for Google's OAuth2 JWT bearer grant, scoped to FCM sends. */
export async function signFcmAssertion(
  subtle: SubtleCrypto,
  input: FcmAssertionInput,
): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(encodeJson({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(
    encoder.encode(
      encodeJson({
        iss: input.clientEmail,
        scope: FCM_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: input.issuedAt,
        exp: input.issuedAt + 3600,
      }),
    ),
  );
  const pem = input.privateKey.replace(/-----[^-]+-----|\s/g, "");
  const key = await subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

export interface FcmSendInput {
  readonly token: string;
  readonly packageName: string | null;
  readonly data: Readonly<Record<string, string>>;
  readonly alert: boolean;
}

function fcmMessageBody(input: FcmSendInput) {
  return {
    message: {
      token: input.token,
      data: input.data,
      android: {
        priority: "HIGH",
        ttl: "300s",
        ...(!input.alert ? { collapse_key: "t3-agent-activity" } : {}),
        ...(input.packageName ? { restricted_package_name: input.packageName } : {}),
      },
    },
  };
}

export interface FcmSender {
  readonly send: (
    input: FcmSendInput,
  ) => Effect.Effect<{ readonly unregistered: boolean }, FcmClientError>;
}

/** FCM HTTP v1 sender with a cached OAuth token; `account` null fails every send as unconfigured. */
export const makeFcmSender = Effect.fnUntraced(function* <E>(input: {
  readonly account: FcmServiceAccount | null;
  readonly signAssertion: (assertion: FcmAssertionInput) => Effect.Effect<string, E>;
}) {
  const client = yield* HttpClient.HttpClient;
  const account = input.account;
  const authorize = Effect.gen(function* () {
    if (account === null)
      return yield* new FcmClientError({ operation: "configuration", status: null });
    const now = yield* DateTime.now;
    const assertion = yield* input
      .signAssertion({
        privateKey: account.private_key,
        clientEmail: account.client_email,
        issuedAt: Math.floor(now.epochMilliseconds / 1000),
      })
      .pipe(
        Effect.mapError(
          (cause) => new FcmClientError({ operation: "authorize", status: null, cause }),
        ),
      );
    const response = yield* client
      .execute(
        HttpClientRequest.post(GOOGLE_TOKEN_URL).pipe(
          HttpClientRequest.bodyUrlParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion,
          }),
        ),
      )
      .pipe(
        Effect.timeout(FCM_HTTP_STAGE_TIMEOUT),
        Effect.mapError(
          (cause) => new FcmClientError({ operation: "authorize", status: null, cause }),
        ),
      );
    if (response.status !== 200)
      return yield* new FcmClientError({ operation: "authorize", status: response.status });
    return yield* response.json.pipe(
      Effect.timeout(FCM_HTTP_STAGE_TIMEOUT),
      Effect.flatMap(decodeAccessToken),
      Effect.map((body) => body.access_token),
      Effect.mapError(
        (cause) => new FcmClientError({ operation: "authorize", status: response.status, cause }),
      ),
    );
  });
  const [accessToken, invalidateToken] = yield* Effect.cachedInvalidateWithTTL(
    authorize,
    "50 minutes",
  );

  const sender: FcmSender = {
    send: Effect.fn("fcm.send")(function* (message) {
      if (new TextEncoder().encode(encodeJson(message.data)).length > FCM_DATA_LIMIT_BYTES)
        return yield* new FcmClientError({
          operation: "send",
          status: null,
          reason: "payload too large",
        });
      if (account === null)
        return yield* new FcmClientError({ operation: "configuration", status: null });
      const token = yield* accessToken.pipe(Effect.tapError(() => invalidateToken));
      const response = yield* HttpClientRequest.post(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      ).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.bodyJson(fcmMessageBody(message)),
        Effect.flatMap(client.execute),
        Effect.timeout(FCM_HTTP_STAGE_TIMEOUT),
        Effect.mapError((cause) => new FcmClientError({ operation: "send", status: null, cause })),
      );
      if (response.status >= 200 && response.status < 300) return { unregistered: false };
      if (response.status === 401) yield* invalidateToken;
      const body = yield* response.json.pipe(
        Effect.timeout(FCM_HTTP_STAGE_TIMEOUT),
        Effect.mapError(
          (cause) => new FcmClientError({ operation: "send", status: response.status, cause }),
        ),
      );
      const decoded = decodeFcmError(body);
      const errorCode = Option.isSome(decoded)
        ? decoded.value.error.details?.find(
            (detail) => detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError",
          )?.errorCode
        : undefined;
      if (errorCode === "UNREGISTERED") return { unregistered: true };
      const reason = errorCode ?? (Option.isSome(decoded) ? decoded.value.error.status : undefined);
      return yield* new FcmClientError({
        operation: "send",
        status: response.status,
        ...(reason ? { reason } : {}),
      });
    }),
  };
  return sender;
});
