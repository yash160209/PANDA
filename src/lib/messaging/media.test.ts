import { describe, expect, it } from "vitest";
import { chatMediaKind, MAX_AVATAR_BYTES, MAX_CHAT_MEDIA_BYTES, validateAvatarMedia, validateChatMedia } from "./media";

describe("chat media validation", () => {
  it("allows supported image and video files within the configured limit", () => {
    expect(validateChatMedia({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateChatMedia({ type: "video/mp4", size: MAX_CHAT_MEDIA_BYTES })).toBeNull();
  });

  it("rejects unsupported types and oversized or empty files", () => {
    expect(validateChatMedia({ type: "image/svg+xml", size: 1024 })).toContain("Choose");
    expect(validateChatMedia({ type: "image/png", size: 0 })).toContain("smaller");
    expect(validateChatMedia({ type: "video/mp4", size: MAX_CHAT_MEDIA_BYTES + 1 })).toContain("smaller");
  });

  it("classifies supported media for rendering", () => {
    expect(chatMediaKind("image/webp")).toBe("image");
    expect(chatMediaKind("video/webm")).toBe("video");
  });

  it("validates profile photos against the private avatar bucket constraints", () => {
    expect(validateAvatarMedia({ type: "image/avif", size: MAX_AVATAR_BYTES })).toBeNull();
    expect(validateAvatarMedia({ type: "image/gif", size: 1024 })).toContain("Choose");
    expect(validateAvatarMedia({ type: "image/jpeg", size: MAX_AVATAR_BYTES + 1 })).toContain("5 MB");
  });
});
