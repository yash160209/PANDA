"use client";

import { Ellipsis, Eye, EyeOff, LockKeyhole, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hiddenChatGrantHeaders } from "@/lib/hidden-chats/grant";
import { fetchHiddenChatPinStatus } from "@/lib/hidden-chats/pin-status";
import { isValidSecretCode, matchesConversationSearch } from "@/lib/hidden-chats/entry";
import {
  applyHiddenPreference,
  canHideConversation,
  filterVisibleConversations,
  isGrantActive,
  isPinSetupConfirmed,
  isValidPin,
  persistConversationHiddenPreference,
} from "@/lib/hidden-chats/rules";

type ConversationProfile = {
  username: string;
  display_name: string;
  avatar_path: string | null;
};

type ConversationParticipant = {
  user_id: string;
  profiles: ConversationProfile | ConversationProfile[] | null;
};

export type ChatConversation = {
  id: string;
  updated_at: string;
  conversation_participants: ConversationParticipant[];
};

type ProtectedConversations = { conversations?: ChatConversation[]; error?: string };

async function postJson(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = (await response.json()) as { success?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

function getConversationName(conversation: ChatConversation, userId: string) {
  const otherParticipant = conversation.conversation_participants.find(
    (participant) => participant.user_id !== userId,
  );
  const relatedProfile = otherParticipant?.profiles;
  const profile = Array.isArray(relatedProfile) ? relatedProfile[0] : relatedProfile;
  return profile?.display_name || (profile?.username ? `@${profile.username}` : "Conversation");
}

function getConversationActivity(conversation: ChatConversation) {
  const updatedAt = Date.parse(conversation.updated_at);
  return Number.isFinite(updatedAt)
    ? `Conversation · ${new Date(updatedAt).toLocaleDateString()}`
    : "Conversation";
}

export function PinManager({
  userId,
  onPinUpdated,
  startSetup = false,
  onSetupHandled,
  embedded = false,
}: {
  userId: string;
  onPinUpdated?: () => void;
  startSetup?: boolean;
  onSetupHandled?: () => void;
  embedded?: boolean;
}) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [isEditing, setIsEditing] = useState(startSetup);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pinStatusError, setPinStatusError] = useState("");

  useEffect(() => {
    let active = true;
    void fetchHiddenChatPinStatus()
      .then((value) => { if (active) setHasPin(value); })
      .catch((caught: unknown) => {
        if (active) setPinStatusError(caught instanceof Error ? caught.message : "PIN settings could not be loaded. Try again.");
      });
    return () => { active = false; };
  }, [userId]);

  function retryPinStatus() {
    setPinStatusError("");
    setHasPin(null);
    void fetchHiddenChatPinStatus()
      .then(setHasPin)
      .catch((caught: unknown) => {
        setPinStatusError(caught instanceof Error ? caught.message : "PIN settings could not be loaded. Try again.");
      });
  }

  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (
      !isValidPin(newPin) ||
      (!hasPin && !isPinSetupConfirmed(newPin, confirmPin)) ||
      (hasPin && !isValidPin(currentPin))
    ) {
      if (!hasPin && isValidPin(newPin) && newPin !== confirmPin) {
        setError("PIN entries do not match.");
        return;
      }
      setError("Use a PIN containing 6 to 12 digits.");
      return;
    }

    setBusy(true);
    try {
      await postJson("/api/hidden-chats/pin", hasPin
        ? { action: "change", currentPin, newPin }
        : { action: "setup", newPin });
      setHasPin(true);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setIsEditing(false);
      onPinUpdated?.();
      onSetupHandled?.();
      setNotice(hasPin ? "Your Hidden Chats PIN was changed." : "Your Hidden Chats PIN is ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PIN could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`hidden-chat-pin-card${embedded ? " hidden-chat-pin-card--embedded" : ""}`} aria-label="Hidden Chats PIN settings">
      {!embedded && <div className="hidden-chat-card-heading">
        <LockKeyhole size={17} />
        <div><strong>Hidden Chats PIN</strong><span>PINs are protected by a salted, slow hash.</span></div>
      </div>}
      {hasPin === null
        ? <p className={`hidden-chat-status${pinStatusError ? " hidden-chat-status-error" : ""}`} role={pinStatusError ? "alert" : "status"}>{pinStatusError ? <>{pinStatusError} <button className="text-button" type="button" onClick={retryPinStatus}>Try again</button></> : "Checking PIN settings…"}</p>
        : isEditing
          ? <form className="hidden-chat-pin-form" onSubmit={(event) => void savePin(event)}>
              {hasPin && <label>Current PIN<input aria-label="Current PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={currentPin} onChange={(event) => setCurrentPin(event.target.value)} /></label>}
              <label>{hasPin ? "New PIN" : "Choose a PIN"}<input aria-label={hasPin ? "New PIN" : "Choose a PIN"} type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={newPin} onChange={(event) => setNewPin(event.target.value)} /></label>
              {!hasPin && <label>Confirm PIN<input aria-label="Confirm PIN" type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} /></label>}
              {error && <p className="hidden-chat-error" role="alert">{error}</p>}
              <div className="hidden-chat-actions">
                <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save PIN"}</button>
                <button className="text-button" type="button" disabled={busy} onClick={() => { setIsEditing(false); setCurrentPin(""); setNewPin(""); setConfirmPin(""); setError(""); onSetupHandled?.(); }}>Cancel</button>
              </div>
            </form>
          : <div className="hidden-chat-pin-summary">
              <p>{hasPin ? "A PIN is set for this account." : "Set a PIN before hiding or unlocking chats."}</p>
              <button className="text-button" type="button" onClick={() => { setIsEditing(true); setNotice(""); }}>{hasPin ? "Change PIN" : "Set up PIN"}</button>
            </div>}
      {notice && <p className="hidden-chat-success" role="status">{notice}</p>}
    </section>
  );
}

export function SecretCodeManager({ userId }: { userId: string }) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [hasSecretCode, setHasSecretCode] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadStatus = useCallback(async () => {
    const [pinStatus, codeResponse] = await Promise.all([
      fetchHiddenChatPinStatus(),
      fetch("/api/hidden-chats/secret-code", { cache: "no-store" }),
    ]);
    const codeResult = (await codeResponse.json()) as { hasSecretCode?: unknown; error?: string };
    if (!codeResponse.ok || typeof codeResult.hasSecretCode !== "boolean") {
      throw new Error(codeResult.error ?? "Secret Code settings could not be loaded.");
    }
    setHasPin(pinStatus);
    setHasSecretCode(codeResult.hasSecretCode);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadStatus().catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Secret Code settings could not be loaded.");
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadStatus, userId]);

  async function saveCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!isValidPin(currentPin)) {
      setError("Enter your current 6 to 12 digit Hidden Chats PIN.");
      return;
    }
    if (!isValidSecretCode(newCode)) {
      setError("Use 6 to 48 letters, numbers, periods, underscores, or hyphens.");
      return;
    }
    if (newCode !== confirmCode) {
      setError("Secret Code entries do not match.");
      return;
    }

    setBusy(true);
    try {
      const result = await postJson("/api/hidden-chats/secret-code", {
        currentPin,
        newCode,
        confirmCode,
      });
      if (!result.success) throw new Error("Secret Code settings could not be updated.");
      setHasSecretCode(true);
      setCurrentPin("");
      setNewCode("");
      setConfirmCode("");
      setEditing(false);
      setNotice("Secret Code saved. Use it in Inbox search to open Hidden Chats.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Secret Code settings could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  if (hasPin === null || hasSecretCode === null) {
    return <p className="hidden-chat-status" role={error ? "alert" : "status"}>
      {error || "Checking Secret Code settings…"}{error && <> <button className="text-button" type="button" onClick={() => { setError(""); void loadStatus().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Secret Code settings could not be loaded.")); }}>Try again</button></>}
    </p>;
  }
  if (!hasPin) {
    return <p className="hidden-chat-status">Set up a Hidden Chats PIN first. Your PIN is required to set or recover the Secret Code.</p>;
  }

  return <section className="secret-code-manager" aria-label="Hidden Inbox Secret Code settings">
    {hasSecretCode && !editing
      ? <div className="hidden-chat-pin-summary">
          <p>A Secret Code is set. Recover or change it with your Hidden Chats PIN.</p>
          <button className="text-button" type="button" onClick={() => { setEditing(true); setNotice(""); setError(""); }}>Change or recover code</button>
        </div>
      : <form className="hidden-chat-pin-form" onSubmit={(event) => void saveCode(event)}>
          <label>Current Hidden Chats PIN<input aria-label="Current Hidden Chats PIN for Secret Code" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={currentPin} onChange={(event) => setCurrentPin(event.target.value)} /></label>
          <label>{hasSecretCode ? "New Secret Code" : "Choose a Secret Code"}<input aria-label={hasSecretCode ? "New Secret Code" : "Choose a Secret Code"} type="password" autoComplete="off" maxLength={48} value={newCode} onChange={(event) => setNewCode(event.target.value)} /></label>
          <label>Confirm Secret Code<input aria-label="Confirm Secret Code" type="password" autoComplete="off" maxLength={48} value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} /></label>
          {error && <p className="hidden-chat-error" role="alert">{error}</p>}
          <div className="hidden-chat-actions">
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Secret Code"}</button>
            {hasSecretCode && <button className="text-button" type="button" disabled={busy} onClick={() => { setEditing(false); setCurrentPin(""); setNewCode(""); setConfirmCode(""); setError(""); }}>Cancel</button>}
          </div>
        </form>}
    {notice && <p className="hidden-chat-success" role="status">{notice}</p>}
    {!notice && <p className="hidden-chat-security-note"><ShieldCheck size={14} />The code is stored as a salted, slow hash. Your PIN is required to recover it.</p>}
  </section>;
}

export function RealConversationList({
  userId,
  onRequirePinSetup,
}: {
  userId: string | null;
  onRequirePinSetup: () => void;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pinStatusError, setPinStatusError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    if (!userId) {
      setConversations([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: preferences, error: preferencesError } = await supabase
        .from("hidden_chat_preferences")
        .select("conversation_id")
        .eq("user_id", userId)
        .eq("is_hidden", true);
      if (preferencesError) throw new Error("Conversations could not be loaded.");
      const hidden = new Set((preferences ?? []).map((preference) => preference.conversation_id));

      const { data, error: conversationsError } = await supabase
        .from("conversations")
        .select("id,updated_at,conversation_participants(user_id,profiles(username,display_name,avatar_path))")
        .order("updated_at", { ascending: false });
      if (conversationsError) throw new Error("Conversations could not be loaded.");
      setConversations(filterVisibleConversations((data ?? []) as ChatConversation[], hidden));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    void fetchHiddenChatPinStatus()
      .then((value) => { if (active) setHasPin(value); })
      .catch((caught: unknown) => {
        if (active) setPinStatusError(caught instanceof Error ? caught.message : "PIN settings could not be loaded. Try again.");
      });
    return () => { active = false; };
  }, [userId]);

  async function setHidden(conversationId: string, isHidden: boolean) {
    if (isHidden && !canHideConversation(hasPin === true)) {
      onRequirePinSetup();
      return;
    }
    if (isHidden && !window.confirm("Hide this conversation from your inbox? You can restore it later.")) {
      return;
    }

    setBusyId(conversationId);
    setError("");
    try {
      await persistConversationHiddenPreference(
        isHidden,
        hasPin === true,
        async () => {
          await postJson("/api/hidden-chats/preferences", { conversationId, isHidden });
        },
      );
      setConversations((current) => applyHiddenPreference(current, conversationId, isHidden));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The chat preference could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  const filteredConversations = conversations.filter((conversation) => {
    const name = getConversationName(conversation, userId ?? "");
    const otherParticipant = conversation.conversation_participants.find(
      (participant) => participant.user_id !== userId,
    );
    const relation = otherParticipant?.profiles;
    const profile = Array.isArray(relation) ? relation[0] : relation;
    return matchesConversationSearch(query, name, profile?.username ?? "");
  });

  return (
    <section className="real-conversations" aria-label="Your conversations">
      <header className="real-conversations-heading">
        <div><strong>Messages</strong><span>Live conversations from your account.</span></div>
      </header>
      <form className="inbox-search real-inbox-search" onSubmit={(event) => void submitSearch(event)}>
        <Search size={15} />
        <input
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      {!userId
        ? <p className="hidden-chat-status">Sign in to load your conversations.</p>
        : loading
          ? <p className="hidden-chat-status">Loading conversations…</p>
          : filteredConversations.length === 0
            ? <p className="hidden-chat-status">{conversations.length ? "No conversations match your search." : "No visible conversations yet."}</p>
            : <div className="real-conversation-list">{filteredConversations.map((conversation) => (
                <article className="real-conversation-row" key={conversation.id}>
                  <span className="avatar avatar-md" role="img" aria-label={getConversationName(conversation, userId)}>
                    {getConversationName(conversation, userId).slice(0, 1)}
                  </span>
                  <div className="real-conversation-copy">
                    <strong>{getConversationName(conversation, userId)}</strong>
                    <span>{getConversationActivity(conversation)}</span>
                  </div>
                  <details className="conversation-action-menu">
                    <summary className="icon-button" aria-label={`Conversation actions for ${getConversationName(conversation, userId)}`} title="Conversation actions">
                      <Ellipsis size={17} />
                    </summary>
                    <button type="button" disabled={busyId === conversation.id} onClick={() => void setHidden(conversation.id, true)}>
                      <EyeOff size={15} />Hide Chat
                    </button>
                  </details>
                </article>
              ))}</div>}
      {pinStatusError && <p className="hidden-chat-error" role="alert">{pinStatusError}</p>}
      {error && <p className="hidden-chat-error" role="alert">{error}</p>}
    </section>
  );
}

export function HiddenChatsView({ userId }: { userId: string | null }) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pinStatusError, setPinStatusError] = useState("");
  const [pin, setPin] = useState("");
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockingId, setUnlockingId] = useState("");
  const [grant, setGrant] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadHidden = useCallback(async (accessGrant: string) => {
    const response = await fetch("/api/hidden-chats/conversations", {
      headers: { "x-panda-hidden-chat-grant": accessGrant },
      cache: "no-store",
    });
    const result = (await response.json()) as ProtectedConversations;
    if (!response.ok) throw new Error(result.error ?? "Hidden Chats could not be loaded.");
    setConversations(result.conversations ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    if (!userId) {
      return () => { active = false; };
    }

    void fetchHiddenChatPinStatus()
      .then((value) => { if (active) setHasPin(value); })
      .catch((caught: unknown) => {
        if (active) setPinStatusError(caught instanceof Error ? caught.message : "PIN settings could not be loaded. Try again.");
      });
    return () => { active = false; };
  }, [userId]);

  async function retryPinStatus() {
    setPinStatusError("");
    setHasPin(null);
    try {
      setHasPin(await fetchHiddenChatPinStatus());
    } catch (caught) {
      setPinStatusError(caught instanceof Error ? caught.message : "PIN settings could not be loaded. Try again.");
    }
  }

  useEffect(() => {
    if (!grant || !expiresAt) return;
    const timeout = window.setTimeout(() => {
      setGrant("");
      setExpiresAt("");
      setConversations([]);
      setUnlockPin("");
      setUnlockingId("");
      setError("Your Hidden Chats session expired. Verify your PIN again.");
    }, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [expiresAt, grant]);

  async function revealHiddenChats(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!isValidPin(pin)) {
      setError("Enter your 6 to 12 digit PIN.");
      return;
    }

    setBusy(true);
    try {
      const result = await postJson("/api/hidden-chats/pin", { action: "verify", pin });
      setPin("");
      const grantResult = result as typeof result & { grant?: string; expiresAt?: string };
      if (!grantResult.grant || !grantResult.expiresAt || !isGrantActive(grantResult.expiresAt)) {
        throw new Error("The PIN could not be verified.");
      }
      await loadHidden(grantResult.grant);
      setGrant(grantResult.grant);
      setExpiresAt(grantResult.expiresAt);
    } catch (caught) {
      setPin("");
      setError(caught instanceof Error ? caught.message : "The PIN could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  async function unhide(event: FormEvent<HTMLFormElement>, conversationId: string) {
    event.preventDefault();
    setBusyId(conversationId);
    setError("");
    if (!isValidPin(unlockPin)) {
      setError("Enter your 6 to 12 digit PIN.");
      setBusyId("");
      return;
    }

    try {
      if (!grant || !isGrantActive(expiresAt)) {
        throw new Error("Verify your PIN again before unhiding this conversation.");
      }
      const result = await postJson("/api/hidden-chats/pin", {
        action: "verify",
        pin: unlockPin,
        conversationId,
      });
      const conversationGrant = result as typeof result & { grant?: string; expiresAt?: string };
      if (
        !conversationGrant.grant
        || !conversationGrant.expiresAt
        || !isGrantActive(conversationGrant.expiresAt)
      ) {
        throw new Error("The PIN could not be verified.");
      }

      await postJson(
        "/api/hidden-chats/preferences",
        { conversationId, isHidden: false },
        hiddenChatGrantHeaders(conversationGrant.grant),
      );
      setUnlockPin("");
      setUnlockingId("");
      await loadHidden(grant);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The chat could not be unhidden.");
    } finally {
      setBusyId("");
    }
  }

  function lock() {
    setGrant("");
    setExpiresAt("");
    setConversations([]);
    setPin("");
    setUnlockPin("");
    setUnlockingId("");
    setError("");
  }

  return (
    <div className="secondary-view">
      <div className="secondary-heading">
        <div className="eyebrow"><LockKeyhole size={14} /> PRIVATE INBOX</div>
        <h1>Hidden <span>Chats.</span></h1>
        <p>Verify your PIN to reveal conversations you have hidden.</p>
      </div>
      {!userId
        ? <section className="hidden-chats-panel"><p>Sign in to access Hidden Chats.</p></section>
        : hasPin === null
            ? <section className="hidden-chats-panel"><p className={`hidden-chat-status${pinStatusError ? " hidden-chat-status-error" : ""}`} role={pinStatusError ? "alert" : "status"}>{pinStatusError || "Checking PIN settings…"}{pinStatusError && <> <button className="text-button" type="button" onClick={() => void retryPinStatus()}>Try again</button></>}</p></section>
          : !hasPin
            ? <section className="hidden-chats-panel">
                <p>Set up a PIN before you can hide or open conversations.</p>
                <PinManager userId={userId} onPinUpdated={() => setHasPin(true)} />
              </section>
            : !grant
              ? <section className="hidden-chats-panel">
                  <form className="hidden-chat-unlock-form" onSubmit={(event) => void revealHiddenChats(event)}>
                    <label htmlFor="hidden-chat-unlock-pin">Enter your PIN</label>
                    <input id="hidden-chat-unlock-pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={12} value={pin} onChange={(event) => setPin(event.target.value)} />
                    {error && <p className="hidden-chat-error" role="alert">{error}</p>}
                    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Verifying…" : <><Eye size={15} />Verify PIN</>}</button>
                  </form>
                  <p className="hidden-chat-security-note"><ShieldCheck size={14} />Access closes automatically after five minutes. PIN access uses a server-verified grant.</p>
                </section>
              : <section className="hidden-chats-panel">
                  <div className="hidden-chats-topline">
                    <p><ShieldCheck size={15} />Hidden list visible until {new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    <button className="text-button" type="button" onClick={lock}><LockKeyhole size={14} />Lock now</button>
                  </div>
                  {error && <p className="hidden-chat-error" role="alert">{error}</p>}
                  {conversations.length === 0
                    ? <div className="hidden-chats-empty"><LockKeyhole size={22} /><strong>No hidden conversations</strong><span>Conversations you hide will appear here.</span></div>
                    : <div className="real-conversation-list">{conversations.map((conversation) => (
                        <article className="real-conversation-row" key={conversation.id}>
                          <span className="avatar avatar-md" role="img" aria-label={getConversationName(conversation, userId)}>
                            {getConversationName(conversation, userId).slice(0, 1)}
                          </span>
                          <div className="real-conversation-copy">
                            <strong>{getConversationName(conversation, userId)}</strong>
                            <span>{getConversationActivity(conversation)}</span>
                          </div>
                          {unlockingId === conversation.id
                            ? <form
                                className="hidden-chat-unlock-form"
                                onSubmit={(event) => void unhide(event, conversation.id)}
                              >
                                <label htmlFor={`unhide-pin-${conversation.id}`}>Confirm PIN to unhide</label>
                                <input
                                  id={`unhide-pin-${conversation.id}`}
                                  type="password"
                                  inputMode="numeric"
                                  autoComplete="current-password"
                                  maxLength={12}
                                  value={unlockPin}
                                  onChange={(event) => setUnlockPin(event.target.value)}
                                />
                                <button className="text-button" type="submit" disabled={busyId === conversation.id}>
                                  <RefreshCw size={14} />{busyId === conversation.id ? "Verifying…" : "Verify and unhide"}
                                </button>
                                <button
                                  className="text-button"
                                  type="button"
                                  disabled={busyId === conversation.id}
                                  onClick={() => { setUnlockingId(""); setUnlockPin(""); setError(""); }}
                                >Cancel</button>
                              </form>
                            : <button
                                className="text-button"
                                type="button"
                                disabled={busyId === conversation.id}
                                onClick={() => { setUnlockingId(conversation.id); setUnlockPin(""); setError(""); }}
                              ><RefreshCw size={14} />Unhide</button>}
                        </article>
                      ))}</div>}
                  <p className="hidden-chat-security-note"><ShieldCheck size={14} />Each conversation requires a separate PIN grant. Access closes automatically after five minutes.</p>
                </section>}
    </div>
  );
}
