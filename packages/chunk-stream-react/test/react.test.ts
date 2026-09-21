import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  formatSecondsToTimecode,
  formatFramesToTimecode,
  formatBytes,
  usePlaybackAwareness,
  useChunkTelemetry,
  useChunkPlayback,
  type AwarenessPresence,
} from "../src/index.js";
import { ResidencyController } from "@oa-sdk/chunk-stream";
import { storyboardToChunkStream } from "@oa-sdk/chunk-stream-ui";

describe("@oa-sdk/chunk-stream-react Formatting Utilities", () => {
  it("formats seconds into MM:SS and HH:MM:SS timecodes", () => {
    expect(formatSecondsToTimecode(0)).toBe("00:00");
    expect(formatSecondsToTimecode(65)).toBe("01:05");
    expect(formatSecondsToTimecode(3665)).toBe("01:01:05");
    expect(formatSecondsToTimecode(-5)).toBe("00:00");
  });

  it("formats frames into precise timecode strings with frame decimals", () => {
    expect(formatFramesToTimecode(0, 30)).toBe("00:00.00");
    expect(formatFramesToTimecode(45, 30)).toBe("00:01.15"); // 45 / 30 = 1.5s = 00:01 + 15 frames
    expect(formatFramesToTimecode(1805, 30)).toBe("01:00.05"); // 1805 / 30 = 60.166s = 01:00 + 5 frames
    expect(formatFramesToTimecode(108005, 30)).toBe("01:00:00.05"); // 1 hr + 5 frames
  });

  it("formats byte values into human-readable strings", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1048576 * 5.5)).toBe("5.5 MB");
  });
});

describe("@oa-sdk/chunk-stream-react Hooks", () => {
  it("usePlaybackAwareness filters peers by frame and slide", () => {
    let captured: any = null;

    const peers: AwarenessPresence[] = [
      { clientId: "peer_1", name: "Alice", color: "#f00", playback: { slideId: "slide_a", frame: 10, isPlaying: true } },
      { clientId: "peer_2", name: "Bob", color: "#0f0", playback: { slideId: "slide_b", frame: 50, isPlaying: false } },
      { clientId: "peer_3", name: "Charlie", color: "#00f", playback: { slideId: "slide_a", frame: 20, isPlaying: true } },
    ];

    function TestComponent() {
      captured = usePlaybackAwareness({
        peers,
        currentFrame: 10,
        currentSlideId: "slide_a",
        isPlaying: true,
      });
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    expect(captured).not.toBeNull();
    expect(captured.peers).toHaveLength(3);
    expect(captured.peersOnCurrentFrame).toHaveLength(1);
    expect(captured.peersOnCurrentFrame[0].clientId).toBe("peer_1");
    expect(captured.peersOnCurrentSlide).toHaveLength(2);
    expect(captured.peerColorMap["peer_1"]).toBe("#f00");
    expect(captured.peerColorMap["peer_2"]).toBe("#0f0");

    act(() => {
      root.unmount();
    });
  });

  it("useChunkTelemetry provides live memory residency and manifest metrics", () => {
    let captured: any = null;
    const residency = new ResidencyController();
    residency.prepare({ id: "res_x", type: "texture", byteLength: 1024 * 1024 * 2 });
    residency.acquire("res_x", 1024 * 1024 * 2);

    function TestComponent() {
      captured = useChunkTelemetry({
        residency,
        manifest: {
          schemaVersion: 1,
          streamId: "stream_test",
          revision: "rev_1",
          fps: 30,
          totalFrames: 120,
          totalDurationSec: 4.0,
          chunkCount: 2,
          chunks: [],
        },
      });
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    expect(captured).not.toBeNull();
    expect(captured.residentBytes).toBe(1024 * 1024 * 2);
    expect(captured.residentFormatted).toBe("2.0 MB");
    expect(captured.chunkCount).toBe(2);
    expect(captured.totalDurationSec).toBe(4.0);

    act(() => {
      root.unmount();
    });
  });

  it("useChunkPlayback handles seek, initialSlideId, and togglePlay", async () => {
    let captured: any = null;
    const doc = {
      id: "doc_test",
      name: "Doc Test",
      slides: [
        { id: "s1", name: "Slide 1", mediaTimecode: { startTime: 0, endTime: 2 }, nodes: [] },
        { id: "s2", name: "Slide 2", mediaTimecode: { startTime: 2, endTime: 5 }, nodes: [] },
      ],
    };
    const streamPackage = storyboardToChunkStream(doc as any, { fps: 30 });

    function TestComponent() {
      captured = useChunkPlayback({
        streamPackage,
        fps: 30,
        initialSlideId: "s2",
        mode: "slide",
      });
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    expect(captured).not.toBeNull();
    expect(captured.currentFrame).toBe(150); // slide 2 begins at frame 150
    expect(captured.currentSlideId).toBe("s2");
    expect(captured.isPlaying).toBe(false);

    // Toggle play
    act(() => {
      captured.togglePlay();
    });
    expect(captured.isPlaying).toBe(true);

    // Seek to frame 10 (slide 1)
    await act(async () => {
      await captured.seek(10);
    });
    expect(captured.currentFrame).toBe(10);
    expect(captured.currentSlideId).toBe("s1");

    act(() => {
      root.unmount();
    });
  });
});
