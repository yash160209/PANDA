export function isValidSecretCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Za-z0-9._-]{6,48}$/.test(code);
}

export function resolveMessageSearchSubmission(
  query: string,
  secretCodeMatched: boolean,
): { openHiddenInbox: boolean; query: string } {
  return secretCodeMatched
    ? { openHiddenInbox: true, query: "" }
    : { openHiddenInbox: false, query };
}

export function shouldSearchPeopleForQuery(query: string, explicitlySubmitted = false): boolean {
  const normalizedQuery = query.trim();
  return normalizedQuery.length >= 2
    && (explicitlySubmitted || !isValidSecretCode(normalizedQuery));
}

export function isSecretCodeAttemptAllowed(attemptCount: unknown, maximumAttempts = 5): boolean {
  return typeof attemptCount === "number"
    && Number.isInteger(attemptCount)
    && attemptCount >= 1
    && attemptCount <= maximumAttempts;
}

export function matchesConversationSearch(
  query: string,
  displayName: string,
  username: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return displayName.toLocaleLowerCase().includes(normalizedQuery)
    || username.toLocaleLowerCase().includes(normalizedQuery);
}

export function isHiddenInboxSessionActive(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}
