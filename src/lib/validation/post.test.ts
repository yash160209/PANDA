import { describe, expect, it } from "vitest";
import { MAX_IMAGE_SIZE, MAX_VIDEO_SIZE, postCaptionSchema, postCommentSchema, validatePostMedia } from "./post";

describe("postCaptionSchema", () => {
  it("trims and accepts a caption within the limit", () => {
    expect(postCaptionSchema.parse("  A little moment  ")).toBe("A little moment");
  });

  it("rejects empty and overlong captions", () => {
    expect(postCaptionSchema.safeParse("   ").success).toBe(false);
    expect(postCaptionSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
});

describe("postCommentSchema", () => {
  it("trims and accepts a comment within the limit", () => {
    expect(postCommentSchema.parse("  Lovely photo  ")).toBe("Lovely photo");
  });

  it("rejects empty and overlong comments", () => {
    expect(postCommentSchema.safeParse(" ").success).toBe(false);
    expect(postCommentSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
});

describe("validatePostMedia", () => {
  it("requires a photo or video", () => {
    expect(validatePostMedia(null)).toBe("Choose a photo or video to continue.");
  });

  it("accepts images and videos up to their size limits", () => {
    expect(validatePostMedia({ type: "image/jpeg", size: MAX_IMAGE_SIZE })).toBeNull();
    expect(validatePostMedia({ type: "video/mp4", size: MAX_VIDEO_SIZE })).toBeNull();
  });

  it("rejects unsupported types and oversized media", () => {
    expect(validatePostMedia({ type: "text/plain", size: 10 })).toBe("Choose an image or video file.");
    expect(validatePostMedia({ type: "image/png", size: MAX_IMAGE_SIZE + 1 })).toBe("Photos must be 10 MB or smaller.");
    expect(validatePostMedia({ type: "video/mp4", size: MAX_VIDEO_SIZE + 1 })).toBe("Videos must be 50 MB or smaller.");
  });
});
