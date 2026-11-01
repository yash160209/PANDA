"use client";

import {
  ArrowUpRight,
  Bell,
  Bookmark,
  Check,
  Clapperboard,
  Compass,
  Home,
  ImagePlus,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PanelsTopLeft,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { HiddenChatsView, PinManager, SecretCodeManager } from "@/app/hidden-chats";
import { ContentFeed } from "@/app/content-feed";
import { MessagingView } from "@/app/messaging";
import { Stories } from "@/app/stories";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { accountPrivacySchema, profileUpdateSchema } from "@/lib/validation/profile";
import { usernameSchema } from "@/lib/validation/auth";
import { validateAvatarMedia } from "@/lib/messaging/media";
import { viewFromLocation } from "@/lib/feed/pagination";

type View = "Home" | "Explore" | "Feed" | "Reels" | "Member Profile" | "Messages" | "Hidden Chats" | "Notifications" | "Profile" | "Settings";
type ThemePreference = "system" | "light" | "dark";
type AccountProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  is_private: boolean;
  avatar_url?: string;
};
type DirectoryProfile = AccountProfile;
const discoverableProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  display_name: z.string(),
  is_private: z.boolean(),
});
type FollowStatus = "none" | "following" | "requested";
type FollowRequest = {
  id: string;
  requester_id: string;
  target_id: string;
  created_at: string;
  profile: DirectoryProfile;
};
type FollowCounts = { followers: number; following: number };
type ConnectionType = "followers" | "following";
type ConnectionListRequest = { profileId: string; username: string; connection: ConnectionType };
type MemberPost = {
  id: string;
  caption: string;
  media_path: string;
  media_type: "image" | "video";
  created_at: string;
  media_url: string;
};
type MemberProfileData = {
  key: string;
  posts: MemberPost[];
  counts: FollowCounts | null;
  error: string;
};
type AccountState = "loading" | "signed-in" | "signed-out" | "error";

const navItems: { label: View; icon: typeof Home }[] = [
  { label: "Home", icon: Home },
  { label: "Explore", icon: Compass },
  { label: "Feed", icon: PanelsTopLeft },
  { label: "Reels", icon: Clapperboard },
  { label: "Messages", icon: MessageCircle },
  { label: "Notifications", icon: Bell },
  { label: "Profile", icon: UserRound },
  { label: "Settings", icon: Settings2 },
];

function subscribeToTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const syncTheme = () => {
    applyStoredTheme();
    onChange();
  };
  media.addEventListener("change", syncTheme);
  window.addEventListener("storage", syncTheme);
  window.addEventListener("panda-theme-change", syncTheme);
  return () => {
    media.removeEventListener("change", syncTheme);
    window.removeEventListener("storage", syncTheme);
    window.removeEventListener("panda-theme-change", syncTheme);
  };
}

