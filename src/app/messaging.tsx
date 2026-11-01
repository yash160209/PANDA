"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { EyeOff, ImagePlus, LockKeyhole, MessageCircle, Phone, Search, Send, Video, X } from "lucide-react";
import Image from "next/image";
import { z } from "zod";
import {
  isHiddenInboxSessionActive,
  isValidSecretCode,
  resolveMessageSearchSubmission,
  shouldSearchPeopleForQuery,
} from "@/lib/hidden-chats/entry";
import { hiddenChatGrantHeaders } from "@/lib/hidden-chats/grant";
import { canHideConversation, filterVisibleConversations } from "@/lib/hidden-chats/rules";
import { fetchHiddenChatPinStatus } from "@/lib/hidden-chats/pin-status";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { chatMediaKind, validateChatMedia } from "@/lib/messaging/media";
import { parseIncomingCallOffer } from "@/lib/messaging/signals";

type UserProfile = {
  id: string;
  username: string;
  display_name: string;
  bio?: string;
  avatar_path: string | null;
  avatar_url?: string;
  is_private?: boolean;
  messagePermission?: MessagePermission;
};
type MessagePermission = "loading" | "allowed" | "requested" | "required" | "unavailable";

type Conversation = {
  id: string;
  updated_at: string;
  conversation_participants: Array<{ user_id: string; profiles: UserProfile | UserProfile[] | null }>;
};

type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  message_attachments?: Array<{ id: string; storage_path: string; media_type: "image" | "video" | "audio" }>;
  mediaUrl?: string;
};

type SearchSubmission = { query: string; openHiddenInbox: boolean };
type HiddenInboxConversation = {
  id: string;
  updated_at: string;
  partner_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  latest_preview: string | null;
  latest_at: string | null;
  unread_count: number;
};
const discoverableProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  display_name: z.string(),
  is_private: z.boolean(),
});
const hiddenInboxConversationSchema = z.object({
  id: z.string().uuid(),
  updated_at: z.string(),
  partner_id: z.string().uuid(),
  username: z.string(),
  display_name: z.string(),
  avatar_path: z.string().nullable(),
  latest_preview: z.string().nullable(),
  latest_at: z.string().nullable(),
  unread_count: z.number().int().nonnegative(),
});

function otherUser(conversation: Conversation, userId: string): UserProfile | null {
  const participant = conversation.conversation_participants.find((entry) => entry.user_id !== userId);
  const profile = participant?.profiles;
  return Array.isArray(profile) ? profile[0] ?? null : profile ?? null;
}

function displayName(profile: UserProfile | null) {
  return profile?.display_name || (profile?.username ? `@${profile.username}` : "Conversation");
}

