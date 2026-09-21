import { describe, it, expect } from "vitest";
import {
  mergeCrdtCue,
  mergeVectorClocks,
  filterMissingDeltas,
  compareCrdtMetadata,
  CrdtDeltaAdapter,
  createCrdtDeltaAdapter,
  FORMAT_CRDT_DELTA,
  type CrdtCue,
} from "../src/index.js";

function makeCue(
  id: string,
  updatedAt: number,
  clientId: string,
  options: {
    trackId?: string;
    fromFrame?: number;
    toFrame?: number;
    tombstone?: boolean;
    seq?: number;
    val?: string;
  } = {}
): CrdtCue<{ val?: string }> {
  return {
    id,
    trackId: options.trackId ?? "track-crdt",
    fromFrame: options.fromFrame ?? 0,
    toFrame: options.toFrame ?? 100,
    payload: {
      val: options.val ?? "default",
      crdt: {
        updatedAt,
        clientId,
        tombstone: options.tombstone,
        seq: options.seq,
      },
    },
  };
}

describe("@oa-sdk/chunk-stream-crdt Semi-Lattice Laws", () => {
  it("satisfies Idempotence: A ⊔ A === A", () => {
    const a = makeCue("cue-1", 100, "client-a", { val: "alpha" });
    const merged = mergeCrdtCue(a, a);
    expect(merged).toBe(a);
  });

  it("satisfies Commutativity: A ⊔ B === B ⊔ A", () => {
    const a = makeCue("cue-1", 100, "client-a", { val: "alpha" });
    const b = makeCue("cue-1", 200, "client-b", { val: "beta" });

    const ab = mergeCrdtCue(a, b);
    const ba = mergeCrdtCue(b, a);

    expect(ab).toBe(ba);
    expect(ab.payload.val).toBe("beta");
  });

  it("satisfies Associativity: (A ⊔ B) ⊔ C === A ⊔ (B ⊔ C)", () => {
    const a = makeCue("cue-1", 100, "client-a", { val: "alpha" });
    const b = makeCue("cue-1", 200, "client-b", { val: "beta" });
    const c = makeCue("cue-1", 300, "client-c", { val: "gamma" });

    const ab_c = mergeCrdtCue(mergeCrdtCue(a, b), c);
    const a_bc = mergeCrdtCue(a, mergeCrdtCue(b, c));

    expect(ab_c).toEqual(a_bc);
    expect(ab_c.payload.val).toBe("gamma");
  });

  it("correctly applies total ordering tie-breakers (timestamp -> clientId -> tombstone -> seq)", () => {
    // 1. Timestamp wins
    const t1 = makeCue("x", 100, "client-z");
    const t2 = makeCue("x", 101, "client-a");
    expect(mergeCrdtCue(t1, t2)).toBe(t2);

    // 2. ClientId wins on tie
    const c1 = makeCue("x", 100, "client-a");
    const c2 = makeCue("x", 100, "client-b");
    expect(mergeCrdtCue(c1, c2)).toBe(c2);

    // 3. Tombstone wins on tie
    const alive = makeCue("x", 100, "client-a", { tombstone: false });
    const dead = makeCue("x", 100, "client-a", { tombstone: true });
    expect(mergeCrdtCue(alive, dead)).toBe(dead);

    // 4. Seq wins on tie
    const s1 = makeCue("x", 100, "client-a", { seq: 1 });
    const s2 = makeCue("x", 100, "client-a", { seq: 2 });
    expect(mergeCrdtCue(s1, s2)).toBe(s2);
  });
});

describe("@oa-sdk/chunk-stream-crdt Vector Clocks", () => {
  it("merges vector clocks by pointwise maximum", () => {
    const vc1 = { alice: 3, bob: 5 };
    const vc2 = { bob: 7, charlie: 2 };
    const merged = mergeVectorClocks(vc1, vc2);

    expect(merged).toEqual({
      alice: 3,
      bob: 7,
      charlie: 2,
    });
  });

  it("filters out operations already observed according to known vector clock", () => {
    const known = { alice: 5, bob: 2 };
    const deltas = [
      { clientId: "alice", lamport: 4, op: "noop" },
      { clientId: "alice", lamport: 6, op: "insert" },
      { clientId: "bob", lamport: 2, op: "delete" },
      { clientId: "charlie", lamport: 1, op: "update" },
    ];

    const missing = filterMissingDeltas(deltas, known);
    expect(missing).toEqual([
      { clientId: "alice", lamport: 6, op: "insert" },
      { clientId: "charlie", lamport: 1, op: "update" },
    ]);
  });
});

describe("@oa-sdk/chunk-stream-crdt CrdtDeltaAdapter", () => {
  it("manages cue lifecycles, frame evaluation, and compaction horizon", () => {
    const adapter = createCrdtDeltaAdapter({ clientId: "local-node" });
    expect(adapter.payloadFormat).toBe(FORMAT_CRDT_DELTA);

    // Ingest cues
    adapter.applyCue(makeCue("box-1", 100, "peer-1", { fromFrame: 10, toFrame: 50, val: "init" }));
    adapter.applyCue(makeCue("box-2", 110, "peer-1", { fromFrame: 30, toFrame: 80, val: "rect" }));

    expect(adapter.size).toBe(2);
    expect(adapter.cues.length).toBe(2);

    // Frame evaluation
    expect(adapter.evaluateFrame(5)).toHaveLength(0);
    expect(adapter.evaluateFrame(20)).toHaveLength(1);
    expect(adapter.evaluateFrame(40)).toHaveLength(2);
    expect(adapter.evaluateFrame(70)).toHaveLength(1);

    // Update cue with higher timestamp
    adapter.applyCue(makeCue("box-1", 150, "peer-2", { fromFrame: 10, toFrame: 50, val: "updated" }));
    const activeAt20 = adapter.evaluateFrame(20);
    expect(activeAt20[0]?.payload.val).toBe("updated");

    // Soft delete (tombstone)
    adapter.applyCue(makeCue("box-1", 200, "peer-1", { fromFrame: 10, toFrame: 50, tombstone: true }));
    expect(adapter.evaluateFrame(20)).toHaveLength(0);
    expect(adapter.tombstones).toHaveLength(1);
    expect(adapter.cues).toHaveLength(1); // only box-2 is active

    // Compaction Horizon GC
    const purged = adapter.compact("track-crdt", 200);
    expect(purged).toBe(1);
    expect(adapter.tombstones).toHaveLength(0);
    expect(adapter.size).toBe(1);

    // Straggler defense: late-arriving delta with timestamp <= horizon is rejected
    const straggler = makeCue("box-1", 199, "straggler-peer", { val: "zombie resurrection attempt" });
    const applied = adapter.applyCue(straggler);
    expect(applied).toBe(false);
    expect(adapter.evaluateFrame(20)).toHaveLength(0); // box-1 remains eliminated
  });
});
