import { describe, it, expect } from "vitest";
import { classifyStatus } from "../src/parser/status.js";

// Suunnitelma §16.2 — statusluokittelutestit
describe("classifyStatus", () => {
  it.each([
    ["AVAILABLE", "available"],
    ["CHARGING", "charging"],
    ["RESERVED", "reserved"],
    ["BLOCKED", "blocked"],
    ["INOPERATIVE", "out_of_order"],
    ["OUTOFORDER", "out_of_order"],
    ["UNKNOWN", "unknown"],
    ["PLANNED", "excluded"],
    ["REMOVED", "excluded"],
    ["SOMETHING_ELSE", "other_status"],
  ] as const)("%s -> %s", (raw, expected) => {
    expect(classifyStatus(raw)).toBe(expected);
  });

  it("puuttuva status -> unknown", () => {
    expect(classifyStatus(null)).toBe("unknown");
    expect(classifyStatus(undefined)).toBe("unknown");
    expect(classifyStatus("")).toBe("unknown");
  });

  it("normalisoi kirjainkoon ja välilyönnit", () => {
    expect(classifyStatus(" charging ")).toBe("charging");
    expect(classifyStatus("Available")).toBe("available");
  });
});
