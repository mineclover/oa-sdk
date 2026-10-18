import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ChunkPlaybackPhase } from "@oa-sdk/chunk-stream-ui";
import type { UseChunkPlaybackOptions, UseChunkPlaybackResult } from "./types.js";
import { formatFramesToTimecode } from "./utils.js";

export function useChunkPlayback(options: UseChunkPlaybackOptions = {}): UseChunkPlaybackResult {
  const {
    bridge,
    streamPackage,
    fps = 30,
    autoPlay = false,
    autoPlayIntervalSec = 4,
    initialFrame,
    initialSlideId,
    mode = "frame",
    onSlideChange,
    onPlaybackChange,
  } = options;

  const slideIndexMap = useMemo(() => {
    const map = new Map<string, { envelope: (typeof streamPackage extends undefined ? never : NonNullable<typeof streamPackage>["envelopes"][number]); index: number }>();
    if (!streamPackage) return map;
    const envelopes = streamPackage.envelopes;
    for (let i = 0; i < envelopes.length; i++) {
      const env = envelopes[i]!;
      const slideId = (env.state as Record<string, unknown> | undefined)?.["slideId"];
      if (typeof slideId === "string") {
        map.set(slideId, { envelope: env, index: i });
      }
    }
    return map;
  }, [streamPackage]);

  const [currentFrame, setCurrentFrame] = useState(() => {
    if (initialFrame !== undefined) return initialFrame;
    if (initialSlideId && streamPackage) {
      const fastHit =
        streamPackage.slideEnvelopeMap?.get(initialSlideId) ??
        slideIndexMap.get(initialSlideId)?.envelope;
      if (fastHit) return fastHit.fromFrame;
    }
    return 0;
  });
  const [displayedFrame, setDisplayedFrame] = useState(currentFrame);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [phase, setPhase] = useState<ChunkPlaybackPhase>("idle");

  const totalFrames = streamPackage?.manifest.totalFrames ?? 300;
  const totalDurationSec = streamPackage?.manifest.totalDurationSec ?? totalFrames / fps;

  const activeChunk = useMemo(() => {
    if (!streamPackage) return undefined;
    return streamPackage.frameMap(currentFrame);
  }, [streamPackage, currentFrame]);

  const currentSlideId = (activeChunk?.state as Record<string, unknown> | undefined)?.["slideId"] as string | undefined;

  // Track changes to bridge state if bridge is present
  useEffect(() => {
    if (!bridge) return;
    setDisplayedFrame(bridge.playback.frame);
    setPhase(bridge.state.phase);
  }, [bridge]);

  // Synchronize playback awareness changes
  useEffect(() => {
    if (currentSlideId && onPlaybackChange) {
      onPlaybackChange({
        slideId: currentSlideId,
        frame: currentFrame,
        isPlaying,
      });
    }
  }, [currentSlideId, currentFrame, isPlaying, onPlaybackChange]);

  const seek = useCallback(
    async (targetFrame: number) => {
      const clamped = Math.max(0, Math.min(targetFrame, Math.max(0, totalFrames - 1)));
      setCurrentFrame(clamped);

      if (streamPackage) {
        const nextChunk = streamPackage.frameMap(clamped);
        const nextSlideId = (nextChunk?.state as Record<string, unknown> | undefined)?.["slideId"] as string | undefined;
        if (nextSlideId && nextSlideId !== currentSlideId) {
          onSlideChange?.(nextSlideId);
        }
      }

      if (bridge) {
        setPhase("preparing");
        const res = await bridge.seek(clamped);
        if (res.status === "completed") {
          setDisplayedFrame(res.playback.frame);
          setPhase("ready");
        } else {
          setPhase("failed");
        }
      } else {
        setDisplayedFrame(clamped);
        setPhase("ready");
      }
    },
    [bridge, streamPackage, totalFrames, currentSlideId, onSlideChange]
  );

  const seekRelative = useCallback(
    async (deltaFrames: number) => {
      await seek(currentFrame + deltaFrames);
    },
    [seek, currentFrame]
  );

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  // Frame ticking loop
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (mode === "slide") {
      const intervalMs = Math.max(500, Math.round(autoPlayIntervalSec * 1000));
      timerRef.current = setInterval(() => {
        if (!streamPackage || streamPackage.envelopes.length === 0) return;
        const envelopes = streamPackage.envelopes;
        const curIdx = currentSlideId ? (slideIndexMap.get(currentSlideId)?.index ?? -1) : -1;
        const nextIdx = curIdx >= 0 && curIdx < envelopes.length - 1 ? curIdx + 1 : 0;
        const nextEnv = envelopes[nextIdx];
        if (nextEnv) {
          seek(nextEnv.fromFrame);
        }
      }, intervalMs);
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }

    const intervalMs = Math.max(16, Math.round(1000 / fps));
    timerRef.current = setInterval(() => {
      setCurrentFrame((prev) => {
        if (prev >= totalFrames - 1) {
          setIsPlaying(false);
          return prev;
        }
        const next = prev + 1;
        if (streamPackage) {
          const chunk = streamPackage.frameMap(next);
          const nextSlide = (chunk?.state as Record<string, unknown> | undefined)?.["slideId"] as string | undefined;
          if (nextSlide && nextSlide !== currentSlideId) {
            onSlideChange?.(nextSlide);
          }
        }
        setDisplayedFrame(next);
        return next;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, fps, totalFrames, streamPackage, currentSlideId, onSlideChange, mode, autoPlayIntervalSec, seek]);

  const timecode = formatFramesToTimecode(currentFrame, fps);

  return {
    currentFrame,
    displayedFrame,
    isPlaying,
    setIsPlaying,
    phase,
    activeChunk,
    currentSlideId,
    totalFrames,
    totalDurationSec,
    timecode,
    play,
    pause,
    togglePlay,
    seek,
    seekRelative,
  };
}
