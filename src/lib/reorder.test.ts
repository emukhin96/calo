import { describe, expect, it } from "vitest";
import { arrangeById, moveId, moveTo } from "./reorder";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe("arrangeById", () => {
  it("строки — в порядке ids", () => {
    expect(ids(arrangeById(rows("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("новые строки — в конце, удалённые и повторы — пропускаются", () => {
    expect(ids(arrangeById(rows("a", "b", "n", "c"), ["c", "gone", "a", "c"]))).toEqual(["c", "a", "b", "n"]);
    expect(ids(arrangeById(rows("a", "b"), []))).toEqual(["a", "b"]);
    expect(arrangeById([], ["a"])).toEqual([]);
  });
});

describe("moveTo / moveId", () => {
  it("переносит на место, остальные сдвигаются", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("выше / ниже; на краю и без такого id — как был", () => {
    expect(moveId(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveId(["a", "b"], "b", 1)).toEqual(["a", "b"]);
    expect(moveId(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });
});
