import { describe, expect, it } from "vitest";
import type { Snapshot, Update } from "../src/shared/protocol.js";
import { reduce, type StreamState } from "../src/web/v2/state/sessionStream.js";

const session = { id: "s1", title: "t", status: "idle", updatedAt: "2026-10-07" };
const snapshot: Snapshot = {
  version: 1,
  session,
  cursor: { seq: 10, hash: "a" },
  rows: [{ id: "r1", seq: 1, kind: "user", title: "", text: "一", refs: [] }],
  totalRows: 1,
};
const update = (seq: number, text: string): Update => ({
  version: 1,
  session,
  cursor: { seq, hash: `h${seq}` },
  rows: [{ id: `r${seq}`, seq, kind: "assistant", title: "", text, refs: [] }],
});

describe("v2 session stream reducer", () => {
  it("快照建立投影，增量按 id 合并", () => {
    let state: StreamState = { status: "connecting" };
    state = reduce(state, { type: "snapshot", snapshot });
    state = reduce(state, { type: "update", update: update(11, "二") });
    expect(state.snapshot?.rows.map((row: { text: string }) => row.text)).toEqual(["一", "二"]);
    expect(state.snapshot?.cursor.seq).toBe(11);
  });

  it("重复/迟到 cursor 被丢弃，不回退投影", () => {
    let state: StreamState = { status: "connecting" };
    state = reduce(state, { type: "snapshot", snapshot });
    state = reduce(state, { type: "update", update: update(12, "新") });
    const stale: Update = {
      ...update(9, "旧"),
      rows: [{ id: "r1", seq: 1, kind: "user", title: "", text: "篡改", refs: [] }],
    };
    const next = reduce(state, { type: "update", update: stale });
    expect(next).toBe(state);
  });

  it("同一 seq 的重复投递幂等", () => {
    let state: StreamState = { status: "connecting" };
    state = reduce(state, { type: "snapshot", snapshot });
    state = reduce(state, { type: "update", update: update(11, "二") });
    state = reduce(state, { type: "update", update: update(11, "二") });
    expect(state.snapshot?.rows).toHaveLength(2);
  });

  it("reset 显式清空投影，等待新快照而不是本地拼接", () => {
    let state: StreamState = { status: "connecting" };
    state = reduce(state, { type: "snapshot", snapshot });
    state = reduce(state, { type: "reset" });
    expect(state.snapshot).toBeUndefined();
    expect(state.status).toBe("connecting");
    // reset 后到达的增量不被应用（无快照基线）
    state = reduce(state, { type: "update", update: update(11, "二") });
    expect(state.snapshot).toBeUndefined();
  });
});
