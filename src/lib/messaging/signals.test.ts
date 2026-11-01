import { describe, expect, it } from "vitest";
import { parseIncomingCallOffer } from "./signals";

const offer = {
  senderId: "caller",
  to: "recipient",
  callId: "call-1",
  mode: "video",
  description: { type: "offer", sdp: "valid-sdp" },
};

describe("incoming call offer validation", () => {
  it("accepts a well-formed offer addressed to the signed-in user", () => {
    expect(parseIncomingCallOffer(offer, "recipient")).toEqual({
      callId: "call-1",
      mode: "video",
      description: offer.description,
    });
  });

  it("rejects offers addressed to another user or sent by the current user", () => {
    expect(parseIncomingCallOffer({ ...offer, to: "someone-else" }, "recipient")).toBeNull();
    expect(parseIncomingCallOffer({ ...offer, senderId: "recipient" }, "recipient")).toBeNull();
  });

  it("rejects malformed or incomplete signaling payloads", () => {
    expect(parseIncomingCallOffer(null, "recipient")).toBeNull();
    expect(parseIncomingCallOffer({ ...offer, callId: "" }, "recipient")).toBeNull();
    expect(parseIncomingCallOffer({ ...offer, description: { type: "answer", sdp: "x" } }, "recipient")).toBeNull();
    expect(parseIncomingCallOffer({ ...offer, mode: "screen" }, "recipient")).toBeNull();
  });
});
