import { describe, expect, it } from "vitest";
import { comparePatch, isOlderSetupPatch, parsePatch, patchChangeKind, shouldDrawLineByDefault } from "./patch";

describe("parsePatch", () => {
  it("parses full and partial versions", () => {
    expect(parsePatch("1.3.4")).toEqual([1, 3, 4]);
    expect(parsePatch("1.3")).toEqual([1, 3, 0]);
    expect(parsePatch("2")).toEqual([2, 0, 0]);
    expect(parsePatch("v1.3.4")).toEqual([1, 3, 4]);
    expect(parsePatch("1.3.4 (wet)")).toEqual([1, 3, 4]);
  });
  it("returns null for junk / empty", () => {
    expect(parsePatch("GMR001")).toBeNull();
    expect(parsePatch("")).toBeNull();
    expect(parsePatch(null)).toBeNull();
  });
});

describe("comparePatch", () => {
  it("orders by version then patch then hotfix", () => {
    expect(comparePatch("1.3.4", "1.3.5")).toBe(-1);
    expect(comparePatch("1.3.4", "1.4.0")).toBe(-1);
    expect(comparePatch("1.3.4", "2.0.0")).toBe(-1);
    expect(comparePatch("1.4.0", "1.3.9")).toBe(1);
    expect(comparePatch("1.3.4", "1.3.4")).toBe(0);
  });
  it("returns null when either side is unparseable", () => {
    expect(comparePatch("GMR001", "1.3.4")).toBeNull();
    expect(comparePatch("1.3.4", null)).toBeNull();
  });
});

describe("patchChangeKind / shouldDrawLineByDefault", () => {
  it("classifies the changed tier", () => {
    expect(patchChangeKind("1.3.4", "1.3.5")).toBe("hotfix");
    expect(patchChangeKind("1.3.4", "1.4.0")).toBe("patch");
    expect(patchChangeKind("1.3.4", "2.0.0")).toBe("version");
    expect(patchChangeKind("1.3.4", "1.3.4")).toBe("same");
    expect(patchChangeKind(null, "1.3.4")).toBe("version"); // first-ever
    expect(patchChangeKind("1.3.4", "GMR001")).toBe("unknown");
  });
  it("defaults to drawing a line only for version/patch bumps", () => {
    expect(shouldDrawLineByDefault("1.3.4", "1.3.5")).toBe(false); // hotfix
    expect(shouldDrawLineByDefault("1.3.4", "1.4.0")).toBe(true); // patch
    expect(shouldDrawLineByDefault("1.3.4", "2.0.0")).toBe(true); // version
    expect(shouldDrawLineByDefault("1.3.4", "1.3.4")).toBe(false); // no change
  });
});

describe("isOlderSetupPatch", () => {
  it("flags a setup built on an earlier patch than the current one", () => {
    expect(isOlderSetupPatch("1.2.9", "1.3.4")).toBe(true);
    expect(isOlderSetupPatch("1.3.4", "1.3.4")).toBe(false); // same
    expect(isOlderSetupPatch("1.3.5", "1.3.4")).toBe(false); // newer (odd, but not "older")
    expect(isOlderSetupPatch("GMR001", "1.3.4")).toBe(false); // unparseable → no flag
    expect(isOlderSetupPatch("1.2.9", null)).toBe(false); // no current patch → no flag
  });
});
