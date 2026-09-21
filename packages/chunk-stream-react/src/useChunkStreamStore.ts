import { useSyncExternalStore } from "react";
import type { ChunkStreamStore, ChunkStreamState } from "@oa-sdk/chunk-stream";

/**
 * React hook that subscribes to a reactive ChunkStreamStore via useSyncExternalStore.
 */
export function useChunkStreamStore<TItem = unknown>(
  store: ChunkStreamStore<TItem>
): ChunkStreamState<TItem> {
  return useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  );
}
