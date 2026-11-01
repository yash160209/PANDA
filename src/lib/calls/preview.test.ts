import { describe, expect, it, vi } from "vitest";
import {
  callPreviewReducer,
  classifyMediaError,
  stopMediaStream,
  type CallPreviewStage,
} from "./preview";

describe("callPreviewReducer", () => {
  it("moves through permission request and local preview states", () => {
    let stage: CallPreviewStage = "idle";
    stage = callPreviewReducer(stage, { type: "request" });
    expect(stage).toBe("requesting");
    stage = callPreviewReducer(stage, { type: "ready" });
    expect(stage).toBe("preview-ready");
  });

  it("distinguishes permission denial from device errors", () => {
    expect(callPreviewReducer("requesting", { type: "permission-denied" })).toBe("permission-denied");
    expect(callPreviewReducer("requesting", { type: "device-error" })).toBe("device-error");
  });

  it("does not allow a connected state and keeps ended terminal", () => {
    expect(callPreviewReducer("preview-ready", { type: "end" })).toBe("ended");
    expect(callPreviewReducer("ended", { type: "request" })).toBe("ended");
  });
});

describe("classifyMediaError", () => {
  it("reports browser permission errors separately", () => {
    expect(classifyMediaError(new DOMException("Denied", "NotAllowedError"))).toBe("permission-denied");
  });

  it("treats unavailable devices and unknown failures as device errors", () => {
    expect(classifyMediaError(new DOMException("Missing device", "NotFoundError"))).toBe("device-error");
    expect(classifyMediaError(new Error("Unexpected"))).toBe("device-error");
  });
});

describe("stopMediaStream", () => {
  it("stops every track in a stream and accepts an empty stream", () => {
    const audioTrack = { stop: vi.fn() };
    const videoTrack = { stop: vi.fn() };
    const stream = { getTracks: () => [audioTrack, videoTrack] } as unknown as MediaStream;

    stopMediaStream(stream);
    stopMediaStream(null);

    expect(audioTrack.stop).toHaveBeenCalledOnce();
    expect(videoTrack.stop).toHaveBeenCalledOnce();
  });
});
