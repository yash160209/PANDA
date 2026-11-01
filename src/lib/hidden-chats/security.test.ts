import { describe, expect, it } from "vitest";
import {
  hashPin,
  verifyPin,
} from "./security";
import {
  filterVisibleConversations,
  isConversationMember,
  isGrantActive,
  isPinAttemptAllowed,
  isValidPin,
} from "./rules";

describe("hidden chat PIN security", () => {
  it("accepts only six-to-twelve digit PINs", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("1234567890123")).toBe(false);
    expect(isValidPin("12a456")).toBe(false);
  });

  it("verifies the salted slow hash without accepting another PIN", async () => {
    const credential = await hashPin("839204");

    expect(credential.salt).not.toBe("839204");
    expect(credential.pin_hash).not.toContain("839204");
    expect(await verifyPin("839204", credential)).toBe(true);
    expect(await verifyPin("839205", credential)).toBe(false);
  });

  it("rejects malformed or weak stored credentials", async () => {
    await expect(verifyPin("123456", {
      salt: "not-a-salt",
      pin_hash: "not-a-hash",
      iterations: 1,
    })).resolves.toBe(false);
  });
});

describe("hidden chat access rules", () => {
  it("allows only the first five PIN attempts in a rolling window", () => {
    expect(isPinAttemptAllowed(1)).toBe(true);
    expect(isPinAttemptAllowed(5)).toBe(true);
    expect(isPinAttemptAllowed(6)).toBe(false);
  });

  it("rejects expired grants", () => {
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    expect(isGrantActive("2026-11-01T00:01:00.000Z", now)).toBe(true);
    expect(isGrantActive("2026-10-31T23:59:00.000Z", now)).toBe(false);
    expect(isGrantActive("invalid", now)).toBe(false);
  });

  it("requires the current user to be a conversation participant", () => {
    expect(isConversationMember("user-a", ["user-a", "user-b"])).toBe(true);
    expect(isConversationMember("user-c", ["user-a", "user-b"])).toBe(false);
  });

  it("filters hidden conversations from the normal inbox", () => {
    const conversations = [{ id: "visible" }, { id: "hidden" }];
    expect(filterVisibleConversations(conversations, new Set(["hidden"])))
      .toEqual([{ id: "visible" }]);
  });
});
