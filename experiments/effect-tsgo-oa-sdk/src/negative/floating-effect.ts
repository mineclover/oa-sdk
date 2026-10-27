import { Effect } from "effect";

/** Intentionally wrong: the Effect value is thrown away instead of being run. */
export function skippedSideEffect(): void {
  Effect.sync(() => console.info("This callback is never executed."));
}
