import { describe, expect, it } from "vitest";
import {
  comparePatch,
  isOlderSetupPatch,
  isSetupPatchStale,
  newestPatchIn,
  normalizeSheetPatchLabel,
  parsePatch,
  patchChangeKind,
  shouldDrawLineByDefault,
} from "./patch";

// LMU versions are FOUR-tier (SteamDB: "V1.3.3.4 - Update 3, Patch 3, Hotfix 4"):
// version.update.patch.hotfix. Shorter strings pad with zeros.

describe("parsePatch", () => {
  it("parses full and partial versions", () => {
    expect(parsePatch("1.3.3.4")).toEqual([1, 3, 3, 4]);
    expect(parsePatch("1.3.4")).toEqual([1, 3, 4, 0]);
    expect(parsePatch("1.3")).toEqual([1, 3, 0, 0]);
    expect(parsePatch("2")).toEqual([2, 0, 0, 0]);
    expect(parsePatch("v1.3.3.4")).toEqual([1, 3, 3, 4]);
    expect(parsePatch("1.3.3.4 (wet)")).toEqual([1, 3, 3, 4]);
  });
  it("returns null for junk / empty", () => {
    expect(parsePatch("GMR001")).toBeNull();
    expect(parsePatch("")).toBeNull();
    expect(parsePatch(null)).toBeNull();
  });
});

describe("comparePatch", () => {
  it("orders by version then update then patch then hotfix", () => {
    expect(comparePatch("1.3.3.4", "1.3.3.5")).toBe(-1); // hotfix bump
    expect(comparePatch("1.3.3.4", "1.3.4.0")).toBe(-1); // patch bump
    expect(comparePatch("1.3.3.4", "1.4.0.0")).toBe(-1); // update bump
    expect(comparePatch("1.3.3.4", "2.0.0.0")).toBe(-1); // version bump
    expect(comparePatch("1.4.0", "1.3.9.9")).toBe(1);
    expect(comparePatch("1.3.3.4", "1.3.3.4")).toBe(0);
    expect(comparePatch("1.3.4", "1.3.4.0")).toBe(0); // short form pads with zeros
  });
  it("returns null when either side is unparseable", () => {
    expect(comparePatch("GMR001", "1.3.3.4")).toBeNull();
    expect(comparePatch("1.3.3.4", null)).toBeNull();
  });
});

describe("patchChangeKind / shouldDrawLineByDefault", () => {
  it("classifies the changed tier", () => {
    expect(patchChangeKind("1.3.3.4", "1.3.3.5")).toBe("hotfix");
    expect(patchChangeKind("1.3.3.4", "1.3.4.0")).toBe("patch");
    expect(patchChangeKind("1.3.3.4", "1.4.0.0")).toBe("update");
    expect(patchChangeKind("1.3.3.4", "2.0.0.0")).toBe("version");
    expect(patchChangeKind("1.3.3.4", "1.3.3.4")).toBe("same");
    expect(patchChangeKind(null, "1.3.3.4")).toBe("version"); // first-ever
    expect(patchChangeKind("1.3.3.4", "GMR001")).toBe("unknown");
  });
  it("defaults to drawing a line for everything except a hotfix", () => {
    expect(shouldDrawLineByDefault("1.3.3.4", "1.3.3.5")).toBe(false); // hotfix
    expect(shouldDrawLineByDefault("1.3.3.4", "1.3.4.0")).toBe(true); // patch
    expect(shouldDrawLineByDefault("1.3.3.4", "1.4.0.0")).toBe(true); // update
    expect(shouldDrawLineByDefault("1.3.3.4", "2.0.0.0")).toBe(true); // version
    expect(shouldDrawLineByDefault("1.3.3.4", "1.3.3.4")).toBe(false); // no change
  });
});

