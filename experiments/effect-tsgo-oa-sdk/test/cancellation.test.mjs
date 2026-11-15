import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { createProfileService } from "../dist/service.js";

test("Effect fiber interruption propagates to generated OA fetch AbortSignal", { timeout: 6000 }, async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  let observedSignal;
  let requestCount = 0;
  let resolveStarted;
  const started = new Promise((resolve) => { resolveStarted = resolve; });

  try {
    globalThis.fetch = (_input, options = {}) => {
      ++requestCount;
      observedSignal = options.signal;
      assert.ok(observedSignal instanceof AbortSignal, "generated OA client must receive an AbortSignal");
      return new Promise((_resolve, reject) => {
        if (observedSignal.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          resolveStarted();
          return;
        }
        observedSignal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
        resolveStarted();
      });
    };

    const effect = createProfileService("http://example.invalid").getProfile("slow");
    assert.equal(requestCount, 0, "Effect must remain lazy before running");
    const running = Effect.runPromiseExit(effect, { signal: controller.signal });
    await started;
    assert.equal(requestCount, 1);
    assert.equal(observedSignal?.aborted, false);
    controller.abort("test-interruption");
    const exit = await running;
    assert.equal(observedSignal.aborted, true, "Effect interruption must abort the HTTP fetch");
    assert.equal(Exit.isFailure(exit), true);
    assert.equal(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause), true);
    assert.equal(requestCount, 1, "Cancellation cannot trigger a retry");
  } finally {
    controller.abort();
    globalThis.fetch = previousFetch;
  }
});
