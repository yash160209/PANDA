import { describe, expect, it, vi } from "vitest";
import {
  applyHiddenPreference,
  canHideConversation,
  filterVisibleConversations,
  isPinSetupConfirmed,
  persistConversationHiddenPreference,
} from "./rules";
import {
  isHiddenInboxSessionActive,
  isSecretCodeAttemptAllowed,
  isValidSecretCode,
  matchesConversationSearch,
  resolveMessageSearchSubmission,
  shouldSearchPeopleForQuery,
} from "./entry";
import { hashSecretCode, verifySecretCode } from "./security";

describe("Hidden Chats search entry", () => {
  it("accepts only valid Secret Code characters and lengths", () => {
    expect(isValidSecretCode("secret-42")).toBe(true);
    expect(isValidSecretCode("Abc_123.")).toBe(true);
    expect(isValidSecretCode("short")).toBe(false);
    expect(isValidSecretCode("code with spaces")).toBe(false);
    expect(isValidSecretCode("unsafe/code")).toBe(false);
    expect(isValidSecretCode(null)).toBe(false);
  });

  it("does not send Secret Code-shaped queries to people search unless explicitly submitted", () => {
    expect(shouldSearchPeopleForQuery("hidden-code-1")).toBe(false);
    expect(shouldSearchPeopleForQuery("hidden-code-1", true)).toBe(true);
    expect(shouldSearchPeopleForQuery("Mina")).toBe(true);
    expect(shouldSearchPeopleForQuery("x")).toBe(false);
  });

  it("clears a matched code and routes to the Hidden Inbox", () => {
    expect(resolveMessageSearchSubmission(" hidden-code-1 ", true))
      .toEqual({ openHiddenInbox: true, query: "" });
    expect(resolveMessageSearchSubmission("Mina", false))
      .toEqual({ openHiddenInbox: false, query: "Mina" });
  });

  it("keeps ordinary conversation search matching names and usernames", () => {
    expect(matchesConversationSearch("  mina ", "Mina Chen", "mina_chen")).toBe(true);
    expect(matchesConversationSearch("chen", "Mina Chen", "mina_chen")).toBe(true);
    expect(matchesConversationSearch("other", "Mina Chen", "mina_chen")).toBe(false);
    expect(matchesConversationSearch("", "Mina Chen", "mina_chen")).toBe(true);
  });

  it("expires temporary Hidden Inbox sessions using the server-provided expiry", () => {
    expect(isHiddenInboxSessionActive(new Date(Date.now() + 60_000).toISOString())).toBe(true);
    expect(isHiddenInboxSessionActive(new Date(Date.now() - 60_000).toISOString())).toBe(false);
    expect(isHiddenInboxSessionActive("invalid")).toBe(false);
  });

  it("allows five Secret Code attempts per rate-limit window and rejects the next", () => {
    expect(isSecretCodeAttemptAllowed(1)).toBe(true);
    expect(isSecretCodeAttemptAllowed(5)).toBe(true);
    expect(isSecretCodeAttemptAllowed(6)).toBe(false);
    expect(isSecretCodeAttemptAllowed("5")).toBe(false);
  });

  it("stores Secret Codes as salted hashes and verifies both correct and incorrect values", async () => {
    const credential = await hashSecretCode("secret-42");
    expect(credential.salt).not.toContain("secret-42");
    expect(credential.pin_hash).not.toContain("secret-42");
    await expect(verifySecretCode("secret-42", credential)).resolves.toBe(true);
    await expect(verifySecretCode("wrong-code", credential)).resolves.toBe(false);
  });

  it("requires a confirmed valid PIN during first-time setup", () => {
    expect(isPinSetupConfirmed("839204", "839204")).toBe(true);
    expect(isPinSetupConfirmed("839204", "839205")).toBe(false);
    expect(isPinSetupConfirmed("12345", "12345")).toBe(false);
  });

  it("refuses to hide a conversation until a PIN exists", () => {
    expect(canHideConversation(false)).toBe(false);
    expect(canHideConversation(true)).toBe(true);
  });

  it("removes a successfully hidden conversation immediately without deleting it from source data", () => {
    const persisted = [{ id: "one" }, { id: "two" }];
    const inbox = applyHiddenPreference(persisted, "one", true);
    expect(inbox).toEqual([{ id: "two" }]);
    expect(persisted).toHaveLength(2);
  });

  it("does not persist a hide request until a PIN exists", async () => {
    const persist = vi.fn(async () => undefined);
    await expect(
      persistConversationHiddenPreference(true, false, persist),
    ).rejects.toThrow("A PIN is required");
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists a hide before filtering the inbox", async () => {
    const conversations = [{ id: "one" }, { id: "two" }];
    const persist = vi.fn(async () => undefined);
    await expect(
      persistConversationHiddenPreference(true, true, persist),
    ).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledOnce();
    expect(applyHiddenPreference(conversations, "one", true)).toEqual([{ id: "two" }]);
    expect(conversations).toHaveLength(2);
  });

  it("restores an unhidden conversation after refreshing persisted conversations", () => {
    const refreshedConversations = [{ id: "one" }, { id: "two" }];
    expect(applyHiddenPreference(refreshedConversations, "one", false))
      .toEqual(refreshedConversations);
    expect(filterVisibleConversations(refreshedConversations, new Set(["two"])))
      .toEqual([{ id: "one" }]);
  });
});
