import { describe, expect, it } from "vitest";
import { matchesStoryFileSignature, validateStoryMedia } from "./media";

describe("story media validation", () => {
  it("accepts supported, size-bounded media with a matching extension", () => {
    expect(validateStoryMedia({ name: "photo.webp", type: "image/webp", size: 12 })).toEqual({ mediaType: "image" });
    expect(validateStoryMedia({ name: "clip.mp4", type: "video/mp4", size: 12 })).toEqual({ mediaType: "video" });
  });

  it("rejects mismatched types, unsupported formats, and oversized files", () => {
    expect(validateStoryMedia({ name: "photo.png", type: "image/jpeg", size: 12 }).error).toBeTruthy();
    expect(validateStoryMedia({ name: "movie.mov", type: "video/quicktime", size: 12 }).error).toBeTruthy();
    expect(validateStoryMedia({ name: "clip.mp4", type: "video/mp4", size: 50 * 1024 * 1024 + 1 }).error).toContain("50 MB");
  });

  it("checks actual file signatures rather than trusting browser MIME metadata", () => {
    expect(matchesStoryFileSignature("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesStoryFileSignature("image/png", new Uint8Array([0, 1, 2, 3]))).toBe(false);
    expect(matchesStoryFileSignature("video/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
    expect(matchesStoryFileSignature("video/mp4", new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))).toBe(true);
    expect(matchesStoryFileSignature("image/avif", new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))).toBe(true);
  });
});