function applyStoredTheme() {
  const saved = window.localStorage.getItem("panda-theme");
  if (saved === "dark" || saved === "light") {
    document.documentElement.dataset.theme = saved;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function getThemeSnapshot() {
  const saved = window.localStorage.getItem("panda-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "system-dark" : "system-light";
}

function getServerThemeSnapshot() {
  return "system-light";
}

function isMissingAuthSession(error: unknown): boolean {
  return error instanceof Error && error.name === "AuthSessionMissingError";
}

function Avatar({ src, name, size = "md", ring = false }: { src: string; name: string; size?: "sm" | "md" | "lg"; ring?: boolean }) {
  return (
    <span
      aria-label={name}
      className={`avatar avatar-${size}${ring ? " avatar-ring" : ""}`}
      role="img"
      style={src ? { backgroundImage: `url("${src}")` } : undefined}
    >
      {!src && name.slice(0, 1)}
    </span>
  );
}

function getProfileAvatarUrl(path: string | null | undefined) {
  if (!path) return "";
  try {
    const url = new URL(path);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function Brand() {
  return (
    <span className="brand-mark" aria-label="PANDA">
      <span className="panda-icon" aria-hidden="true"><i /><i /><b /></span>
      <span className="brand-word">panda<span>.</span></span>
    </span>
  );
}

function FollowControl({ profile, status, busy, userId, onFollow }: {
  profile: DirectoryProfile;
  status: FollowStatus;
  busy: boolean;
  userId: string | null;
  onFollow: () => void;
}) {
  if (!userId) {
    return <Link className="follow-button" href="/login">Sign in</Link>;
  }

  const actionLabel = status === "following"
    ? `Unfollow @${profile.username}`
    : status === "requested"
      ? `Cancel follow request to @${profile.username}`
      : `Follow @${profile.username}`;
  const label = busy
    ? status === "none" ? "Saving…" : "Updating…"
    : status === "following" ? "Following" : status === "requested" ? "Requested" : "Follow";

  return (
    <button
      type="button"
      className={`follow-button${status === "following" ? " following" : ""}${status === "requested" ? " requested" : ""}`}
      aria-label={actionLabel}
      aria-pressed={status !== "none"}
      title={status === "following" ? "Select to unfollow" : status === "requested" ? "Select to cancel request" : undefined}
      disabled={busy}
      onClick={onFollow}
    >
      {label}
    </button>
  );
}

export default function HomePage() {
  return <PandaApp initialView="Home" />;
}

export function PandaApp({ initialView }: { initialView: View }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView);
  const [startPinSetup, setStartPinSetup] = useState(false);
  const [search, setSearch] = useState("");
  const [directorySearch, setDirectorySearch] = useState("");
  const [notice, setNotice] = useState("");
  const themeSnapshot = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);
  const themePreference: ThemePreference = themeSnapshot.startsWith("system") ? "system" : themeSnapshot as ThemePreference;
  const darkMode = themeSnapshot === "dark" || themeSnapshot === "system-dark";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [directoryProfiles, setDirectoryProfiles] = useState<DirectoryProfile[]>([]);
  const [followStatuses, setFollowStatuses] = useState<Record<string, FollowStatus>>({});
  const [incomingFollowRequests, setIncomingFollowRequests] = useState<FollowRequest[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [followBusyIds, setFollowBusyIds] = useState<string[]>([]);
  const [followCounts, setFollowCounts] = useState<FollowCounts | null>(null);
  const [followCountsError, setFollowCountsError] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedConnections, setSelectedConnections] = useState<ConnectionListRequest | null>(null);
  const followBusyRef = useRef(new Set<string>());
  const [accountState, setAccountState] = useState<AccountState>(() => isSupabaseConfigured() ? "loading" : "signed-out");
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [themeTransition, setThemeTransition] = useState<{ theme: "light" | "dark"; id: number } | null>(null);
  const supabaseClientRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const themeTransitionId = useRef(0);
  const socialRequestRef = useRef(0);
  const followCountRequestRef = useRef(0);
  const routedProfileRef = useRef(false);

  useEffect(() => {
    let active = true;
    let profileRequest = 0;
    let authEventVersion = 0;
    if (!isSupabaseConfigured()) {
      return () => { active = false; };
    }

    try {
      const supabase = createSupabaseBrowserClient();
      supabaseClientRef.current = supabase;

      async function loadProfile(userId: string | null) {
        const requestId = ++profileRequest;
        socialRequestRef.current += 1;
        followCountRequestRef.current += 1;
        if (!userId) {
          if (!active) return;
          setAuthenticatedUserId(null);
          setAccountProfile(null);
          setDirectoryProfiles([]);
          setFollowStatuses({});
          setIncomingFollowRequests([]);
          setFollowCounts(null);
          setFollowCountsError("");
          setAccountError("");
          setAccountState("signed-out");
          return;
        }

        setAuthenticatedUserId(userId);
        setAccountState("loading");
        setAccountProfile(null);
        setDirectoryProfiles([]);
        setFollowStatuses({});
        setIncomingFollowRequests([]);
        setFollowCounts(null);
        setFollowCountsError("");
        setAccountError("");
        const { data, error } = await supabase
          .from("profiles")
          .select("id,username,display_name,bio,avatar_path,is_private")
          .eq("id", userId)
          .maybeSingle();

        if (!active || requestId !== profileRequest) return;
        if (error) {
          setAccountError("We couldn't load your profile. Please try again.");
          setAccountState("error");
          console.error("Authenticated profile lookup failed:", error.message);
          return;
        }
        if (!data) {
          setAccountError("You are signed in, but no matching profile was found for this account.");
          setAccountState("error");
          return;
        }

        const avatarResult = data.avatar_path
          ? await supabase.storage.from("profile-avatars").createSignedUrl(data.avatar_path, 3600)
          : null;
        if (!active || requestId !== profileRequest) return;
        if (avatarResult?.error) console.error("Profile avatar could not be loaded.");
        setAccountProfile({ ...data, avatar_url: avatarResult?.data?.signedUrl ?? "" });
        setAccountState("signed-in");
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        const eventVersion = ++authEventVersion;
        window.setTimeout(() => {
          if (!active || eventVersion !== authEventVersion) return;
          void loadProfile(session?.user.id ?? null);
        }, 0);
      });

      void supabase.auth.getUser().then(({ data: { user }, error }) => {
        if (!active || authEventVersion !== 0) return;
        if (error) {
          if (isMissingAuthSession(error)) {
            void loadProfile(null);
            return;
          }
          setAuthenticatedUserId(null);
          setAccountProfile(null);
          setAccountError("We couldn't verify your signed-in account. Please refresh and try again.");
          setAccountState("error");
          console.error("Authenticated user lookup failed:", error.message);
          return;
        }
        void loadProfile(user?.id ?? null);
      }).catch((error: unknown) => {
        if (!active || authEventVersion !== 0) return;
        if (isMissingAuthSession(error)) {
          void loadProfile(null);
          return;
        }
        setAuthenticatedUserId(null);
        setAccountProfile(null);
        setAccountError("We couldn't verify your signed-in account. Please refresh and try again.");
        setAccountState("error");
        console.error("Authenticated user lookup failed:", error instanceof Error ? error.message : "Unknown error");
      });

      return () => {
        active = false;
        profileRequest += 1;
        subscription.unsubscribe();
        supabaseClientRef.current = null;
      };
    } catch (error) {
      window.setTimeout(() => {
        if (!active) return;
        setAccountError("Supabase account services are unavailable.");
        setAccountState("error");
        console.error("Supabase account client setup failed:", error instanceof Error ? error.message : "Unknown error");
      }, 0);
      return () => { active = false; };
    }
  }, []);

  const activeDirectoryQuery = view === "Explore" ? directorySearch.trim() : "";

  const refreshSocialData = useCallback(async (query = "") => {
    const client = supabaseClientRef.current;
    if (!client || (accountState !== "signed-in" && accountState !== "signed-out")) return;

    const requestId = ++socialRequestRef.current;
    setDirectoryLoading(true);
    setDirectoryError("");
    try {
      const { data: directoryData, error: directoryErrorResult } = await client.rpc("discover_profiles", {
        p_query: query.trim() || null,
        p_limit: 100,
      });
      if (directoryErrorResult) throw directoryErrorResult;

      const directoryRows = z.array(discoverableProfileSchema).parse(directoryData ?? []);
      const profileIds = directoryRows.map((profile) => profile.id);
      const { data: readableProfiles, error: profilesError } = profileIds.length
        ? await client.from("profiles")
            .select("id,username,display_name,bio,avatar_path,is_private")
            .in("id", profileIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const readableProfileById = new Map((readableProfiles ?? []).map((profile) => [profile.id, profile]));
      const profiles: DirectoryProfile[] = directoryRows.map((directoryProfile) => {
        const readableProfile = readableProfileById.get(directoryProfile.id);
        return {
          ...directoryProfile,
          bio: readableProfile?.bio ?? "",
          avatar_path: readableProfile?.avatar_path ?? null,
        };
      });

      const [followsResult, outgoingRequestsResult, incomingRequestsResult] = authenticatedUserId
        ? await Promise.all([
            client.from("follows").select("following_id").eq("follower_id", authenticatedUserId),
            client.from("follow_requests").select("id,target_id").eq("requester_id", authenticatedUserId),
            client.from("follow_requests").select("id,requester_id,target_id,created_at").eq("target_id", authenticatedUserId).order("created_at", { ascending: true }),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];
      if (followsResult.error) throw followsResult.error;
      if (outgoingRequestsResult.error) throw outgoingRequestsResult.error;
      if (incomingRequestsResult.error) throw incomingRequestsResult.error;

      const incomingRows = incomingRequestsResult.data ?? [];
      const requesterIds = incomingRows.map((request) => request.requester_id);
      const { data: requestProfiles, error: requestProfilesError } = requesterIds.length
        ? await client.from("profiles")
            .select("id,username,display_name,bio,avatar_path,is_private")
            .in("id", requesterIds)
        : { data: [], error: null };
      if (requestProfilesError) throw requestProfilesError;

      const visibleProfiles = [...profiles, ...(requestProfiles ?? [])];
      const profileById = new Map(visibleProfiles.map((profile) => [profile.id, profile]));
      const signedProfiles = await Promise.all(profiles.map(async (profile) => {
        const signed = profile.avatar_path
          ? await client.storage.from("profile-avatars").createSignedUrl(profile.avatar_path, 3600)
          : null;
        if (signed?.error) console.error("Directory profile photo could not be loaded.");
        return { ...profile, avatar_url: signed?.data?.signedUrl ?? "" };
      }));
      if (requestId !== socialRequestRef.current) return;

      const statuses: Record<string, FollowStatus> = {};
      for (const row of followsResult.data ?? []) statuses[row.following_id] = "following";
      for (const row of outgoingRequestsResult.data ?? []) {
        if (statuses[row.target_id] !== "following") statuses[row.target_id] = "requested";
      }

      const requests: FollowRequest[] = [];
      for (const row of incomingRows) {
        const requester = profileById.get(row.requester_id);
        if (!requester) continue;
        const signed = requester.avatar_path
          ? await client.storage.from("profile-avatars").createSignedUrl(requester.avatar_path, 3600)
          : null;
        if (signed?.error) console.error("Follow-request profile photo could not be loaded.");
        requests.push({ ...row, profile: { ...requester, avatar_url: signed?.data?.signedUrl ?? "" } });
      }

      if (requestId !== socialRequestRef.current) return;
      setDirectoryProfiles(signedProfiles);
      setFollowStatuses(statuses);
      setIncomingFollowRequests(requests);
    } catch (error) {
      if (requestId !== socialRequestRef.current) return;
      console.error("Social account data could not be loaded:", error instanceof Error ? error.message : "Unknown error");
      setDirectoryError("People and follow requests could not be loaded. Please try again.");
    } finally {
      if (requestId === socialRequestRef.current) setDirectoryLoading(false);
    }
  }, [accountState, authenticatedUserId]);

  useEffect(() => {
    if (accountState === "signed-in" || accountState === "signed-out") {
      void refreshSocialData(activeDirectoryQuery);
    }
  }, [accountState, activeDirectoryQuery, refreshSocialData]);

  async function reloadFollowCounts(profileId: string) {
    const client = supabaseClientRef.current;
    if (!client) return;
    const requestId = ++followCountRequestRef.current;
    const { data, error } = await client.rpc("get_profile_follow_counts", { p_profile_id: profileId });
    if (requestId !== followCountRequestRef.current) return;
    if (error) {
      setFollowCountsError("Follower counts could not be loaded. Please try again.");
      console.error("Profile follow counts failed:", error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      setFollowCounts(null);
      setFollowCountsError("Follow counts are not visible for this account.");
      return;
    }
    setFollowCounts({ followers: Number(row.followers), following: Number(row.following) });
    setFollowCountsError("");
  }

  useEffect(() => {
    if (accountState === "signed-in" && accountProfile) {
      void reloadFollowCounts(accountProfile.id);
    } else {
      setFollowCounts(null);
      setFollowCountsError("");
    }
  }, [accountProfile, accountState]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (view !== "Explore") return;
    const timer = window.setTimeout(() => setDirectorySearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search, view]);

  useEffect(() => {
    if (!themeTransition) return;
    const timer = window.setTimeout(() => setThemeTransition(null), 900);
    return () => window.clearTimeout(timer);
  }, [themeTransition]);

  function toggleTheme() {
    const currentTheme = getThemeSnapshot();
    const nextTheme = currentTheme === "dark" || currentTheme === "system-dark" ? "light" : "dark";
    setThemePreference(nextTheme);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setThemeTransition(null);
      return;
    }

    themeTransitionId.current += 1;
    setThemeTransition({ theme: nextTheme, id: themeTransitionId.current });
  }

  function setThemePreference(preference: ThemePreference) {
    if (preference === "system") {
      window.localStorage.removeItem("panda-theme");
    } else {
      window.localStorage.setItem("panda-theme", preference);
    }
    applyStoredTheme();
    window.dispatchEvent(new Event("panda-theme-change"));
  }

  const changeView = useCallback((next: View, memberProfileId?: string) => {
    setView(next);
    setMobileMenuOpen(false);
    if (next === "Feed") {
      router.push("/feed");
      return;
    }
    if (next === "Reels") {
      router.push("/reels");
      return;
    }
    if (window.location.pathname === "/feed" || window.location.pathname === "/reels") {
      if (next === "Home") {
        router.push("/");
      } else {
        const query = new URLSearchParams({ view: next });
        if (memberProfileId) query.set("profile", memberProfileId);
        router.push(`/?${query.toString()}`);
      }
      return;
    }
    const currentQuery = new URLSearchParams(window.location.search);
    if (currentQuery.has("view") || currentQuery.has("profile")) {
      if (next === "Home") {
        router.replace("/");
      } else {
        const query = new URLSearchParams({ view: next });
        if (next === "Member Profile") {
          const profileId = memberProfileId ?? currentQuery.get("profile");
          if (profileId) query.set("profile", profileId);
        }
        if (query.toString() !== currentQuery.toString()) router.replace(`/?${query.toString()}`);
      }
    }
  }, [router]);

  const openMemberProfile = useCallback(async (profileId: string) => {
    let profile = directoryProfiles.find((item) => item.id === profileId);
    if (!profile) {
      const client = supabaseClientRef.current;
      if (!client) {
        setNotice("Profile details are unavailable until Supabase is configured.");
        return;
      }
      try {
        const { data, error } = await client.from("profiles")
          .select("id,username,display_name,bio,avatar_path,is_private")
          .eq("id", profileId)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          setNotice("This profile is not available to your account.");
          return;
        }
        const signed = data.avatar_path
          ? await client.storage.from("profile-avatars").createSignedUrl(data.avatar_path, 3600)
          : null;
        if (signed?.error) throw signed.error;
        const loadedProfile: DirectoryProfile = { ...data, avatar_url: signed?.data?.signedUrl ?? "" };
        profile = loadedProfile;
        setDirectoryProfiles((current) => [...current.filter((item) => item.id !== profileId), loadedProfile]);
      } catch (caught) {
        console.error("Profile could not be opened:", caught instanceof Error ? caught.message : "Unknown error");
        setNotice("This profile could not be opened. Please try again.");
        return;
      }
    }
    setSelectedMemberId(profileId);
    changeView("Member Profile", profileId);
  }, [changeView, directoryProfiles]);

  const openConnectionProfile = useCallback((profile: DirectoryProfile) => {
    setDirectoryProfiles((current) => [...current.filter((item) => item.id !== profile.id), profile]);
    setSelectedMemberId(profile.id);
    setSelectedConnections(null);
    changeView("Member Profile", profile.id);
  }, [changeView]);

  useEffect(() => {
    const restoredView = viewFromLocation(window.location.pathname, window.location.search);
    if (restoredView) setView(restoredView);
    const profileId = new URLSearchParams(window.location.search).get("profile");
    if (profileId && !routedProfileRef.current) {
      routedProfileRef.current = true;
      void openMemberProfile(profileId);
    }
  }, [openMemberProfile]);

  async function signOut() {
    setLogoutError("");
    const supabase = supabaseClientRef.current;
    if (!supabase) {
      setLogoutError("Sign out is unavailable because Supabase is not configured.");
      return;
    }

    setLogoutBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setLogoutError("We couldn't sign you out. Please try again.");
        console.error("Supabase sign-out failed:", error.message);
        return;
      }

      setAccountProfile(null);
      setAuthenticatedUserId(null);
      setAccountState("signed-out");
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setLogoutError("We couldn't sign you out. Please try again.");
      console.error("Supabase sign-out failed:", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLogoutBusy(false);
    }
  }

  async function saveProfile(username: string, displayName: string, bio: string) {
    const userId = authenticatedUserId;
    const client = supabaseClientRef.current;
    if (!userId || accountProfile?.id !== userId || !client) {
      throw new Error("Your signed-in profile is not available. Please refresh and try again.");
    }

    const { data, error } = await client
      .from("profiles")
      .update({ username, display_name: displayName, bio })
      .eq("id", userId)
      .select("id,username,display_name,bio,avatar_path,is_private")
      .single();

    if (error) {
      console.error("Authenticated profile update failed:", error.message);
      if (error.code === "23505") {
        throw new Error("That username is already taken. Choose another username.");
      }
      throw new Error("We couldn't save your profile. Please try again.");
    }

    const avatarResult = data.avatar_path
      ? await client.storage.from("profile-avatars").createSignedUrl(data.avatar_path, 3600)
      : null;
    if (avatarResult?.error) console.error("Profile avatar could not be refreshed.");
    const savedProfile = { ...data, avatar_url: avatarResult?.data?.signedUrl ?? "" };
    setAccountProfile(savedProfile);
    return savedProfile;
  }

  async function saveAvatar(file: File) {
    const userId = authenticatedUserId;
    const client = supabaseClientRef.current;
    if (!userId || accountProfile?.id !== userId || !client) {
      throw new Error("Your signed-in profile is not available. Please refresh and try again.");
    }

    const extensionByType: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
    };
    const newPath = `${userId}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
    const { error: uploadError } = await client.storage.from("profile-avatars").upload(newPath, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw new Error("The profile photo could not be uploaded.");

    const { data, error } = await client.from("profiles")
      .update({ avatar_path: newPath })
      .eq("id", userId)
      .select("id,username,display_name,bio,avatar_path,is_private")
      .single();
    if (error) {
      await client.storage.from("profile-avatars").remove([newPath]);
      console.error("Authenticated profile photo update failed:", error.message);
      throw new Error("The profile photo could not be saved.");
    }

    const { data: signedUrl, error: signedUrlError } = await client.storage
      .from("profile-avatars")
      .createSignedUrl(newPath, 3600);
    if (signedUrlError) console.error("Profile photo was saved but its preview could not be loaded.");
    const nextProfile = { ...data, avatar_url: signedUrl?.signedUrl ?? "" };
    setAccountProfile(nextProfile);

    if (accountProfile.avatar_path) {
      const { error: cleanupError } = await client.storage.from("profile-avatars").remove([accountProfile.avatar_path]);
      if (cleanupError) console.error("An old profile photo could not be removed.");
    }
    return nextProfile;
  }

  async function saveAccountPrivacy(isPrivate: boolean) {
    const userId = authenticatedUserId;
    const client = supabaseClientRef.current;
    if (!userId || accountProfile?.id !== userId || !client) {
      throw new Error("Your signed-in profile is not available. Please refresh and try again.");
    }

    const response = await fetch("/api/profile/privacy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPrivate }),
    });
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new Error("Account privacy returned an invalid response. Please try again.");
    }

    if (!response.ok) {
      const errorMessage = responseBody && typeof responseBody === "object" && "error" in responseBody
        && typeof responseBody.error === "string"
        ? responseBody.error
        : "We couldn't save your account privacy setting. Please try again.";
      throw new Error(errorMessage);
    }

    const savedPrivacy = accountPrivacySchema.safeParse(responseBody);
    if (!savedPrivacy.success) {
      throw new Error("Account privacy returned an invalid response. Please try again.");
    }

    const savedProfile = { ...accountProfile, is_private: savedPrivacy.data.isPrivate };
    setAccountProfile(savedProfile);
    await refreshSocialData(activeDirectoryQuery);
    return savedProfile.is_private;
  }

  async function updateFollow(profileId: string) {
    const client = supabaseClientRef.current;
    if (!authenticatedUserId || !client) {
      setNotice("Sign in to follow accounts.");
      return;
    }
    if (followBusyRef.current.has(profileId)) return;

    const removing = followStatuses[profileId] === "following" || followStatuses[profileId] === "requested";
    followBusyRef.current.add(profileId);
    setFollowBusyIds((current) => [...current, profileId]);
    try {
      const { data, error } = removing
        ? await client.rpc("unfollow_profile", { p_target_id: profileId })
        : await client.rpc("follow_profile", { p_target_id: profileId });
      if (error) throw error;

      if (data !== "none" && data !== "following" && data !== "requested") {
        throw new Error("The follow service returned an unexpected status.");
      }
      const status: FollowStatus = data;
      setFollowStatuses((current) => ({ ...current, [profileId]: status }));
      setNotice(status === "requested" ? "Follow request sent." : status === "following" ? "You’re now following this account." : "Follow removed.");
      await Promise.all([
        refreshSocialData(activeDirectoryQuery),
        accountProfile ? reloadFollowCounts(accountProfile.id) : Promise.resolve(),
      ]);
    } catch (error) {
      console.error("Follow change failed:", error instanceof Error ? error.message : "Unknown error");
      setNotice("We couldn't update this follow. Please try again.");
    } finally {
      followBusyRef.current.delete(profileId);
      setFollowBusyIds((current) => current.filter((id) => id !== profileId));
    }
  }

  async function respondToFollowRequest(requestId: string, requesterId: string, accept: boolean) {
    const client = supabaseClientRef.current;
    if (!authenticatedUserId || !client) return;
    if (followBusyRef.current.has(requestId)) return;

    followBusyRef.current.add(requestId);
    setFollowBusyIds((current) => [...current, requestId]);
    try {
      const { error } = await client.rpc("respond_to_follow_request", {
        p_request_id: requestId,
        p_accept: accept,
      });
      if (error) throw error;
      setFollowStatuses((current) => ({
        ...current,
        [requesterId]: accept ? "following" : "none",
      }));
      setNotice(accept ? "Follow request accepted." : "Follow request declined.");
      await Promise.all([
        refreshSocialData(activeDirectoryQuery),
        accountProfile ? reloadFollowCounts(accountProfile.id) : Promise.resolve(),
      ]);
    } catch (error) {
      console.error("Follow request response failed:", error instanceof Error ? error.message : "Unknown error");
      setNotice("We couldn't update this follow request. Please try again.");
    } finally {
      followBusyRef.current.delete(requestId);
      setFollowBusyIds((current) => current.filter((id) => id !== requestId));
    }
  }

  const checkUsernameAvailability = useCallback(async (username: string) => {
    const client = supabaseClientRef.current;
    if (!client) {
      throw new Error("Username availability is unavailable. Please try again.");
    }

    const { data, error } = await client.rpc("is_username_available", { p_username: username });
    if (error) {
      console.error("Username availability check failed:", error.message);
      throw new Error("Username availability could not be checked.");
    }
    return data;
  }, []);

  const accountDisplayName = accountProfile?.display_name || accountProfile?.username || "Your account";
  const accountAvatar = accountProfile?.avatar_url || getProfileAvatarUrl(accountProfile?.avatar_path);

  return (
    <main className="app-shell">
      <aside className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button className="icon-button close-menu" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}><X size={20} /></button>
        </div>
        <button className="search-trigger" aria-label="Search posts and people" onClick={() => changeView("Explore")}>
          <Search size={17} /><span>Search anything</span><kbd>⌘ K</kbd>
        </button>
        <div className="nav-label">MENU</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-link${view === label ? " active" : ""}`} aria-label={label} aria-current={view === label ? "page" : undefined} onClick={() => changeView(label)}>
              <Icon size={19} strokeWidth={view === label ? 2.2 : 1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="new-post-button" aria-label="Post publishing is not available yet" title="Post publishing is not available yet" disabled><Plus size={19} /><span>Create a post</span></button>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="note-icon"><ShieldCheck size={17} /></span>
          <div><strong>Your space, your pace.</strong><p>Thoughtful connections start here.</p></div>
        </div>
        <button className="account-switcher" onClick={() => changeView("Profile")} aria-label="View account profile">
          <Avatar src={accountAvatar} name={accountDisplayName} />
          <span className="account-details"><strong>{accountDisplayName}</strong><small>{accountProfile?.username ? `@${accountProfile.username}` : accountState === "loading" ? "Loading account…" : "Account profile"}</small></span>
          <MoreHorizontal size={19} />
        </button>
        <div className="sidebar-legal">A little more human.<br />© 2026 PANDA</div>
      </aside>

      {mobileMenuOpen && <button className="menu-scrim" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />}

      <section className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileMenuOpen(true)}><Menu size={21} /></button>
          <div className="mobile-brand"><Brand /></div>
          <div className="breadcrumb"><span>Social</span><span className="crumb-divider">/</span><strong>{view}</strong></div>
          <div className="topbar-actions">
            <button className="icon-button theme-button" aria-label={`Switch to ${darkMode ? "light" : "dark"} theme`} onClick={toggleTheme}>{darkMode ? <Sun size={19} /> : <Sparkles size={19} />}</button>
            <button className="icon-button top-notification" aria-label="View notifications" onClick={() => changeView("Notifications")}><Bell size={19} /></button>
            {accountState === "signed-out"
              ? <Link className="sign-in-link" href="/login"><LogIn size={16} />Sign in</Link>
              : <button type="button" className="account-avatar-button" aria-label="View account profile" onClick={() => changeView("Profile")}><Avatar src={accountAvatar} name={accountDisplayName} size="sm" /></button>}
          </div>
        </header>
        {view === "Home" && <HomeView userId={authenticatedUserId} />}
        {view === "Feed" && <ContentFeed key={`feed-${authenticatedUserId ?? "anonymous"}`} mode="mixed" userId={authenticatedUserId} onOpenProfile={(id) => void openMemberProfile(id)} />}
        {view === "Reels" && <ContentFeed key={`reels-${authenticatedUserId ?? "anonymous"}`} mode="reels" userId={authenticatedUserId} onOpenProfile={(id) => void openMemberProfile(id)} />}
        {view === "Explore" && <ExploreView directoryProfiles={directoryProfiles} followStatuses={followStatuses} followBusyIds={followBusyIds} directoryLoading={directoryLoading} directoryError={directoryError} userId={authenticatedUserId} search={search} setSearch={setSearch} onFollow={(id) => void updateFollow(id)} onOpenProfile={(id) => void openMemberProfile(id)} />}
        {view === "Member Profile" && <MemberProfileView profile={directoryProfiles.find((item) => item.id === selectedMemberId) ?? null} loading={directoryLoading} userId={authenticatedUserId} followStatus={selectedMemberId ? followStatuses[selectedMemberId] ?? "none" : "none"} followBusy={Boolean(selectedMemberId && followBusyIds.includes(selectedMemberId))} onBack={() => changeView("Explore")} onFollow={() => { if (selectedMemberId) void updateFollow(selectedMemberId); }} onOpenConnections={(connection, profile) => setSelectedConnections({ profileId: profile.id, username: profile.username, connection })} />}
        {view === "Messages" && <MessagesView key={authenticatedUserId ?? "signed-out"} userId={authenticatedUserId} onRequirePinSetup={() => { setStartPinSetup(true); changeView("Settings"); }} />}
        {view === "Hidden Chats" && <HiddenChatsView key={authenticatedUserId ?? "signed-out"} userId={authenticatedUserId} />}
        {view === "Notifications" && <NotificationsView key={authenticatedUserId ?? "anonymous"} userId={authenticatedUserId} />}
        {view === "Profile" && <ProfileView key={`${accountState}-${accountProfile?.id ?? authenticatedUserId ?? "none"}`} profile={accountProfile} accountState={accountState} isAuthenticated={Boolean(authenticatedUserId)} accountError={accountError} logoutError={logoutError} logoutBusy={logoutBusy} followCounts={followCounts} followCountsError={followCountsError} onLogout={() => void signOut()} onSaveProfile={saveProfile} onSaveAvatar={saveAvatar} onCheckUsernameAvailability={checkUsernameAvailability} onOpenConnections={(connection) => { if (accountProfile) setSelectedConnections({ profileId: accountProfile.id, username: accountProfile.username, connection }); }} />}
        {view === "Settings" && <SettingsView key={`${authenticatedUserId ?? "signed-out"}-${accountState === "signed-in" && accountProfile?.id === authenticatedUserId ? "ready" : "loading"}`} themePreference={themePreference} onThemeChange={setThemePreference} onViewProfile={() => changeView("Profile")} onViewNotifications={() => changeView("Notifications")} userId={authenticatedUserId} privacyReady={accountState === "signed-in" && accountProfile?.id === authenticatedUserId} isPrivate={accountProfile?.is_private ?? false} onSavePrivacy={saveAccountPrivacy} incomingRequests={incomingFollowRequests} followBusyIds={followBusyIds} onRespondToRequest={respondToFollowRequest} startPinSetup={startPinSetup} onPinSetupHandled={() => setStartPinSetup(false)} />}
      </section>

      {selectedConnections && <ConnectionsDialog key={`${selectedConnections.profileId}-${selectedConnections.connection}`} request={selectedConnections} userId={authenticatedUserId} onClose={() => setSelectedConnections(null)} onOpenProfile={openConnectionProfile} />}
      {themeTransition && <div className="theme-transition-overlay" data-target-theme={themeTransition.theme} key={themeTransition.id} aria-hidden="true">
        <svg className="theme-transition-mascot" viewBox="0 0 160 160" focusable="false">
          <circle className="theme-panda-ear" cx="39" cy="40" r="25" />
          <circle className="theme-panda-ear" cx="121" cy="40" r="25" />
          <ellipse className="theme-panda-face" cx="80" cy="82" rx="61" ry="57" />
          <ellipse className="theme-panda-patch" cx="57" cy="75" rx="18" ry="23" transform="rotate(28 57 75)" />
          <ellipse className="theme-panda-patch" cx="103" cy="75" rx="18" ry="23" transform="rotate(-28 103 75)" />
          <circle className="theme-panda-eye" cx="59" cy="76" r="5" />
          <circle className="theme-panda-eye" cx="101" cy="76" r="5" />
          <ellipse className="theme-panda-muzzle" cx="80" cy="101" rx="25" ry="17" />
          <path className="theme-panda-nose" d="M74 96 Q80 91 86 96 Q85 102 80 103 Q75 102 74 96Z" />
          <path className="theme-panda-mouth" d="M80 103v5m0 0q-5 5-9 0m9 0q5 5 9 0" />
        </svg>
      </div>}
      {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    </main>
  );
}

function HomeView({ userId }: { userId: string | null }) {
  return <div className="home-stories-only">
    <div className="home-stories-heading">
      <span className="eyebrow">YOUR SPACE</span>
      <h1>Stories</h1>
      <p>Quick moments from the people you follow.</p>
    </div>
    <Stories userId={userId} />
  </div>;
}

function ExploreView({ directoryProfiles, followStatuses, followBusyIds, directoryLoading, directoryError, userId, search, setSearch, onFollow, onOpenProfile }: {
  directoryProfiles: DirectoryProfile[];
  followStatuses: Record<string, FollowStatus>;
  followBusyIds: string[];
  directoryLoading: boolean;
  directoryError: string;
  userId: string | null;
  search: string;
  setSearch: (value: string) => void;
  onFollow: (id: string) => void;
  onOpenProfile: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"All accounts" | "Following">("All accounts");
  const normalizedSearch = search.trim().toLowerCase();
  const matchingPeople = directoryProfiles.filter((person) => {
    const matchesSearch = `${person.display_name} ${person.username}`.toLowerCase().includes(normalizedSearch);
    return matchesSearch && (filter !== "Following" || followStatuses[person.id] === "following");
  });

  return <div className="secondary-view">
    <div className="secondary-heading"><div className="eyebrow"><UsersRound size={14} /> ACCOUNT DISCOVERY</div><h1>Find your <span>people.</span></h1><p>Search real PANDA accounts and manage your follows.</p></div>
    <label className="explore-search"><Search size={18} /><input value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts by name or username" aria-label="Search accounts" /><kbd>? K</kbd></label>
    <div className="explore-chips">{(["All accounts", "Following"] as const).map((item) => <button key={item} className={`chip${filter === item ? " active" : ""}`} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <section className="explore-people"><div className="explore-section-heading"><strong>Accounts</strong><span>Profiles from PANDA</span></div>
      {directoryError ? <div className="explore-people-empty" role="alert">{directoryError}</div>
        : directoryLoading ? <div className="explore-people-empty" role="status">Loading accounts?</div>
          : matchingPeople.length ? <div className="explore-people-list">{matchingPeople.map((person) => <div className="suggestion" key={person.id}>
            <button type="button" className="suggestion-profile" onClick={() => onOpenProfile(person.id)}>
              <Avatar src={person.avatar_url || getProfileAvatarUrl(person.avatar_path)} name={person.display_name || person.username} />
              <span className="suggestion-copy"><strong>{person.display_name || person.username}</strong><span>@{person.username}{person.is_private ? " ? Private" : ""}</span></span>
            </button>
            <FollowControl profile={person} status={followStatuses[person.id] ?? "none"} busy={followBusyIds.includes(person.id)} userId={userId} onFollow={() => onFollow(person.id)} />
          </div>)}</div>
          : <div className="explore-people-empty">{filter === "Following" ? "You aren?t following any accounts yet." : normalizedSearch ? "No accounts match this search." : "No accounts to discover yet."}</div>}
    </section>
    <p className="explore-preview-note">Post discovery is not available yet. Browse published posts in Feed.</p>
  </div>;
}

function ConnectionsDialog({ request, userId, onClose, onOpenProfile }: {
  request: ConnectionListRequest;
  userId: string | null;
  onClose: () => void;
  onOpenProfile: (profile: DirectoryProfile) => void;
}) {
  const [profiles, setProfiles] = useState<DirectoryProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  const loadConnections = useCallback(async (reset = false) => {
    if (loadingRef.current || (!reset && !hasMoreRef.current)) return;
    loadingRef.current = true;
    const offset = reset ? 0 : offsetRef.current;
    if (reset) {
      setLoading(true);
      setError("");
      setProfiles([]);
      setHasMore(true);
      hasMoreRef.current = true;
    } else {
      setLoadingMore(true);
    }

    try {
      if (!userId) throw new Error("Sign in to view this connection list.");
      const client = createSupabaseBrowserClient();
      const { data, error: resultError } = await client.rpc("get_profile_connections", {
        p_profile_id: request.profileId,
        p_connection: request.connection,
        p_limit: 50,
        p_offset: offset,
      });
      if (resultError) throw resultError;

      const rows = (data ?? []) as Omit<DirectoryProfile, "avatar_url">[];
      const signedProfiles = await Promise.all(rows.map(async (profile): Promise<DirectoryProfile> => {
        const signed = profile.avatar_path
          ? await client.storage.from("profile-avatars").createSignedUrl(profile.avatar_path, 3600)
          : null;
        if (signed?.error) throw signed.error;
        return { ...profile, avatar_url: signed?.data?.signedUrl ?? "" };
      }));
      setProfiles((current) => reset ? signedProfiles : [...current, ...signedProfiles.filter((profile) => !current.some((item) => item.id === profile.id))]);
      offsetRef.current = offset + rows.length;
      hasMoreRef.current = rows.length === 50;
      setHasMore(hasMoreRef.current);
    } catch (caught) {
      console.error("Profile connections could not be loaded:", caught instanceof Error ? caught.message : "Unknown error");
      setError(caught instanceof Error ? caught.message : "This connection list could not be loaded.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [request, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConnections(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadConnections]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="connections-dialog" role="dialog" aria-modal="true" aria-labelledby="connections-title">
      <header className="modal-header">
        <div><h2 id="connections-title">{request.connection === "followers" ? "Followers" : "Following"}</h2><p>@{request.username}</p></div>
        <button type="button" className="icon-button" aria-label="Close connections" onClick={onClose}><X size={20} /></button>
      </header>
      {error && <p className="profile-account-error" role="alert">{error}</p>}
      {profiles.length
        ? <div className="connections-list">{profiles.map((profile) => <button type="button" className="connections-row" key={profile.id} onClick={() => onOpenProfile(profile)}>
          <Avatar src={profile.avatar_url || getProfileAvatarUrl(profile.avatar_path)} name={profile.display_name || profile.username} size="sm" />
          <span><strong>{profile.display_name || profile.username}</strong><small>@{profile.username}{profile.is_private ? " · Private" : ""}</small></span>
          <ArrowUpRight size={16} />
        </button>)}</div>
        : loading ? <p className="connections-empty" role="status">Loading connections…</p>
          : !error && <p className="connections-empty">No {request.connection} yet.</p>}
      {loadingMore && <p className="connections-empty" role="status">Loading more…</p>}
      {!loading && hasMore && <button type="button" className="outline-button connections-load-more" onClick={() => void loadConnections()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</button>}
    </section>
  </div>;
}

function MemberProfileView({ profile, loading, userId, followStatus, followBusy, onBack, onFollow, onOpenConnections }: {
  profile: DirectoryProfile | null;
  loading: boolean;
  userId: string | null;
  followStatus: FollowStatus;
  followBusy: boolean;
  onBack: () => void;
  onFollow: () => void;
  onOpenConnections: (connection: ConnectionType, profile: DirectoryProfile) => void;
}) {
  const [profileData, setProfileData] = useState<MemberProfileData | null>(null);
  const profileKey = profile ? `${profile.id}:${followStatus}` : "";

  useEffect(() => {
    if (!profile) return;
    let active = true;

    void (async () => {
      try {
        const client = createSupabaseBrowserClient();
        const { data: postRows, error: postsError } = await client
          .from("posts")
          .select("id,caption,media_path,media_type,created_at")
          .eq("author_id", profile.id)
          .order("created_at", { ascending: false });
        if (postsError) throw postsError;

        const visiblePosts = await Promise.all((postRows ?? []).map(async (post): Promise<MemberPost> => {
          const { data, error } = await client.storage.from("post-media").createSignedUrl(post.media_path, 300);
          if (error) throw error;
          return {
            id: post.id,
            caption: post.caption,
            media_path: post.media_path,
            media_type: post.media_type === "video" ? "video" : "image",
            created_at: post.created_at,
            media_url: data.signedUrl,
          };
        }));
        const { data: countRows, error: countError } = await client.rpc("get_profile_follow_counts", { p_profile_id: profile.id });
        if (countError) throw countError;
        if (!active) return;

        const countRow = Array.isArray(countRows) ? countRows[0] : null;
        setProfileData({
          key: profileKey,
          posts: visiblePosts,
          counts: countRow ? { followers: Number(countRow.followers), following: Number(countRow.following) } : null,
          error: "",
        });
      } catch (error) {
        if (!active) return;
        console.error("Member profile could not be loaded:", error instanceof Error ? error.message : "Unknown error");
        setProfileData({ key: profileKey, posts: [], counts: null, error: "This profile could not be loaded. Please try again." });
      }
    })();

    return () => { active = false; };
  }, [followStatus, profile, profileKey]);

  if (!profile) {
    return <div className="secondary-view">
      <button className="text-button" type="button" onClick={onBack}>Back to Explore</button>
      <div className="empty-card"><strong>{loading ? "Loading profile…" : "Profile unavailable"}</strong></div>
    </div>;
  }

  const ownProfile = profile.id === userId;
  const privateLocked = profile.is_private && !ownProfile && followStatus !== "following";
  const currentProfileData = profileData?.key === profileKey ? profileData : null;
  const posts = currentProfileData?.posts ?? [];
  const counts = currentProfileData?.counts ?? null;
  const postsLoading = !currentProfileData;
  const profileError = currentProfileData?.error ?? "";

  return <div className="secondary-view profile-view">
    <button className="text-button member-profile-back" type="button" onClick={onBack}>← Back to Explore</button>
    <div className="eyebrow"><UserRound size={14} /> PANDA MEMBER</div>
    <section className="profile-cover"><div className="cover-sparkle">✳</div></section>
    <div className="profile-page-head">
      <Avatar src={profile.avatar_url || getProfileAvatarUrl(profile.avatar_path)} name={profile.display_name || profile.username} size="lg" />
      {!ownProfile && <FollowControl profile={profile} status={followStatus} busy={followBusy} userId={userId} onFollow={onFollow} />}
    </div>
    <div className="profile-page-bio">
      <h1>{profile.display_name || profile.username} <span>@{profile.username}</span></h1>
      <p>{privateLocked ? "Follow this account to request access to its bio." : profile.bio || "No bio has been added yet."}</p>
      <p className="member-privacy-label"><LockKeyhole size={13} /> {profile.is_private ? "Private account" : "Public account"}</p>
      {profileError && <p className="profile-account-error" role="alert">{profileError}</p>}
      <div className="profile-stats" aria-label="Profile statistics">
        <button type="button" disabled={privateLocked || !counts} onClick={() => onOpenConnections("followers", profile)}><strong>{privateLocked ? "—" : counts?.followers ?? "—"}</strong><span>followers</span></button>
        <button type="button" disabled={privateLocked || !counts} onClick={() => onOpenConnections("following", profile)}><strong>{privateLocked ? "—" : counts?.following ?? "—"}</strong><span>following</span></button>
      </div>
    </div>
    {privateLocked
      ? <div className="private-profile-empty"><LockKeyhole size={22} /><strong>This account is private</strong><span>Follow this account to request access to its posts.</span></div>
      : postsLoading
        ? <p className="profile-account-status" role="status">Loading posts…</p>
        : posts.length
          ? <div className="profile-post-grid">{posts.map((post) => <article key={post.id} className="member-post">
            {post.media_type === "video"
              ? <video src={post.media_url} controls playsInline preload="metadata" />
              : <div className="member-post-image" role="img" aria-label={post.caption || `Post by ${profile.username}`} style={{ backgroundImage: `url("${post.media_url}")` }} />}
            {post.caption && <p>{post.caption}</p>}
          </article>)}</div>
          : <div className="profile-empty"><ImagePlus size={21} /><strong>No posts yet</strong></div>}
  </div>;
}

function MessagesView({ userId, onRequirePinSetup }: {
  userId: string | null;
  onRequirePinSetup: () => void;
}) {
  return <div className="secondary-view messaging-page">
    <div className="secondary-heading"><div className="eyebrow"><MessageCircle size={14} /> YOUR INBOX</div><h1>Good conversations, <span>right here.</span></h1><p>Your private space to catch up with your people.</p></div>
    <MessagingView userId={userId} onRequirePinSetup={onRequirePinSetup} />
  </div>;
}

export type StoredNotification = {
  id: string;
  actor_id: string | null;
  kind: "like" | "comment" | "follow" | "follow_request" | "message";
  read_at: string | null;
  created_at: string;
  actor: { username: string; display_name: string } | null;
};

function NotificationsView({ userId }: { userId: string | null }) {
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [markingRead, setMarkingRead] = useState(false);
  const markingReadRef = useRef(false);

  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    void (async () => {
      try {
        if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
        const client = createSupabaseBrowserClient();
        const { data, error: resultError } = await client
          .from("notifications")
          .select("id,actor_id,kind,read_at,created_at")
          .eq("recipient_id", userId)
          .order("created_at", { ascending: false })
          .limit(100);
        if (resultError) throw resultError;

        const rows = data ?? [];
        const actorIds = [...new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : []))];
        const { data: actors, error: actorError } = actorIds.length
          ? await client.from("profiles").select("id,username,display_name").in("id", actorIds)
          : { data: [], error: null };
        if (actorError) throw actorError;
        const actorMap = new Map((actors ?? []).map((actor) => [actor.id, actor]));
        if (!active) return;

        setNotifications(rows.map((row) => ({
          ...row,
          actor: row.actor_id ? actorMap.get(row.actor_id) ?? null : null,
        })));
      } catch (caught) {
        if (!active) return;
        console.error("Notifications could not be loaded:", caught instanceof Error ? caught.message : "Unknown error");
        setError("Notifications could not be loaded. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [userId]);

  async function markAllRead() {
    if (!userId || markingReadRef.current || !notifications.some((item) => !item.read_at)) return;
    markingReadRef.current = true;
    setMarkingRead(true);
    setError("");
    try {
      const client = createSupabaseBrowserClient();
      const readAt = new Date().toISOString();
      const { error: updateError } = await client.from("notifications")
        .update({ read_at: readAt })
        .eq("recipient_id", userId)
        .is("read_at", null);
      if (updateError) throw updateError;
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    } catch (caught) {
      console.error("Notifications could not be marked as read:", caught instanceof Error ? caught.message : "Unknown error");
      setError("Notifications could not be marked as read. Please try again.");
    } finally {
      markingReadRef.current = false;
      setMarkingRead(false);
    }
  }

  function notificationText(item: StoredNotification) {
    const actor = item.actor?.display_name || (item.actor?.username ? `@${item.actor.username}` : "A PANDA member");
    switch (item.kind) {
      case "like": return `${actor} liked your post.`;
      case "comment": return `${actor} commented on your post.`;
      case "follow": return `${actor} followed you.`;
      case "follow_request": return `${actor} requested to follow you.`;
      case "message": return `${actor} sent you a message.`;
    }
  }

  return <div className="secondary-view">
    <div className="secondary-heading"><div className="eyebrow"><Bell size={14} /> NOTIFICATIONS</div><h1>Little things worth <span>noticing.</span></h1><p>Updates recorded for your account.</p></div>
    {!userId
      ? <div className="empty-card"><Bell size={23} /><strong>Sign in to view notifications</strong><span>Your account notifications are private.</span></div>
      : <div className="notifications-panel">
          <div className="notification-top"><strong>Recent notifications</strong><button className="text-button" onClick={() => void markAllRead()} disabled={markingRead || !notifications.some((item) => !item.read_at)}>{markingRead ? "Marking?" : "Mark all as read"}</button></div>
          {error && <p className="profile-account-error" role="alert">{error}</p>}
          {loading ? <p className="connections-empty" role="status">Loading notifications?</p>
            : notifications.length ? notifications.map((item) => {
              const Icon = item.kind === "follow" || item.kind === "follow_request" ? UsersRound : item.kind === "message" ? MessageCircle : Bell;
              return <article className="notification-row" key={item.id}>
                <Avatar src="" name={item.actor?.display_name || item.actor?.username || "PANDA member"} />
                <span className="notification-type"><Icon size={14} /></span>
                <div className="notification-copy"><p>{notificationText(item)}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>
                {!item.read_at && <span className="unread-dot" aria-label="Unread" />}
              </article>;
            })
            : !error && <div className="empty-card"><Bell size={23} /><strong>No notifications yet</strong><span>New account activity will appear here.</span></div>}
        </div>}
  </div>;
}

function OwnProfilePosts({ profileId }: { profileId: string | null }) {
  const [posts, setPosts] = useState<MemberPost[]>([]);
  const [loading, setLoading] = useState(Boolean(profileId));
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!profileId) return () => { active = false; };
    void (async () => {
      try {
        const client = createSupabaseBrowserClient();
        const { data: rows, error: resultError } = await client
          .from("posts")
          .select("id,caption,media_path,media_type,created_at")
          .eq("author_id", profileId)
          .order("created_at", { ascending: false });
        if (resultError) throw resultError;

        const loadedPosts = await Promise.all((rows ?? []).map(async (post): Promise<MemberPost> => {
          const { data, error: mediaError } = await client.storage.from("post-media").createSignedUrl(post.media_path, 300);
          if (mediaError) throw mediaError;
          return {
            id: post.id,
            caption: post.caption,
            media_path: post.media_path,
            media_type: post.media_type === "video" ? "video" : "image",
            created_at: post.created_at,
            media_url: data.signedUrl,
          };
        }));
        if (active) setPosts(loadedPosts);
      } catch (caught) {
        if (!active) return;
        console.error("Your posts could not be loaded:", caught instanceof Error ? caught.message : "Unknown error");
        setError("Your posts could not be loaded. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [profileId]);

  if (!profileId) return <div className="profile-empty"><ImagePlus size={21} /><strong>Sign in to view your posts</strong></div>;
  if (loading) return <p className="profile-account-status" role="status">Loading your posts…</p>;
  if (error) return <p className="profile-account-error" role="alert">{error}</p>;
  if (!posts.length) return <div className="profile-empty"><ImagePlus size={21} /><strong>No posts yet</strong></div>;

  return <div className="profile-post-grid">{posts.map((post) => <article key={post.id} className="member-post">
    {post.media_type === "video"
      ? <video src={post.media_url} controls playsInline preload="metadata" />
      : <div className="member-post-image" role="img" aria-label={post.caption || "Your post"} style={{ backgroundImage: `url("${post.media_url}")` }} />}
    {post.caption && <p>{post.caption}</p>}
  </article>)}</div>;
}

function ProfileView({ followCounts, followCountsError, profile, accountState, isAuthenticated, accountError, logoutError, logoutBusy, onLogout, onSaveProfile, onSaveAvatar, onCheckUsernameAvailability, onOpenConnections }: {
  followCounts: FollowCounts | null;
  followCountsError: string;
  profile: AccountProfile | null;
  accountState: AccountState;
  isAuthenticated: boolean;
  accountError: string;
  logoutError: string;
  logoutBusy: boolean;
  onLogout: () => void;
  onSaveProfile: (username: string, displayName: string, bio: string) => Promise<AccountProfile>;
  onSaveAvatar: (file: File) => Promise<AccountProfile>;
  onCheckUsernameAvailability: (username: string) => Promise<boolean>;
  onOpenConnections: (connection: ConnectionType) => void;
}) {
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const savingRef = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [usernameAvailability, setUsernameAvailability] = useState<"idle" | "checking" | "available" | "taken" | "error">("idle");
  const displayedName = profile?.display_name ?? displayName;
  const displayedUsername = profile?.username ?? "";
  const displayedBio = profile?.bio ?? bio;
  const displayedAvatar = profile?.avatar_url || getProfileAvatarUrl(profile?.avatar_path);

  useEffect(() => {
    const parsedUsername = usernameSchema.safeParse(username);
    if (!editing || !isAuthenticated || !parsedUsername.success) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      void onCheckUsernameAvailability(parsedUsername.data)
        .then((available) => {
          if (active) setUsernameAvailability(available ? "available" : "taken");
        })
        .catch(() => {
          if (active) setUsernameAvailability("error");
        });
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [editing, isAuthenticated, onCheckUsernameAvailability, username]);

  function openEditor() {
    if (!profile || accountState !== "signed-in") return;
    setUsernameAvailability("checking");
    setUsername(profile.username);
    setDisplayName(profile.display_name);
    setBio(profile.bio);
    setSaveError("");
    setNotice("");
    setEditing(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;

    const result = profileUpdateSchema.safeParse({ username, displayName, bio });
    if (!result.success) {
      setSaveError(result.error.issues[0]?.message ?? "Check your profile details and try again.");
      return;
    }

    setSaveError("");
    setNotice("");
    savingRef.current = true;
    setSaving(true);
    try {
      const savedProfile = await onSaveProfile(result.data.username, result.data.displayName, result.data.bio);
      setUsername(savedProfile.username);
      setDisplayName(savedProfile.display_name);
      setBio(savedProfile.bio);
      setEditing(false);
      setNotice("Profile saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "We couldn't save your profile. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function saveAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const validationError = validateAvatarMedia(file);
    if (validationError) {
      setAvatarError(validationError);
      input.value = "";
      return;
    }

    setAvatarSaving(true);
    setAvatarError("");
    try {
      await onSaveAvatar(file);
      setNotice("Profile photo saved.");
    } catch (caught) {
      setAvatarError(caught instanceof Error ? caught.message : "The profile photo could not be saved.");
    } finally {
      setAvatarSaving(false);
      input.value = "";
    }
  }

  return <div className="secondary-view profile-view">
    <div className="eyebrow"><UserRound size={14} /> YOUR LITTLE CORNER</div>
    <section className="profile-cover"><div className="cover-sparkle">✳</div></section>
    <div className="profile-page-head">
      <Avatar src={displayedAvatar} name={displayedName || displayedUsername || "PANDA member"} size="lg" />
      <div className="profile-actions">
        <input ref={avatarInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" aria-label="Choose profile photo" onChange={(event) => void saveAvatarFile(event)} />
        <button type="button" className="outline-button" disabled={!profile || accountState !== "signed-in" || avatarSaving} onClick={() => avatarInputRef.current?.click()}><ImagePlus size={14} />{avatarSaving ? "Saving photo…" : "Change photo"}</button>
        <button type="button" className="outline-button" onClick={openEditor} disabled={!profile || accountState !== "signed-in"}>Edit profile</button>
        <button type="button" className="primary-button" disabled title="Post publishing is not available yet"><Plus size={15} />Create post</button>
        {isAuthenticated && <button type="button" className="outline-button profile-logout-button" onClick={onLogout} disabled={logoutBusy}><LogOut size={14} />{logoutBusy ? "Signing out…" : "Log out"}</button>}
      </div>
    </div>
    <div className="profile-page-bio">
      <h1>{displayedName || "Display name not set"} <span>{displayedUsername ? `@${displayedUsername}` : "Username unavailable"}</span></h1>
      <p>{displayedBio || "No bio has been added yet."}</p>
      {accountState === "loading" && <p className="profile-account-status" role="status">Loading your account profile…</p>}
      {accountState === "error" && accountError && <p className="profile-account-error" role="alert">{accountError}</p>}
      {accountState === "signed-out" && <p className="profile-account-status">Sign in to load your saved PANDA profile.</p>}
      {followCountsError && <p className="profile-account-error" role="status">{followCountsError}</p>}
      {avatarError && <p className="profile-account-error" role="alert">{avatarError}</p>}
      {logoutError && <p className="profile-account-error" role="alert">{logoutError}</p>}
      <div className="profile-stats" aria-label="Profile statistics">
        <button type="button" disabled={!profile || !followCounts} onClick={() => onOpenConnections("followers")}><strong>{followCounts?.followers ?? "—"}</strong><span>followers</span></button>
        <button type="button" disabled={!profile || !followCounts} onClick={() => onOpenConnections("following")}><strong>{followCounts?.following ?? "—"}</strong><span>following</span></button>
      </div>
    </div>
    <div className="profile-tabs" role="tablist" aria-label="Profile posts">
      <button type="button" role="tab" aria-selected="true" className="active"><ImagePlus size={15} /> POSTS</button>
      <button type="button" role="tab" aria-selected="false" disabled title="Bookmarks are not available yet"><Bookmark size={15} /> SAVED</button>
    </div>
    <OwnProfilePosts key={profile?.id ?? "signed-out"} profileId={profile?.id ?? null} />
    <p className="profile-preview-note">Post publishing and bookmarks are not connected yet.</p>
    {notice && <p className="profile-notice" role="status">{notice}</p>}
    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditing(false); }}>
      <section className="profile-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
        <header className="modal-header"><h2 id="edit-profile-title">Edit profile</h2><button className="icon-button" aria-label="Close edit profile" onClick={() => { if (!saving) setEditing(false); }} disabled={saving}><X size={20} /></button></header>
        <form className="profile-edit-form" onSubmit={saveProfile}>
          <label>Username<div className="profile-username-input"><span>@</span><input value={username} maxLength={24} autoCapitalize="none" spellCheck={false} onChange={(event) => { setUsername(event.target.value); setUsernameAvailability(usernameSchema.safeParse(event.target.value).success ? "checking" : "idle"); setSaveError(""); }} required disabled={saving} /></div></label>
          {usernameAvailability !== "idle" && <p className={`auth-username-availability ${usernameAvailability}`} role={usernameAvailability === "taken" ? "alert" : "status"}>
            {usernameAvailability === "checking" && "Checking username…"}
            {usernameAvailability === "available" && "Username available"}
            {usernameAvailability === "taken" && "Username already taken"}
            {usernameAvailability === "error" && "Couldn't check availability. The database will confirm when you save."}
          </p>}
          <label>Display name<input value={displayName} maxLength={60} onChange={(event) => { setDisplayName(event.target.value); setSaveError(""); }} required disabled={saving} /></label>
          <label>Bio<textarea value={bio} maxLength={300} rows={4} onChange={(event) => { setBio(event.target.value); setSaveError(""); }} disabled={saving} /><small className="profile-character-count">{bio.length}/300</small></label>
          {saveError && <p className="profile-account-error" role="alert">{saveError}</p>}
          <button className="primary-button profile-save-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
        </form>
      </section>
    </div>}
  </div>;
}

function SettingsView({ themePreference, onThemeChange, onViewProfile, onViewNotifications, userId, privacyReady, isPrivate, onSavePrivacy, incomingRequests, followBusyIds, onRespondToRequest, startPinSetup, onPinSetupHandled }: {
  themePreference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
  onViewProfile: () => void;
  onViewNotifications: () => void;
  userId: string | null;
  privacyReady: boolean;
  isPrivate: boolean;
  onSavePrivacy: (value: boolean) => Promise<boolean>;
  incomingRequests: FollowRequest[];
  followBusyIds: string[];
  onRespondToRequest: (requestId: string, requesterId: string, accept: boolean) => void;
  startPinSetup: boolean;
  onPinSetupHandled: () => void;
}) {
  const [privacySelection, setPrivacySelection] = useState(isPrivate);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState("");
  const [privacyNotice, setPrivacyNotice] = useState("");

  async function savePrivacy(event: ChangeEvent<HTMLSelectElement>) {
    const nextValue = event.currentTarget.value === "private";
    setPrivacySelection(nextValue);
    setPrivacySaving(true);
    setPrivacyError("");
    setPrivacyNotice("");
    try {
      await onSavePrivacy(nextValue);
      setPrivacyNotice("Account privacy saved.");
    } catch (error) {
      setPrivacySelection(isPrivate);
      setPrivacyError(error instanceof Error ? error.message : "We couldn't save your account privacy setting.");
    } finally {
      setPrivacySaving(false);
    }
  }

  return (
    <div className="secondary-view">
      <div className="secondary-heading">
        <div className="eyebrow"><Settings2 size={14} /> MAKE YOURSELF AT HOME</div>
        <h1>Space that feels <span>like yours.</span></h1>
        <p>A few ways to make your experience your own.</p>
      </div>
      <div className="settings-panel">
        <section>
          <div className="settings-section-title">
            <UserRound size={17} />
            <div><strong>Your account</strong><span>Personal details and how people find you.</span></div>
          </div>
          <button className="setting-row" onClick={onViewProfile}>
            <span><strong>Account details</strong><small>View your profile</small></span>
            <ArrowUpRight size={17} />
          </button>
        </section>
        <section>
          <div className="settings-section-title">
            <ShieldCheck size={17} />
            <div><strong>Privacy</strong><span>Choose who can see your profile and posts.</span></div>
          </div>
          {userId
            ? <>
                <label className="setting-row theme-setting-row privacy-setting-row">
                  <span><strong>Account privacy</strong><small>{privacyReady ? privacySelection ? "Only approved followers can see your posts." : "Anyone can see your profile and posts." : "Loading your saved account privacy…"}</small></span>
                  <select aria-label="Account privacy" value={privacySelection ? "private" : "public"} disabled={!privacyReady || privacySaving} onChange={(event) => void savePrivacy(event)}>
                    <option value="public">Public</option><option value="private">Private</option>
                  </select>
                </label>
                {privacySaving && <p className="settings-inline-status" role="status">Saving account privacy…</p>}
                {privacyNotice && <p className="settings-inline-success" role="status">{privacyNotice}</p>}
                {privacyError && <p className="settings-inline-error" role="alert">{privacyError}</p>}
                <section className="follow-requests-panel" aria-labelledby="follow-requests-heading">
                  <div className="settings-subsection-heading"><strong id="follow-requests-heading">Follow requests</strong><span>Approve requests to share private posts.</span></div>
                  {incomingRequests.length
                    ? <div className="follow-request-list">{incomingRequests.map((request) => {
                        const busy = followBusyIds.includes(request.id);
                        return <article className="follow-request-row" key={request.id}>
                          <Avatar src={request.profile.avatar_url || getProfileAvatarUrl(request.profile.avatar_path)} name={request.profile.display_name || request.profile.username} size="sm" />
                          <div className="suggestion-copy"><strong>{request.profile.display_name || request.profile.username}</strong><span>@{request.profile.username}</span></div>
                          <button type="button" className="outline-button" disabled={busy} onClick={() => onRespondToRequest(request.id, request.requester_id, false)}>{busy ? "…" : "Decline"}</button>
                          <button type="button" className="primary-button" disabled={busy} onClick={() => onRespondToRequest(request.id, request.requester_id, true)}>{busy ? "…" : "Accept"}</button>
                        </article>;
                      })}</div>
                    : <p className="follow-requests-empty">No follow requests yet.</p>}
                </section>
                <div className="hidden-chat-settings">
                <div className="hidden-chat-settings-heading">
                  <LockKeyhole size={16} />
                  <div><strong>Hidden Chats</strong><span>Use a PIN to protect private conversations.</span></div>
                </div>
                <PinManager userId={userId} startSetup={startPinSetup} onSetupHandled={onPinSetupHandled} embedded />
                <div className="secret-code-settings">
                  <div className="hidden-chat-settings-heading">
                    <LockKeyhole size={15} />
                    <div><strong>Hidden Inbox Secret Code</strong><span>Type it in Inbox search. Your PIN can recover or change it.</span></div>
                  </div>
                  <SecretCodeManager userId={userId} />
                </div>
                </div>
              </>
            : <p className="hidden-chat-status">Sign in to manage your Hidden Chats PIN.</p>}
        </section>
        <section>
          <div className="settings-section-title">
            <Sun size={17} />
            <div><strong>Your experience</strong><span>A little comfort, just how you like it.</span></div>
          </div>
          <label className="setting-row theme-setting-row">
            <span><strong>Appearance</strong><small>Choose a saved preference or follow your device.</small></span>
            <select aria-label="Theme preference" value={themePreference} onChange={(event) => onThemeChange(event.target.value as ThemePreference)}>
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
          <button className="setting-row" onClick={onViewNotifications}>
            <span><strong>Notifications</strong><small>View activity recorded for your account.</small></span>
            <Bell size={17} />
          </button>
          <div className="setting-row setting-row-unavailable" aria-disabled="true">
            <span><strong>Notification preferences</strong><small>Saved mute settings are not available yet.</small></span>
            <Bell size={17} />
          </div>
        </section>
        <div className="settings-footnote"><LockKeyhole size={16} /> Account privacy is saved to your PANDA profile. Theme preference is saved locally.</div>
      </div>
    </div>
  );
}
