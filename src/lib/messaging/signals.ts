export type IncomingCallOffer = {
  callId: string;
  mode: "voice" | "video";
  description: RTCSessionDescriptionInit;
};

export function parseIncomingCallOffer(payload: unknown, recipientId: string): IncomingCallOffer | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const description = candidate.description;
  if (
    typeof candidate.senderId !== "string"
    || candidate.senderId === recipientId
    || candidate.to !== recipientId
    || typeof candidate.callId !== "string"
    || !candidate.callId
    || (candidate.mode !== "voice" && candidate.mode !== "video")
    || !description
    || typeof description !== "object"
    || (description as { type?: unknown }).type !== "offer"
    || typeof (description as { sdp?: unknown }).sdp !== "string"
  ) {
    return null;
  }

  return {
    callId: candidate.callId,
    mode: candidate.mode,
    description: description as RTCSessionDescriptionInit,
  };
}
