import { useMemo, useEffect } from "react";
import type {
  AwarenessPresence,
  UsePlaybackAwarenessOptions,
  UsePlaybackAwarenessResult,
} from "./types.js";

export function usePlaybackAwareness(
  options: UsePlaybackAwarenessOptions
): UsePlaybackAwarenessResult {
  const { peers, currentFrame, currentSlideId, isPlaying, broadcast } = options;

  const resolvedPeers = useMemo<readonly AwarenessPresence[]>(() => {
    if (typeof peers === "function") {
      return peers() ?? [];
    }
    if (Array.isArray(peers)) {
      return peers;
    }
    return [];
  }, [peers]);

  // Broadcast current playhead position to peers
  useEffect(() => {
    if (currentSlideId && broadcast) {
      broadcast({
        slideId: currentSlideId,
        frame: currentFrame,
        isPlaying,
      });
    }
  }, [currentSlideId, currentFrame, isPlaying, broadcast]);

  const peersOnCurrentFrame = useMemo(() => {
    return resolvedPeers.filter((p) => p.playback?.frame === currentFrame);
  }, [resolvedPeers, currentFrame]);

  const peersOnCurrentSlide = useMemo(() => {
    if (!currentSlideId) return [];
    return resolvedPeers.filter((p) => p.playback?.slideId === currentSlideId);
  }, [resolvedPeers, currentSlideId]);

  const peerColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of resolvedPeers) {
      const color = p.color ?? p.user?.color;
      if (color) {
        map[p.clientId] = color;
      }
    }
    return map;
  }, [resolvedPeers]);

  return {
    peers: resolvedPeers,
    peersOnCurrentFrame,
    peersOnCurrentSlide,
    peerColorMap,
  };
}
