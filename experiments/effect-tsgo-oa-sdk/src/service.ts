import { Effect } from "effect";
import { createClient } from "./api/client.js";
import { ProfileSchema } from "./api/schemas.js";
import type { Profile } from "./api/types.js";

/** Application-owned error: OA SDK provides the wire error, Effect owns execution failure. */
export class ProfileTransportError extends Error {
  readonly _tag = "ProfileTransportError" as const;
  constructor(readonly profileId: string, readonly original: unknown) {
    super(`Profile request failed: ${profileId}`);
  }
}

export class ProfilePayloadError extends Error {
  readonly _tag = "ProfilePayloadError" as const;
  constructor(readonly profileId: string, readonly original: unknown) {
    super(`Profile response failed contract validation: ${profileId}`);
  }
}

/**
 * OA SDK owns generated request, response and Zod contracts.
 * Effect owns when the request runs, failure channels and lifecycle composition.
 * Generated files are overwritten by oa-gen; do not edit them to satisfy a diagnostic.
 */
export function createProfileService(baseUrl: string) {
  const client = createClient({ baseUrl, retry: { maxRetries: 0, baseDelay: 1000 } });
  return {
    getProfile: (profileId: string) =>
      Effect.tryPromise({
        try: () => client.getProfile({ profileId }),
        catch: (original) => new ProfileTransportError(profileId, original)
      }).pipe(
        Effect.flatMap((payload) =>
          Effect.try({
            try: (): Profile => ProfileSchema.parse(payload),
            catch: (original) => new ProfilePayloadError(profileId, original)
          })
        )
      )
  };
}
