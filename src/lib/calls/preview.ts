export type CallPreviewStage =
  | "idle"
  | "requesting"
  | "preview-ready"
  | "permission-denied"
  | "device-error"
  | "ended";

export type CallPreviewAction =
  | { type: "request" }
  | { type: "ready" }
  | { type: "permission-denied" }
  | { type: "device-error" }
  | { type: "stop" }
  | { type: "end" };

export function callPreviewReducer(
  stage: CallPreviewStage,
  action: CallPreviewAction,
): CallPreviewStage {
  if (action.type === "end") return "ended";
  if (stage === "ended") return stage;

  switch (action.type) {
    case "request":
      return "requesting";
    case "ready":
      return stage === "requesting" ? "preview-ready" : stage;
    case "permission-denied":
      return stage === "requesting" ? "permission-denied" : stage;
    case "device-error":
      return stage === "requesting" || stage === "preview-ready"
        ? "device-error"
        : stage;
    case "stop":
      return stage === "preview-ready" || stage === "device-error"
        ? "idle"
        : stage;
  }
}

export function classifyMediaError(error: unknown): "permission-denied" | "device-error" {
  if (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" ||
      error.name === "PermissionDeniedError" ||
      error.name === "SecurityError")
  ) {
    return "permission-denied";
  }

  return "device-error";
}

export function stopMediaStream(stream: Pick<MediaStream, "getTracks"> | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
