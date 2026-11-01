type PinStatusResponse = {
  hasPin?: unknown;
  error?: unknown;
};

export async function readHiddenChatPinStatus(response: Response): Promise<boolean> {
  let result: PinStatusResponse | null = null;
  try {
    result = (await response.json()) as PinStatusResponse;
  } catch {
    throw new Error("PIN settings returned an invalid response. Try again.");
  }

  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : "PIN settings could not be loaded. Try again.",
    );
  }
  if (typeof result?.hasPin !== "boolean") {
    throw new Error("PIN settings returned an invalid response. Try again.");
  }

  return result.hasPin;
}

export async function fetchHiddenChatPinStatus(): Promise<boolean> {
  const response = await fetch("/api/hidden-chats/pin", { cache: "no-store" });
  return readHiddenChatPinStatus(response);
}
