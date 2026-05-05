import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks so the imported reports module sees them at module-load time.
const mocks = vi.hoisted(() => ({
  getObjectEntityFile: vi.fn(),
  safeFetchLogoBytes: vi.fn(),
}));

vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {
    constructor() {
      super("Object not found");
      this.name = "ObjectNotFoundError";
      Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
    }
  }
  class ObjectStorageService {
    getObjectEntityFile = mocks.getObjectEntityFile;
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

vi.mock("../lib/safe-fetch", () => ({
  safeFetchLogoBytes: mocks.safeFetchLogoBytes,
  // The reports module also imports types/classes from this file via re-export
  // chains — keep the surface identical.
  assertSafeLogoUrlShape: vi.fn(),
  UrlNotAllowedError: class UrlNotAllowedError extends Error {},
}));

import { loadLogoBytes } from "./reports";
import { ObjectNotFoundError } from "../lib/objectStorage";

beforeEach(() => {
  mocks.getObjectEntityFile.mockReset();
  mocks.safeFetchLogoBytes.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadLogoBytes", () => {
  it("returns null when no logo URL is configured", async () => {
    const out = await loadLogoBytes(null);
    expect(out).toBeNull();
    expect(mocks.getObjectEntityFile).not.toHaveBeenCalled();
    expect(mocks.safeFetchLogoBytes).not.toHaveBeenCalled();
  });

  it("loads /objects/... paths via ObjectStorageService and skips safeFetch", async () => {
    const expected = Buffer.from("fake-image-bytes");
    mocks.getObjectEntityFile.mockResolvedValue({
      download: vi.fn().mockResolvedValue([expected]),
    });

    const out = await loadLogoBytes("/objects/uploads/logo.png");

    expect(out).toEqual(expected);
    expect(mocks.getObjectEntityFile).toHaveBeenCalledWith(
      "/objects/uploads/logo.png",
    );
    expect(mocks.safeFetchLogoBytes).not.toHaveBeenCalled();
  });

  it("returns null (without throwing) when the object is missing", async () => {
    mocks.getObjectEntityFile.mockRejectedValue(new ObjectNotFoundError());

    const out = await loadLogoBytes("/objects/uploads/missing.png");

    expect(out).toBeNull();
    expect(mocks.safeFetchLogoBytes).not.toHaveBeenCalled();
  });

  it("returns null (without throwing) on unexpected object-storage errors", async () => {
    mocks.getObjectEntityFile.mockRejectedValue(new Error("boom"));

    const out = await loadLogoBytes("/objects/uploads/oops.png");

    expect(out).toBeNull();
    expect(mocks.safeFetchLogoBytes).not.toHaveBeenCalled();
  });

  it("delegates non-/objects/ URLs to safeFetchLogoBytes", async () => {
    const expected = Buffer.from("from-https");
    mocks.safeFetchLogoBytes.mockResolvedValue(expected);

    const out = await loadLogoBytes("https://example.com/logo.png");

    expect(out).toEqual(expected);
    expect(mocks.safeFetchLogoBytes).toHaveBeenCalledWith(
      "https://example.com/logo.png",
    );
    expect(mocks.getObjectEntityFile).not.toHaveBeenCalled();
  });

  it("returns null when safeFetchLogoBytes returns null for an unknown URL", async () => {
    mocks.safeFetchLogoBytes.mockResolvedValue(null);

    const out = await loadLogoBytes("https://nope.invalid/logo.png");

    expect(out).toBeNull();
  });
});
