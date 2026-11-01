import { describe, expect, it } from "vitest";
import { hiddenChatGrantHeaders, isHiddenChatGrant } from "./grant";

describe("Hidden Chats access grants", () => {
  it("accepts only a 64-character lowercase hexadecimal grant", () => {
    expect(isHiddenChatGrant("a".repeat(64))).toBe(true);
    expect(isHiddenChatGrant("A".repeat(64))).toBe(false);
    expect(isHiddenChatGrant("a".repeat(63))).toBe(false);
    expect(isHiddenChatGrant(null)).toBe(false);
  });

  it("forwards the grant using the database authorization header", () => {
    expect(hiddenChatGrantHeaders("a".repeat(64))).toEqual({
      "x-panda-hidden-chat-grant": "a".repeat(64),
    });
  });
});
