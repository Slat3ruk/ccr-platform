import { describe, expect, it } from "vitest";
import { formatLapTime, parseLapTime, parseLapTimes } from "./time";

describe("parseLapTime", () => {
  it("parses M:SS.mmm and plain seconds", () => {
    expect(parseLapTime("3:47.123")).toBeCloseTo(227.123, 6);
    expect(parseLapTime("1:23.4")).toBeCloseTo(83.4, 6);
    expect(parseLapTime("47.123")).toBeCloseTo(47.123, 6);
    expect(parseLapTime(227.123)).toBeCloseTo(227.123, 6);
  });
  it("rejects junk", () => {
    expect(parseLapTime("")).toBeNull();
    expect(parseLapTime("1:75.0")).toBeNull(); // 75 s in the seconds slot
    expect(parseLapTime("abc")).toBeNull();
    expect(parseLapTime(-3)).toBeNull();
  });
});

describe("parseLapTimes", () => {
  it("parses one-per-line", () => {
    const { laps, bad } = parseLapTimes("1:42.318\n1:42.905\n1:43.112");
    expect(laps).toHaveLength(3);
    expect(laps[0]).toBeCloseTo(102.318, 6);
    expect(bad).toHaveLength(0);
  });

  it("parses comma- and space-separated", () => {
    expect(parseLapTimes("1:42.318, 1:42.905, 1:43.112").laps).toHaveLength(3);
    expect(parseLapTimes("1:42.318 1:42.905 1:43.112").laps).toHaveLength(3);
  });

  it("tolerates leading lap numbers from timing screens", () => {
    const { laps, bad } = parseLapTimes("1. 1:42.318\n2) 1:42.905\nLap 3: 1:43.112");
    expect(laps).toHaveLength(3);
    expect(bad).toHaveLength(0);
  });

  it("collects unreadable tokens without dropping the good ones", () => {
    const { laps, bad } = parseLapTimes("1:42.318\ngarbage\n1:43.112");
    expect(laps).toHaveLength(2);
    expect(bad).toEqual(["garbage"]);
  });

  it("returns empty for empty input", () => {
    expect(parseLapTimes("").laps).toHaveLength(0);
    expect(parseLapTimes("   \n  ").laps).toHaveLength(0);
  });
});

describe("formatLapTime", () => {
  it("round-trips with parseLapTime", () => {
    expect(formatLapTime(102.318)).toBe("1:42.318");
    expect(parseLapTime(formatLapTime(102.318))).toBeCloseTo(102.318, 3);
  });
});
