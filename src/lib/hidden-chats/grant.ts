export function isHiddenChatGrant(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function hiddenChatGrantHeaders(grant: string): Record<string, string> {
  return { "x-panda-hidden-chat-grant": grant };
}
