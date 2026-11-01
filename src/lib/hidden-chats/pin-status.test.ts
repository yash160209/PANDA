import { describe, expect, it } from "vitest";
import { readHiddenChatPinStatus } from "./pin-status";

describe("Hidden Chats PIN status response", () => {
  it("reads configured and not-configured states", async () => {
    await expect(readHiddenChatPinStatus(
      new Response(JSON.stringify({ hasPin: true }), { status: 200 }),
    )).resolves.toBe(true);
    await expect(readHiddenChatPinStatus(
      new Response(JSON.stringify({ hasPin: false }), { status: 200 }),
    )).resolves.toBe(false);
  });

  it("surfaces the safe error returned by the API", async () => {
    await expect(readHiddenChatPinStatus(
      new Response(JSON.stringify({ error: "Verify that the Hidden Chats migration is applied." }), { status: 503 }),
    )).rejects.toThrow("Verify that the Hidden Chats migration is applied.");
  });

  it("rejects malformed or unsuccessful responses without a safe error message", async () => {
    await expect(readHiddenChatPinStatus(
      new Response("not json", { status: 503 }),
    )).rejects.toThrow("PIN settings returned an invalid response.");
    await expect(readHiddenChatPinStatus(
      new Response(JSON.stringify({}), { status: 200 }),
    )).rejects.toThrow("PIN settings returned an invalid response.");
  });
});