export function MessagingView({
  userId,
  onRequirePinSetup,
}: {
  userId: string | null;
  onRequirePinSetup: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [allowLiteralSearch, setAllowLiteralSearch] = useState("");
  const [hiddenInboxOpen, setHiddenInboxOpen] = useState(false);
  const [hiddenInboxGrant, setHiddenInboxGrant] = useState("");
  const [hiddenInboxExpiresAt, setHiddenInboxExpiresAt] = useState("");
  const [hiddenInboxConversations, setHiddenInboxConversations] = useState<HiddenInboxConversation[]>([]);
  const [hiddenInboxLoading, setHiddenInboxLoading] = useState(false);
  const [selectedHiddenConversation, setSelectedHiddenConversation] = useState<Conversation | null>(null);
  const [conversationGrant, setConversationGrant] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [profileTarget, setProfileTarget] = useState<UserProfile | null>(null);
  const [searching, setSearching] = useState(false);
  const [followRequestBusyId, setFollowRequestBusyId] = useState("");
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pinStatusError, setPinStatusError] = useState("");
  const [busyConversation, setBusyConversation] = useState("");
  const [availability, setAvailability] = useState<"connecting" | "subscribed" | "error">("connecting");
  const [threadPermission, setThreadPermission] = useState<MessagePermission>("loading");
  const [canRetryUpload, setCanRetryUpload] = useState(false);
  const [callTarget, setCallTarget] = useState<{
    conversationId: string;
    person: UserProfile;
    mode: "voice" | "video";
    grant?: string;
    initialOffer?: { callId: string; description: RTCSessionDescriptionInit };
  } | null>(null);
  const uploadRetry = useRef<{ messageId: string; file: File } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId)
    ?? selectedHiddenConversation;
  const currentOtherUser = userId && selectedConversation ? otherUser(selectedConversation, userId) : null;
  const messageTargetId = currentOtherUser?.id ?? "";

  const lockHiddenInbox = useCallback((message = "") => {
    setHiddenInboxOpen(false);
    setHiddenInboxGrant("");
    setHiddenInboxExpiresAt("");
    setHiddenInboxConversations([]);
    setCallTarget(null);
    setSelectedHiddenConversation(null);
    setConversationGrant("");
    setSelectedId("");
    setMessages([]);
    setMessageDraft("");
    setSelectedFile(null);
    setQuery("");
    setAllowLiteralSearch("");
    setSearchResults([]);
    uploadRetry.current = null;
    setCanRetryUpload(false);
    setError(message);
  }, []);

  const loadHiddenInbox = useCallback(async (grant: string) => {
    setHiddenInboxLoading(true);
    try {
      const response = await fetch("/api/hidden-chats/conversations", {
        headers: hiddenChatGrantHeaders(grant),
        cache: "no-store",
      });
      const result = (await response.json()) as {
        summaries?: unknown;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "The Hidden Inbox could not be loaded.");
      const summaries = z.array(hiddenInboxConversationSchema).parse(result.summaries ?? []);
      setHiddenInboxConversations(summaries);
    } finally {
      setHiddenInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hiddenInboxOpen || !hiddenInboxGrant || !hiddenInboxExpiresAt) return;
    const timer = window.setTimeout(
      () => lockHiddenInbox("Your Hidden Inbox session expired. Enter your Secret Code in Inbox search to reopen it."),
      Math.max(0, Date.parse(hiddenInboxExpiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [hiddenInboxExpiresAt, hiddenInboxGrant, hiddenInboxOpen, lockHiddenInbox]);

  useEffect(() => {
    if (!hiddenInboxGrant) return;
    return () => {
      void fetch("/api/hidden-chats/entry", {
        method: "DELETE",
        headers: hiddenChatGrantHeaders(hiddenInboxGrant),
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [hiddenInboxGrant]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseBrowserClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) lockHiddenInbox();
    });
    return () => subscription.unsubscribe();
  }, [lockHiddenInbox, userId]);

  useEffect(() => {
    if (!selectedId || !messageTargetId) return;

    let active = true;
    const timer = window.setTimeout(() => {
      try {
        void createSupabaseBrowserClient()
          .rpc("get_message_permission", { p_other_user_id: messageTargetId })
          .then(({ data, error: permissionError }) => {
            if (!active) return;
            if (permissionError) {
              setThreadPermission("unavailable");
              setError("Messaging permission could not be verified. Refresh the inbox and try again.");
              return;
            }
            const permission = data === "allowed" || data === "requested" || data === "required"
              ? data
              : "unavailable";
            setThreadPermission(permission);
            if (permission !== "allowed") setMessages([]);
          }, () => {
            if (!active) return;
            setThreadPermission("unavailable");
            setError("Messaging permission could not be verified. Refresh the inbox and try again.");
          });
      } catch {
        if (active) {
          setThreadPermission("unavailable");
          setError("Messaging permission could not be verified. Refresh the inbox and try again.");
        }
      }
    }, 0);

    return () => { active = false; window.clearTimeout(timer); };
  }, [messageTargetId, selectedId]);

  const loadConversations = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const [preferenceResult, conversationsResult] = await Promise.all([
        supabase.from("hidden_chat_preferences").select("conversation_id").eq("user_id", userId).eq("is_hidden", true),
        supabase.from("conversations")
          .select("id,updated_at,conversation_participants(user_id,profiles(id,username,display_name,bio,avatar_path))")
          .order("updated_at", { ascending: false }),
      ]);
      if (preferenceResult.error || conversationsResult.error) {
        throw new Error("Conversations could not be loaded. Check your connection and database setup.");
      }
      const hidden = new Set((preferenceResult.data ?? []).map((preference) => preference.conversation_id));
      const next = filterVisibleConversations((conversationsResult.data ?? []) as Conversation[], hidden);
      setConversations(next);
      setSelectedId((current) => current && next.some((conversation) => conversation.id === current) ? current : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConversations(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void fetchHiddenChatPinStatus()
      .then((value) => { if (active) { setHasPin(value); setPinStatusError(""); } })
      .catch((caught: unknown) => {
        if (active) setPinStatusError(caught instanceof Error ? caught.message : "PIN settings could not be loaded.");
      });
    return () => { active = false; };
  }, [userId]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const supabase = createSupabaseBrowserClient(
      conversationGrant ? hiddenChatGrantHeaders(conversationGrant) : undefined,
    );
    const { error: readError } = await supabase.rpc("mark_conversation_messages_read", {
      p_conversation_id: conversationId,
    });
    if (readError) throw new Error("Unread messages could not be marked as read.");
    setHiddenInboxConversations((current) => current.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation,
    ));
    const { data, error: messageError } = await supabase.from("messages")
      .select("id,conversation_id,sender_id,body,created_at,message_attachments(id,storage_path,media_type)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (messageError) throw new Error("Messages could not be loaded. Verify that migrations and conversation permissions are configured.");

    const rows = (data ?? []) as ChatMessage[];
    const signed = await Promise.all(rows.map(async (message) => {
      const attachment = message.message_attachments?.[0];
      if (!attachment) return message;
      const { data: urlData, error: urlError } = await supabase.storage
        .from("message-media")
        .createSignedUrl(attachment.storage_path, 300);
      if (urlError || !urlData?.signedUrl) {
        throw new Error("A chat attachment could not be opened. Check private storage permissions.");
      }
      return { ...message, mediaUrl: urlData.signedUrl };
    }));
    return signed;
  }, [conversationGrant]);

  useEffect(() => {
    if (!selectedId || threadPermission !== "allowed") {
      return;
    }
    let active = true;
    const loadTimer = window.setTimeout(() => {
      void loadMessages(selectedId)
        .then((loaded) => { if (active) { setMessages(loaded); setError(""); } })
        .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Messages could not be loaded."); });
    }, 0);

    const supabase = createSupabaseBrowserClient(
      conversationGrant ? hiddenChatGrantHeaders(conversationGrant) : undefined,
    );
    const channel = supabase.channel(`messages:${selectedId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${selectedId}`,
      }, () => {
        void loadMessages(selectedId).then((loaded) => {
          if (active) setMessages(loaded);
        }).catch((caught: unknown) => {
          if (active) setError(caught instanceof Error ? caught.message : "New messages could not be loaded.");
        });
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setAvailability("subscribed");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setAvailability("error");
          setError("Live message updates could not connect. You can still refresh the conversation.");
        }
      });

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
      void supabase.removeChannel(channel);
    };
  }, [conversationGrant, loadMessages, selectedId, threadPermission]);

  useEffect(() => {
    if (!userId || (conversations.length === 0 && !selectedHiddenConversation) || threadPermission !== "allowed") return;
    const supabase = createSupabaseBrowserClient(
      conversationGrant ? hiddenChatGrantHeaders(conversationGrant) : undefined,
    );
    let active = true;
    const signalConversations = selectedHiddenConversation
      ? [...conversations.filter((conversation) => conversation.id !== selectedHiddenConversation.id), selectedHiddenConversation]
      : conversations;
    const channels = signalConversations.map((conversation) => supabase
      .channel(`call:${conversation.id}`, { config: { private: true, broadcast: { self: false } } })
      .on("broadcast", { event: "call-offer" }, ({ payload }) => {
        const offer = parseIncomingCallOffer(payload, userId);
        if (!active || !offer) return;
        const person = otherUser(conversation, userId);
        if (!person) return;
        setCallTarget((current) => current ?? {
          conversationId: conversation.id,
          person,
          mode: offer.mode,
          grant: conversation.id === selectedId ? conversationGrant : undefined,
          initialOffer: { callId: offer.callId, description: offer.description },
        });
      })
      .subscribe());
    return () => {
      active = false;
      channels.forEach((channel) => { void supabase.removeChannel(channel); });
    };
  }, [conversationGrant, conversations, selectedHiddenConversation, selectedId, threadPermission, userId]);

  useEffect(() => {
    if (!userId) return;
    if (!shouldSearchPeopleForQuery(query, allowLiteralSearch === query)) {
      return;
    }
    const trimmed = query.trim();
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: searchError } = await supabase.rpc("discover_profiles", {
          p_query: trimmed.slice(0, 80),
          p_limit: 10,
        });
        if (searchError) throw new Error("People could not be searched.");
        const discovered = z.array(discoverableProfileSchema).parse(data ?? []);
        const ids = discovered.map((profile) => profile.id);
        const { data: readableProfiles, error: readableError } = ids.length
          ? await supabase.from("profiles")
              .select("id,username,display_name,bio,avatar_path,is_private")
              .in("id", ids)
          : { data: [], error: null };
        if (readableError) throw new Error("People could not be searched.");
        const readableById = new Map((readableProfiles ?? []).map((profile) => [profile.id, profile]));
        const results = await Promise.all(discovered.map(async (profile): Promise<UserProfile> => {
          const readable = readableById.get(profile.id);
          const { data: permissionData, error: permissionError } = await supabase.rpc(
            "get_message_permission",
            { p_other_user_id: profile.id },
          );
          if (permissionError) throw new Error("Messaging permissions could not be checked.");
          const permission: MessagePermission = permissionData === "allowed"
            || permissionData === "requested"
            || permissionData === "required"
            ? permissionData
            : "unavailable";
          return {
            ...profile,
            bio: readable?.bio ?? "",
            avatar_path: readable?.avatar_path ?? null,
            is_private: profile.is_private,
            messagePermission: permission,
          };
        }));
        if (active) setSearchResults(results);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "People could not be searched.");
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [allowLiteralSearch, query, userId]);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuery = query;
    if (!isValidSecretCode(submittedQuery.trim())) return;
    try {
      const response = await fetch("/api/hidden-chats/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: submittedQuery }),
        cache: "no-store",
      });
      if (!response.ok) {
        setError("Search could not be completed. Try again.");
        return;
      }
      const result = (await response.json()) as {
        matched?: boolean;
        grant?: string;
        expiresAt?: string;
      };
      const submission: SearchSubmission = {
        ...resolveMessageSearchSubmission(submittedQuery, result.matched === true),
      };
      if (submission.openHiddenInbox) {
        if (!result.grant || !result.expiresAt || !isHiddenInboxSessionActive(result.expiresAt)) {
          throw new Error("The Hidden Inbox could not be opened. Enter your Secret Code again.");
        }
        await loadHiddenInbox(result.grant);
        setHiddenInboxOpen(true);
        setHiddenInboxGrant(result.grant);
        setHiddenInboxExpiresAt(result.expiresAt);
        setSelectedId("");
        setSelectedHiddenConversation(null);
        setConversationGrant("");
        setMessages([]);
        setQuery("");
        setAllowLiteralSearch("");
        setSearchResults([]);
        setError("");
        return;
      }
      setAllowLiteralSearch(submittedQuery);
      setQuery(submission.query);
    } catch {
      setError("Search could not be completed. Try again.");
    }
  }

  async function openConversation(profile: UserProfile) {
    if (profile.messagePermission && profile.messagePermission !== "allowed") {
      setError(profile.messagePermission === "requested"
        ? "Your follow request is pending. Messaging is available after approval."
        : "This account is private. Send a follow request to message.");
      return;
    }
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: openError } = await supabase.rpc("open_direct_conversation", { p_other_user_id: profile.id });
      if (openError || typeof data !== "string") {
        throw new Error("The conversation could not be opened. Check database setup and participant permissions.");
      }
      setHiddenInboxOpen(false);
      setHiddenInboxGrant("");
      setHiddenInboxExpiresAt("");
      setHiddenInboxConversations([]);
      setCallTarget(null);
      setSelectedHiddenConversation(null);
      setConversationGrant("");
      await loadConversations();
      setMessages([]);
      setAvailability("connecting");
      setThreadPermission("loading");
      setSelectedId(data);
      setProfileTarget(null);
      setQuery("");
      setAllowLiteralSearch("");
      setSearchResults([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The conversation could not be opened.");
    }
  }

  async function openHiddenConversation(summary: HiddenInboxConversation) {
    if (!hiddenInboxGrant || !isHiddenInboxSessionActive(hiddenInboxExpiresAt)) {
      lockHiddenInbox("Your Hidden Inbox session expired. Enter your Secret Code in Inbox search to reopen it.");
      return;
    }

    setBusyConversation(summary.id);
    setError("");
    try {
      const response = await fetch("/api/hidden-chats/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...hiddenChatGrantHeaders(hiddenInboxGrant),
        },
        body: JSON.stringify({ conversationId: summary.id }),
        cache: "no-store",
      });
      const grantResult = (await response.json()) as { grant?: string; expiresAt?: string; error?: string };
      if (!response.ok || !grantResult.grant || !grantResult.expiresAt
        || !isHiddenInboxSessionActive(grantResult.expiresAt)) {
        throw new Error(grantResult.error ?? "This conversation is unavailable.");
      }

      const supabase = createSupabaseBrowserClient(hiddenChatGrantHeaders(grantResult.grant));
      const { data, error: conversationError } = await supabase.from("conversations")
        .select("id,updated_at,conversation_participants(user_id,profiles(id,username,display_name,bio,avatar_path))")
        .eq("id", summary.id)
        .single();
      if (conversationError || !data) {
        throw new Error("This conversation is unavailable.");
      }

      setConversationGrant(grantResult.grant);
      setSelectedHiddenConversation(data as Conversation);
      setSelectedId(summary.id);
      setMessages([]);
      setThreadPermission("loading");
      setMessageDraft("");
      setSelectedFile(null);
      setCanRetryUpload(false);
      uploadRetry.current = null;
      setAvailability("connecting");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This conversation is unavailable.");
    } finally {
      setBusyConversation("");
    }
  }

  function exitHiddenInbox() {
    lockHiddenInbox();
  }

  async function requestFollow(profile: UserProfile) {
    if (!userId || profile.messagePermission === "requested" || followRequestBusyId) return;
    setFollowRequestBusyId(profile.id);
    setError("");
    try {
      const { data, error: followError } = await createSupabaseBrowserClient()
        .rpc("follow_profile", { p_target_id: profile.id });
      if (followError || data !== "requested") {
        throw new Error("The follow request could not be sent.");
      }
      setSearchResults((current) => current.map((result) => result.id === profile.id
        ? { ...result, messagePermission: "requested" }
        : result));
      if (currentOtherUser?.id === profile.id) setThreadPermission("requested");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The follow request could not be sent.");
    } finally {
      setFollowRequestBusyId("");
    }
  }

  async function openProfile(profile: UserProfile) {
    setError("");
    try {
      let avatarUrl = "";
      if (profile.avatar_path) {
        const { data, error: avatarError } = await createSupabaseBrowserClient()
          .storage.from("profile-avatars").createSignedUrl(profile.avatar_path, 300);
        if (avatarError) setError("The profile photo could not be loaded.");
        avatarUrl = data?.signedUrl ?? "";
      }
      setProfileTarget({ ...profile, avatar_url: avatarUrl });
    } catch {
      setError("The profile could not be loaded. Please try again.");
    }
  }

  async function hideConversation(conversationId: string) {
    if (!canHideConversation(hasPin === true)) {
      onRequirePinSetup();
      return;
    }
    if (!window.confirm("Hide this conversation from your inbox? You can restore it later.")) return;
    setBusyConversation(conversationId);
    setError("");
    try {
      const response = await fetch("/api/hidden-chats/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, isHidden: true }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The chat could not be hidden.");
      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
      if (selectedId === conversationId) {
        setMessages([]);
        setSelectedId("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The chat could not be hidden.");
    } finally {
      setBusyConversation("");
    }
  }

  async function uploadAttachment(messageId: string, file: File) {
    const supabase = createSupabaseBrowserClient(
      conversationGrant ? hiddenChatGrantHeaders(conversationGrant) : undefined,
    );
    const { data: existingAttachment, error: existingError } = await supabase
      .from("message_attachments")
      .select("id")
      .eq("message_id", messageId)
    .limit(1)
    .maybeSingle();
    if (existingError) throw new Error("The existing attachment status could not be checked.");
    if (existingAttachment) return;

    const extensionByType: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/webm": "webm",
    };
    const path = `${userId}/${messageId}/attachment.${extensionByType[file.type]}`;
    const { error: uploadError } = await supabase.storage.from("message-media").upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) throw new Error("The file upload failed. Retry the upload or send the message without media.");
    const { error: attachmentError } = await supabase.from("message_attachments").insert({
      message_id: messageId,
      storage_path: path,
      media_type: chatMediaKind(file.type),
    });
    if (attachmentError) throw new Error("The file uploaded but its attachment record could not be saved.");
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !selectedId || threadPermission !== "allowed" || sending || (!messageDraft.trim() && !selectedFile)) return;
    if (selectedFile) {
      const validation = validateChatMedia(selectedFile);
      if (validation) { setError(validation); return; }
    }

    setSending(true);
    setError("");
    uploadRetry.current = null;
    setCanRetryUpload(false);
    try {
      const supabase = createSupabaseBrowserClient(
        conversationGrant ? hiddenChatGrantHeaders(conversationGrant) : undefined,
      );
      const { data, error: insertError } = await supabase.from("messages")
        .insert({ conversation_id: selectedId, sender_id: userId, body: messageDraft.trim() })
        .select("id")
        .single();
      if (insertError || !data) {
        if (currentOtherUser) {
          const { data: currentPermission, error: permissionError } = await supabase.rpc(
            "get_message_permission",
            { p_other_user_id: currentOtherUser.id },
          );
          if (!permissionError && (currentPermission === "required" || currentPermission === "requested")) {
            setThreadPermission(currentPermission);
            setMessages([]);
            setError(currentPermission === "requested"
              ? "Your follow request is pending. Messaging is available after approval."
              : "This account is private. Send a follow request to message.");
            return;
          }
        }
        throw new Error("Your message could not be sent.");
      }
      if (selectedFile) {
        try {
          await uploadAttachment(data.id, selectedFile);
        } catch (caught) {
          uploadRetry.current = { messageId: data.id, file: selectedFile };
          setCanRetryUpload(true);
          throw caught;
        }
      }
      setMessageDraft("");
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessages(await loadMessages(selectedId));
      if (!hiddenInboxOpen) await loadConversations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function retryUpload() {
    const pending = uploadRetry.current;
    if (!pending) return;
    setSending(true);
    setError("");
    try {
      await uploadAttachment(pending.messageId, pending.file);
      uploadRetry.current = null;
      setCanRetryUpload(false);
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      if (selectedId) setMessages(await loadMessages(selectedId));
    } catch (caught) {
      setCanRetryUpload(true);
      setError(caught instanceof Error ? caught.message : "The upload could not be retried.");
    } finally {
      setSending(false);
    }
  }

  if (!userId) {
    return <section className="messaging-auth-required"><MessageCircle size={25} /><strong>Sign in to use real messages</strong><span>Your inbox and conversations are private to your account.</span><a className="primary-button" href="/login">Sign in</a></section>;
  }

  const filtered = conversations.filter((conversation) => {
    const person = otherUser(conversation, userId);
    const searchTerm = query.trim().toLowerCase();
    return !searchTerm || displayName(person).toLowerCase().includes(searchTerm) || person?.username.toLowerCase().includes(searchTerm);
  });

  return (
    <div className="messaging-shell">
      <section className="messaging-people" aria-label="People and conversations">
        {hiddenInboxOpen
          ? <>
              <div className="hidden-inbox-heading">
                <div><LockKeyhole size={16} /><strong>Hidden Inbox</strong></div>
                <button type="button" className="text-button" onClick={exitHiddenInbox}>Exit</button>
              </div>
              <p className="hidden-inbox-expiry">Private list · closes automatically after five minutes</p>
              {error && <p className="messaging-error" role="alert">{error}</p>}
              {hiddenInboxLoading
                ? <p className="messaging-state">Loading hidden conversations…</p>
                : hiddenInboxConversations.length === 0
                  ? <div className="hidden-inbox-empty"><LockKeyhole size={19} /><strong>No hidden conversations</strong><span>Chats you hide will appear here.</span></div>
                  : <div className="hidden-inbox-list">{hiddenInboxConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        className={`hidden-inbox-row${conversation.id === selectedId ? " selected" : ""}`}
                        disabled={busyConversation === conversation.id}
                        onClick={() => void openHiddenConversation(conversation)}
                      >
                        <span className="messaging-avatar">{(conversation.display_name || conversation.username).slice(0, 1)}</span>
                        <span className="hidden-inbox-row-copy">
                          <strong>{conversation.display_name || `@${conversation.username}`}</strong>
                          <small>{busyConversation === conversation.id ? "Opening…" : conversation.latest_preview || "No messages yet"}</small>
                        </span>
                        <span className="hidden-inbox-row-meta">
                          <time>{conversation.latest_at
                            ? new Date(conversation.latest_at).toLocaleDateString([], { month: "short", day: "numeric" })
                            : new Date(conversation.updated_at).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
                          {conversation.unread_count > 0 && <b>{conversation.unread_count}</b>}
                        </span>
                      </button>
                    ))}</div>}
            </>
          : <>
        <form className="inbox-search messaging-search" onSubmit={(event) => void submitSearch(event)}>
          <Search size={15} />
          <input aria-label="Find users or conversations or enter your Secret Code" placeholder="Search people or enter Secret Code" value={query} onChange={(event) => { setQuery(event.target.value); setAllowLiteralSearch(""); setSearching(false); if (event.target.value.trim().length < 2 || isValidSecretCode(event.target.value.trim())) setSearchResults([]); }} />
        </form>
        {userId && query.trim().length >= 2 && searchResults.length > 0 && <div className="messaging-search-results">
          <strong>People</strong>
          {searchResults.map((profile) => <div key={profile.id} className="messaging-person-result">
            <button type="button" className="messaging-person-open" disabled={profile.messagePermission !== "allowed"} onClick={() => void openConversation(profile)}>
              <span className="messaging-avatar">{displayName(profile).slice(0, 1)}</span>
              <span><b>{displayName(profile)}</b><small>@{profile.username}{profile.is_private ? " · Private account" : profile.bio ? ` · ${profile.bio}` : ""}</small></span>
            </button>
            {profile.is_private && profile.messagePermission !== "allowed"
              ? <div className="messaging-follow-action">
                  <small>{profile.messagePermission === "requested"
                    ? "Your follow request is pending."
                    : "This account is private. Send a follow request to message."}</small>
                  <button type="button" disabled={profile.messagePermission === "requested" || followRequestBusyId === profile.id} onClick={() => void requestFollow(profile)}>
                    {profile.messagePermission === "requested" ? "Requested" : followRequestBusyId === profile.id ? "Sending…" : "Request to Follow"}
                  </button>
                </div>
              : <button type="button" className="messaging-view-profile" onClick={() => void openConversation(profile)}>Message</button>}
            <button type="button" className="messaging-view-profile" onClick={() => void openProfile(profile)}>View profile</button>
          </div>)}
        </div>}
        {searching && <p className="messaging-state">Searching people…</p>}
        <div className="messaging-list-heading"><strong>Conversations</strong><span>{availability === "subscribed" ? "Live" : availability === "error" ? "Live updates unavailable" : "Connecting…"}</span></div>
        {loading && <p className="messaging-state">Loading conversations…</p>}
        {!loading && filtered.length === 0 && <p className="messaging-state">{conversations.length ? "No conversations match this search." : "No conversations yet. Search for a username to start one."}</p>}
        {filtered.map((conversation) => {
          const person = otherUser(conversation, userId);
          return <div key={conversation.id} className={`messaging-thread-option${conversation.id === selectedId ? " selected" : ""}`}>
            <button type="button" onClick={() => { setSelectedHiddenConversation(null); setConversationGrant(""); setMessages([]); setAvailability("connecting"); setThreadPermission("loading"); setSelectedId(conversation.id); setError(""); }}>
              <span className="messaging-avatar">{displayName(person).slice(0, 1)}</span>
              <span><b>{displayName(person)}</b><small>@{person?.username}</small></span>
            </button>
            <button type="button" className="messaging-hide-button" aria-label={`Hide conversation with ${displayName(person)}`} title="Hide conversation" disabled={busyConversation === conversation.id} onClick={() => void hideConversation(conversation.id)}><EyeOff size={15} /></button>
          </div>;
        })}
            </>}
      </section>
      <section className="messaging-thread" aria-label="Selected conversation">
        {!selectedConversation || !currentOtherUser
          ? <div className="messaging-empty">{hiddenInboxOpen ? <LockKeyhole size={26} /> : <MessageCircle size={26} />}<strong>{hiddenInboxOpen ? "Choose a hidden conversation" : "Choose a conversation"}</strong><span>{hiddenInboxOpen ? "Your hidden conversations are available only in this private inbox." : "Search by username to start a private, persisted chat."}</span></div>
          : <>
              <header className="messaging-thread-header">
                <div><span className="messaging-avatar">{displayName(currentOtherUser).slice(0, 1)}</span><div><strong>{displayName(currentOtherUser)}</strong><small>@{currentOtherUser.username}</small></div></div>
                <div className="messaging-call-actions">
                  <button type="button" aria-label="Start audio call" title="Start audio call" disabled={threadPermission !== "allowed"} onClick={() => setCallTarget({ conversationId: selectedId, person: currentOtherUser, mode: "voice", grant: conversationGrant || undefined })}><Phone size={17} /></button>
                  <button type="button" aria-label="Start video call" title="Start video call" disabled={threadPermission !== "allowed"} onClick={() => setCallTarget({ conversationId: selectedId, person: currentOtherUser, mode: "video", grant: conversationGrant || undefined })}><Video size={17} /></button>
                </div>
              </header>
              {threadPermission === "loading" && <div className="messaging-private-lock" role="status">Checking messaging permissions…</div>}
              {threadPermission === "required" && <div className="messaging-private-lock" role="status">
                <strong>This account is private. Send a follow request to message.</strong>
                <button type="button" disabled={followRequestBusyId === currentOtherUser.id} onClick={() => void requestFollow(currentOtherUser)}>
                  {followRequestBusyId === currentOtherUser.id ? "Sending…" : "Request to Follow"}
                </button>
              </div>}
              {threadPermission === "requested" && <div className="messaging-private-lock" role="status">
                <strong>Your follow request is pending. Messaging is available after approval.</strong>
                <button type="button" disabled>Requested</button>
              </div>}
              {threadPermission === "unavailable" && <div className="messaging-private-lock" role="alert">This conversation is not available for messaging.</div>}
              {threadPermission === "allowed" && <div className="messaging-history" aria-live="polite">
                {messages.length === 0
                  ? <div className="messaging-state">No messages yet. Send the first one.</div>
                  : messages.map((message) => <article key={message.id} className={`chat-message${message.sender_id === userId ? " own" : ""}`}>
                      {message.body && <p>{message.body}</p>}
                      {message.message_attachments?.map((attachment) => message.mediaUrl ? attachment.media_type === "video"
                        ? <video key={attachment.id} controls playsInline src={message.mediaUrl} />
                        : <a key={attachment.id} href={message.mediaUrl} target="_blank" rel="noreferrer"><Image src={message.mediaUrl} alt="Shared chat media" width={300} height={300} unoptimized /></a>
                        : <span key={attachment.id} className="messaging-state">Media unavailable</span>)}
                      <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                    </article>)}
              </div>}
              {error && <p className="messaging-error" role="alert">{error} {canRetryUpload && <button className="text-button" type="button" disabled={sending} onClick={() => void retryUpload()}>Retry upload</button>}</p>}
              {threadPermission === "allowed" && <form className="messaging-composer" onSubmit={(event) => void sendMessage(event)}>
                {selectedFile && <div className="messaging-file-chip">{selectedFile.name}<button type="button" aria-label="Remove selected media" onClick={() => { setSelectedFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={14} /></button></div>}
                <textarea aria-label="Write a message" rows={2} maxLength={10000} placeholder="Write a message…" value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} />
                <div className="messaging-composer-actions">
                  <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" aria-label="Choose a photo or video" onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    if (file) {
                      const validation = validateChatMedia(file);
                      if (validation) { setError(validation); event.currentTarget.value = ""; return; }
                    }
                    setError("");
                    setSelectedFile(file);
                  }} />
                  <button className="text-button" type="button" onClick={() => fileInput.current?.click()}><ImagePlus size={16} />Photo/video</button>
                  <span>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : "Private upload · up to 50 MB"}</span>
                  <button className="primary-button" type="submit" disabled={sending || (!messageDraft.trim() && !selectedFile)}>{sending ? "Sending…" : <><Send size={15} />Send</>}</button>
                </div>
              </form>}
            </>}
      </section>
      {pinStatusError && <p className="messaging-error" role="alert">{pinStatusError}</p>}
      {hasPin === false && <p className="sr-only">Set a PIN in Settings before hiding conversations.</p>}
      {profileTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileTarget(null); }}>
        <section className="profile-edit-modal messaging-profile-modal" role="dialog" aria-modal="true" aria-labelledby="messaging-profile-title">
          <header className="modal-header"><h2 id="messaging-profile-title">Profile</h2><button className="icon-button" aria-label="Close profile" onClick={() => setProfileTarget(null)}><X size={20} /></button></header>
          {profileTarget.avatar_url
            ? <Image className="messaging-profile-photo" src={profileTarget.avatar_url} alt={`${displayName(profileTarget)} profile photo`} width={88} height={88} unoptimized />
            : <span className="messaging-avatar messaging-profile-photo-fallback">{displayName(profileTarget).slice(0, 1)}</span>}
          <h3>{displayName(profileTarget)}</h3>
          <p>@{profileTarget.username}</p>
          <p>{profileTarget.is_private && profileTarget.messagePermission !== "allowed"
            ? "This account is private. Send a follow request to message."
            : profileTarget.bio || "No bio has been added yet."}</p>
          {profileTarget.is_private && profileTarget.messagePermission !== "allowed"
            ? <button type="button" className="primary-button" disabled={profileTarget.messagePermission === "requested" || followRequestBusyId === profileTarget.id} onClick={() => void requestFollow(profileTarget)}>
                {profileTarget.messagePermission === "requested" ? "Requested" : followRequestBusyId === profileTarget.id ? "Sending…" : "Request to Follow"}
              </button>
            : <button type="button" className="primary-button" onClick={() => void openConversation(profileTarget)}><MessageCircle size={15} />Message</button>}
        </section>
      </div>}
      {callTarget && <WebRtcCall
        userId={userId}
        conversationId={callTarget.conversationId}
        person={callTarget.person}
        mode={callTarget.mode}
        grant={callTarget.grant}
        initialOffer={callTarget.initialOffer}
        onClose={() => setCallTarget(null)}
      />}
    </div>
  );
}

