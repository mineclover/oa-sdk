import type { IncomingMessage } from "node:http";

/** A request body read under a size limit. */
export type BoundedBody =
  | { readonly kind: "ok"; readonly body: Buffer }
  | {
      readonly kind: "too-large";
      /** Bytes received before the read stopped. */
      readonly receivedBytes: number;
      /**
       * True when the whole body was read (and discarded past the limit), so a response can still
       * be delivered. False when the body went past the drain limit and the request was destroyed.
       */
      readonly drained: boolean;
    };

/** The rejection of a read whose request was destroyed or aborted before its body ended. */
export const BODY_ABORTED = "BODY_ABORTED";
/**
 * The rejection of a read whose body (or part of it) had already been handed to another reader,
 * such as a hook that read it before the endpoint: what is left is not the body the client sent.
 */
export const BODY_CONSUMED = "BODY_CONSUMED";

/** True for the rejection {@link readBoundedBody} gives a body another reader consumed. */
export function isBodyConsumedError(error: unknown): boolean {
  return error instanceof Error && error.message === BODY_CONSUMED;
}

/** How much of an oversized body is read and discarded, as a multiple of its limit. */
const DRAIN_LIMIT_FACTOR = 16;

/**
 * Reads a request body of at most `maxBytes`. A larger body is not buffered past the limit, but
 * its remainder is still read and discarded (up to `drainLimitBytes` in total): a server that stops
 * reading a request mid-body makes Node reset the connection, and the client then sees EPIPE or
 * ECONNRESET instead of the error response. A body beyond the drain limit is cut off by destroying
 * the request. Rejects with {@link BODY_ABORTED}, or the request's error, when the request errors
 * or is aborted before it ends.
 *
 * The request's current state is checked first, because a stream that already ended or was
 * destroyed never emits another event, and a body another reader took is gone:
 *   - a request any of whose body was already read (`readableDidRead`, e.g. by a hook that ran
 *     before the endpoint) rejects with {@link BODY_CONSUMED}: what remains is not the body the
 *     client sent, and treating it as empty or whole would make the endpoint act on a body nobody
 *     sent. Its unread remainder is drained first (within the drain limit), so the request has
 *     ended and a response can still be delivered; past the drain limit it is destroyed;
 *   - a request that ended without any of its body being read had an empty body;
 *   - a request already destroyed rejects with {@link BODY_ABORTED}.
 * A request a hook paused is resumed.
 */
export function readBoundedBody(
  req: IncomingMessage,
  maxBytes: number,
  drainLimitBytes = maxBytes * DRAIN_LIMIT_FACTOR,
): Promise<BoundedBody> {
  const consumed = req.readableDidRead;
  // Ended first: a request read to its end may also be destroyed afterwards (autoDestroy).
  if (req.readableEnded) {
    return consumed
      ? Promise.reject(new Error(BODY_CONSUMED))
      : Promise.resolve({ kind: "ok", body: Buffer.alloc(0) });
  }
  if (req.destroyed) return Promise.reject(new Error(consumed ? BODY_CONSUMED : BODY_ABORTED));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let tooLarge = false;
    let settled = false;

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
      finish();
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      received += buffer.length;
      // The remainder of a consumed body is only drained: none of it is kept.
      if (!consumed && !tooLarge) {
        if (received <= maxBytes) {
          chunks.push(buffer);
          return;
        }
        tooLarge = true;
        chunks.length = 0;
      }
      if (received > drainLimitBytes) {
        settle(() =>
          consumed
            ? reject(new Error(BODY_CONSUMED))
            : resolve({ kind: "too-large", receivedBytes: received, drained: false }),
        );
        req.destroy();
      }
    };
    const onEnd = () =>
      settle(() => {
        if (consumed) reject(new Error(BODY_CONSUMED));
        else if (tooLarge) resolve({ kind: "too-large", receivedBytes: received, drained: true });
        else resolve({ kind: "ok", body: Buffer.concat(chunks) });
      });
    const onError = (error: Error) => settle(() => reject(consumed ? new Error(BODY_CONSUMED) : error));
    const onClose = () => settle(() => reject(new Error(consumed ? BODY_CONSUMED : BODY_ABORTED)));

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
    // Attaching a 'data' listener does not restart a stream a hook paused.
    req.resume();
  });
}
