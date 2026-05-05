import { beforeEach, describe, expect, it } from "vitest";
import {
  UNKNOWN_SOURCE,
  getStoredEmailSourceFilter,
  parseEmailSourceParam,
  serializeEmailSourceParam,
  setStoredEmailSourceFilter,
} from "./email-source-filter";

const STORAGE_KEY = "recruiting-os:email-source-filter";

beforeEach(() => {
  window.localStorage.clear();
});

describe("parseEmailSourceParam / serializeEmailSourceParam", () => {
  it("round-trips a known set of source values", () => {
    const original = new Set(["profile", "commit"]);
    const serialized = serializeEmailSourceParam(original);
    const parsed = parseEmailSourceParam(`emailSource=${serialized}`);
    expect(parsed).toEqual(original);
  });

  it("maps the UNKNOWN sentinel to/from the 'unknown' URL token", () => {
    const original = new Set([UNKNOWN_SOURCE, "manual"]);
    const serialized = serializeEmailSourceParam(original);
    expect(serialized.split(",").sort()).toEqual(["manual", "unknown"]);
    const parsed = parseEmailSourceParam(`emailSource=${serialized}`);
    expect(parsed).toEqual(original);
  });

  it("ignores unknown source tokens but keeps the valid ones", () => {
    const parsed = parseEmailSourceParam("emailSource=profile,bogus,commit");
    expect(parsed).toEqual(new Set(["profile", "commit"]));
  });

  it("returns an empty set when the param is missing or empty", () => {
    expect(parseEmailSourceParam("").size).toBe(0);
    expect(parseEmailSourceParam("emailSource=").size).toBe(0);
  });
});

describe("getStoredEmailSourceFilter / setStoredEmailSourceFilter", () => {
  it("persists a non-empty selection to localStorage and reads it back", () => {
    setStoredEmailSourceFilter(new Set(["profile", "manual"]));
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const restored = getStoredEmailSourceFilter();
    expect(restored).toEqual(new Set(["profile", "manual"]));
  });

  it("persists the UNKNOWN sentinel using the 'unknown' URL token", () => {
    setStoredEmailSourceFilter(new Set([UNKNOWN_SOURCE]));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("unknown");
    expect(getStoredEmailSourceFilter()).toEqual(new Set([UNKNOWN_SOURCE]));
  });

  it("returns null when there's no saved value", () => {
    expect(getStoredEmailSourceFilter()).toBeNull();
  });

  it("clearing the selection (empty set) REMOVES the storage entry — no resurrection", () => {
    setStoredEmailSourceFilter(new Set(["profile"]));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("profile");

    setStoredEmailSourceFilter(new Set());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // And a subsequent read must NOT resurrect anything.
    expect(getStoredEmailSourceFilter()).toBeNull();
  });

  it("treats a stored value with only invalid tokens as 'no preference' (returns null)", () => {
    window.localStorage.setItem(STORAGE_KEY, "totally-bogus");
    expect(getStoredEmailSourceFilter()).toBeNull();
  });
});