function WebRtcCall({
  userId,
  conversationId,
  person,
  mode,
  grant,
  onClose,
  initialOffer,
}: {
  userId: string;
  conversationId: string;
  person: UserProfile;
  mode: "voice" | "video";
  grant?: string;
  onClose: () => void;
  initialOffer?: { callId: string; description: RTCSessionDescriptionInit };
}) {
  const channelRef = useRef<ReturnType<ReturnType<typeof createSupabaseBrowserClient>["channel"]> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callIdRef = useRef(initialOffer?.callId ?? "");
  const incomingOffer = useRef<{ callId: string; description: RTCSessionDescriptionInit } | null>(initialOffer ?? null);
  const pendingOfferResolver = useRef<((description: RTCSessionDescriptionInit) => void) | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const [callState, setCallState] = useState<"connecting" | "ready" | "calling" | "incoming" | "active" | "ended" | "error">(initialOffer ? "incoming" : "connecting");
  const [callError, setCallError] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(mode !== "video");
  const [incomingCallId, setIncomingCallId] = useState(initialOffer?.callId ?? "");
  const peerId = person.id;

  const stopCallMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const sendSignal = useCallback(async (event: string, payload: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel) throw new Error("Call signaling is not connected.");
    const status = await channel.send({ type: "broadcast", event, payload: { ...payload, senderId: userId } });
    if (status !== "ok") throw new Error("Call signaling could not deliver an update. Check Supabase Realtime setup.");
  }, [userId]);

  const getPeerConnection = useCallback(async (callId: string) => {
    if (peerRef.current) return peerRef.current;
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerRef.current = connection;
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendSignal("ice-candidate", { callId, candidate: event.candidate.toJSON() })
        .catch((caught: unknown) => setCallError(caught instanceof Error ? caught.message : "Call signaling failed."));
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0];
      if (mode === "video" && remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      else if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") setCallState("active");
      if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
        setCallError("The peer connection was lost. Network restrictions may require a TURN relay.");
      }
    };
    return connection;
  }, [mode, sendSignal]);

  const startLocalCall = useCallback(async (callId: string) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone or camera access.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
    localStreamRef.current = stream;
    const peer = await getPeerConnection(callId);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    return peer;
  }, [getPeerConnection, mode]);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient(grant ? hiddenChatGrantHeaders(grant) : undefined);
    const channel = supabase.channel(`call:${conversationId}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "call-offer" }, async ({ payload }) => {
        const offer = parseIncomingCallOffer(payload, userId);
        if (!active || !offer) return;
        callIdRef.current = offer.callId;
        if (!incomingOffer.current) {
          incomingOffer.current = {
            callId: offer.callId,
            description: offer.description,
          };
          pendingOfferResolver.current?.(offer.description);
        }
        setIncomingCallId(offer.callId);
        setCallState("incoming");
      })
      .on("broadcast", { event: "call-answer" }, async ({ payload }) => {
        if (!active || payload.senderId === userId || payload.callId !== callIdRef.current || !payload.description) return;
        const peer = peerRef.current;
        if (!peer) return;
        try {
          await peer.setRemoteDescription(payload.description as RTCSessionDescriptionInit);
          for (const candidate of pendingCandidates.current.splice(0)) await peer.addIceCandidate(candidate);
        } catch {
          setCallError("The call answer could not be negotiated.");
        }
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (!active || payload.senderId === userId || payload.callId !== callIdRef.current || !payload.candidate) return;
        const candidate = payload.candidate as RTCIceCandidateInit;
        if (peerRef.current?.remoteDescription) {
          await peerRef.current.addIceCandidate(candidate).catch(() => setCallError("A network candidate could not be added."));
        } else {
          pendingCandidates.current.push(candidate);
        }
      })
      .on("broadcast", { event: "call-end" }, ({ payload }) => {
        if (!active || payload.senderId === userId || payload.callId !== callIdRef.current) return;
        stopCallMedia();
        setCallState("ended");
      })
      .on("broadcast", { event: "call-reject" }, ({ payload }) => {
        if (!active || payload.senderId === userId || payload.callId !== callIdRef.current) return;
        stopCallMedia();
        setCallState("ended");
        setCallError("The other person declined the call.");
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED" && !initialOffer) setCallState("ready");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setCallState("error");
          setCallError("Private call signaling could not connect. Confirm the messaging migration and Realtime policies are installed.");
        }
      });

    return () => {
      active = false;
      void sendSignal("call-end", { callId: callIdRef.current }).catch(() => undefined);
      stopCallMedia();
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, grant, initialOffer, sendSignal, stopCallMedia, userId]);

  async function initiateCall() {
    try {
      setCallError("");
      const callId = crypto.randomUUID();
      callIdRef.current = callId;
      const peer = await startLocalCall(callId);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal("call-offer", { callId, to: peerId, mode, description: peer.localDescription });
      setCallState("calling");
    } catch (caught) {
      stopCallMedia();
      setCallState("error");
      setCallError(caught instanceof Error ? caught.message : "The call could not be started.");
    }
  }

  async function acceptCall() {
    try {
      setCallError("");
      const peer = await startLocalCall(incomingCallId);
      const channel = channelRef.current;
      if (!channel) throw new Error("Call signaling is not connected.");
      const savedOffer = incomingOffer.current;
      const offer = savedOffer?.callId === incomingCallId
        ? savedOffer.description
        : await new Promise<RTCSessionDescriptionInit>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingOfferResolver.current = null;
          reject(new Error("The call offer expired. Ask the caller to try again."));
        }, 15000);
        pendingOfferResolver.current = (description) => {
          window.clearTimeout(timer);
          pendingOfferResolver.current = null;
          resolve(description);
        };
      });
      await peer.setRemoteDescription(offer);
      for (const candidate of pendingCandidates.current.splice(0)) await peer.addIceCandidate(candidate);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendSignal("call-answer", { callId: incomingCallId, to: peerId, description: peer.localDescription });
      setCallState("calling");
    } catch (caught) {
      stopCallMedia();
      setCallState("error");
      setCallError(caught instanceof Error ? caught.message : "The call could not be accepted.");
    }
  }

  async function rejectCall() {
    try {
      await sendSignal("call-reject", { callId: incomingCallId, to: peerId });
    } catch (caught) {
      setCallError(caught instanceof Error ? caught.message : "The call could not be declined.");
    } finally {
      setCallState("ended");
    }
  }

  async function endCall() {
    try {
      if (callIdRef.current) await sendSignal("call-end", { callId: callIdRef.current, to: peerId });
    } catch (caught) {
      setCallError(caught instanceof Error ? caught.message : "Call hang-up could not be signaled.");
    } finally {
      stopCallMedia();
      setCallState("ended");
    }
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  function toggleCamera() {
    const next = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraOff(next);
  }

  return <div className="webrtc-backdrop">
    <section className="webrtc-call" role="dialog" aria-modal="true" aria-label={`${mode} call with ${displayName(person)}`}>
      <header><span>{mode === "video" ? "Video call" : "Audio call"} · {displayName(person)}</span><button type="button" aria-label="Close call" onClick={() => { void endCall(); onClose(); }}><X size={18} /></button></header>
      <div className="webrtc-call-media">
        {mode === "video" && <video ref={remoteVideoRef} autoPlay playsInline aria-label="Remote camera" />}
        <audio ref={remoteAudioRef} autoPlay />
        {callState === "incoming" && <p role="status">Incoming call from {displayName(person)}</p>}
        {callState === "calling" && <p role="status">Calling…</p>}
        {callState === "active" && <p role="status">Connected</p>}
        {(callState === "connecting" || callState === "ready") && <p role="status">{callState === "ready" ? "Ready to call" : "Connecting securely…"}</p>}
        {(callState === "ended" || callState === "error") && <p role={callState === "error" ? "alert" : "status"}>{callError || "Call ended"}</p>}
        {callError && callState !== "error" && <p role="alert">{callError}</p>}
        {mode === "video" && <video className="webrtc-local-video" autoPlay muted playsInline ref={(element) => { if (element && localStreamRef.current) element.srcObject = localStreamRef.current; }} />}
      </div>
      <div className="webrtc-call-controls">
        {(callState === "ready" || callState === "error" || callState === "ended") && <button type="button" onClick={() => void initiateCall()}><Phone size={16} />Call</button>}
        {callState === "incoming" && <><button type="button" onClick={() => void acceptCall()}><Phone size={16} />Accept</button><button type="button" onClick={() => void rejectCall()}>Decline</button></>}
        {(callState === "active" || callState === "calling") && <><button type="button" onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>{mode === "video" && <button type="button" onClick={toggleCamera}>{cameraOff ? "Camera on" : "Camera off"}</button>}<button type="button" className="webrtc-end" onClick={() => void endCall()}>Hang up</button></>}
      </div>
      <p className="webrtc-call-note">Peer-to-peer WebRTC · STUN configured · TURN relay is required for reliable calls across restrictive networks.</p>
    </section>
  </div>;
}