describe("normalizeSheetPatchLabel", () => {
  it("expands Ohne Speed shorthand (real observed labels)", () => {
    expect(normalizeSheetPatchLabel("1.3 +")).toBe("1.3");
    expect(normalizeSheetPatchLabel("1.24+")).toBe("1.2.4"); // digits concatenated on the sheet
    expect(normalizeSheetPatchLabel("1.23+")).toBe("1.2.3");
    expect(normalizeSheetPatchLabel("1.2 +")).toBe("1.2");
    expect(normalizeSheetPatchLabel("1.1 + (wet +8%)")).toBe("1.1");
  });
  it("passes dotted labels through and rejects junk", () => {
    expect(normalizeSheetPatchLabel("1.3.3.4")).toBe("1.3.3.4");
    expect(normalizeSheetPatchLabel("v1.3.3.4")).toBe("1.3.3.4");
    expect(normalizeSheetPatchLabel("GMR001")).toBeNull();
    expect(normalizeSheetPatchLabel(null)).toBeNull();
  });
});

describe("newestPatchIn", () => {
  it("finds the newest parseable patch, ignoring junk and suffixes", () => {
    expect(newestPatchIn(["1.3.3.4", "1.3.3.5", "1.3.2.0"])).toBe("1.3.3.5");
    expect(newestPatchIn(["1.3.3.4 (wet +8%)", "1.3.3.4"])).toBe("1.3.3.4"); // wet suffix parses
    expect(newestPatchIn(["v1.3.3.4", "1.4"])).toBe("1.4"); // short form can still win
    expect(newestPatchIn(["GMR001", null, undefined, "1.3.3.4"])).toBe("1.3.3.4");
  });
  it("returns null when nothing parses", () => {
    expect(newestPatchIn(["GMR001", null, ""])).toBeNull();
    expect(newestPatchIn([])).toBeNull();
  });
});

describe("isOlderSetupPatch", () => {
  it("flags a setup built on an earlier patch than the current one", () => {
    expect(isOlderSetupPatch("1.3.2.9", "1.3.3.4")).toBe(true);
    expect(isOlderSetupPatch("1.3.3.4", "1.3.3.5")).toBe(true); // older by hotfix
    expect(isOlderSetupPatch("1.3.3.4", "1.3.3.4")).toBe(false); // same
    expect(isOlderSetupPatch("1.3.3.5", "1.3.3.4")).toBe(false); // newer (odd, but not "older")
    expect(isOlderSetupPatch("GMR001", "1.3.3.4")).toBe(false); // unparseable → no flag
    expect(isOlderSetupPatch("1.3.2.9", null)).toBe(false); // no current patch → no flag
  });
});

describe("isSetupPatchStale", () => {
  it("does NOT depreciate a hotfix-only gap (same era)", () => {
    expect(isSetupPatchStale("1.3.3", "1.3.3.4")).toBe(false); // 1.3.3 == 1.3.3.0, differs only by hotfix
    expect(isSetupPatchStale("1.3.3.1", "1.3.3.4")).toBe(false); // older by hotfix only
    expect(isSetupPatchStale("1.3.3.4", "1.3.3.4")).toBe(false); // same
  });
  it("depreciates when older by a patch tier or higher", () => {
    expect(isSetupPatchStale("1.3.2.9", "1.3.3.4")).toBe(true); // older by patch
    expect(isSetupPatchStale("1.2.9.9", "1.3.3.4")).toBe(true); // older by update
    expect(isSetupPatchStale("0.9", "1.3.3.4")).toBe(true); // older by version
  });
  it("never depreciates a newer or unparseable/missing patch", () => {
    expect(isSetupPatchStale("1.3.3.5", "1.3.3.4")).toBe(false); // newer hotfix
    expect(isSetupPatchStale("1.4", "1.3.3.4")).toBe(false); // newer update
    expect(isSetupPatchStale("GMR001", "1.3.3.4")).toBe(false); // unparseable
    expect(isSetupPatchStale("1.3.2.9", null)).toBe(false); // no current patch
  });
});
