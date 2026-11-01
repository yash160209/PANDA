export const MAX_PIN_ATTEMPTS = 5;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{6,12}$/.test(pin);
}

export function isPinSetupConfirmed(pin: string, confirmation: string): boolean {
  return isValidPin(pin) && pin === confirmation;
}

export function canHideConversation(hasPin: boolean): boolean {
  return hasPin;
}

export function isPinAttemptAllowed(attemptCount: unknown): boolean {
  return typeof attemptCount === "number"
    && Number.isInteger(attemptCount)
    && attemptCount >= 1
    && attemptCount <= MAX_PIN_ATTEMPTS;
}

export function isGrantActive(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

export function isConversationMember(userId: string, participantIds: string[]): boolean {
  return participantIds.includes(userId);
}

export function filterVisibleConversations<T extends { id: string }>(
  conversations: T[],
  hiddenIds: Set<string>,
): T[] {
  return conversations.filter((conversation) => !hiddenIds.has(conversation.id));
}

export function applyHiddenPreference<T extends { id: string }>(
  conversations: T[],
  conversationId: string,
  isHidden: boolean,
): T[] {
  return isHidden
    ? conversations.filter((conversation) => conversation.id !== conversationId)
    : conversations;
}

export async function persistConversationHiddenPreference(
  isHidden: boolean,
  hasPin: boolean,
  persist: () => Promise<void>,
): Promise<void> {
  if (isHidden && !canHideConversation(hasPin)) {
    throw new Error("A PIN is required before hiding conversations.");
  }

  await persist();
}
