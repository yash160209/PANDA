"use client";

import { Bookmark, Heart, MessageSquare, Send, Share2, Video } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendUniquePosts,
  filterVideoPosts,
  selectActiveVideoIndex,
  shouldLoadNextPage,
  type FeedMediaType,
} from "@/lib/feed/pagination";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { postCommentSchema } from "@/lib/validation/post";

const PAGE_SIZE = 8;

type FeedRow = {
  id: string;
  author_id: string;
  caption: string;
  media_path: string;
  media_type: FeedMediaType;
  created_at: string;
};

type FeedProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
};

type FeedComment = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  profile: FeedProfile | null;
};

type FeedPost = FeedRow & {
  media_url: string;
  profile: FeedProfile | null;
  likes: number;
  comments: number;
  liked_by_viewer: boolean;
};

type FeedMode = "mixed" | "reels";

export function ContentFeed({ mode, userId, onOpenProfile }: {
  mode: FeedMode;
  userId: string | null;
  onOpenProfile: (profileId: string) => void;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyPostIds, setBusyPostIds] = useState<string[]>([]);
  const [expandedPostIds, setExpandedPostIds] = useState<string[]>([]);
  const [commentRows, setCommentRows] = useState<Record<string, FeedComment[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const nextOffset = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const busyRef = useRef(new Set<string>());
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadNextPage = useCallback(async (reset = false) => {
    if (loadingRef.current || (!reset && !hasMoreRef.current)) return;
    loadingRef.current = true;
    const offset = reset ? 0 : nextOffset.current;
    if (reset) {
      setLoading(true);
      setError("");
      setHasMore(true);
      hasMoreRef.current = true;
      nextOffset.current = 0;
    } else {
      setLoadingMore(true);
      setError("");
    }

    try {
      if (!isSupabaseConfigured()) {
        throw new Error("Supabase is not configured.");
      }

      const client = createSupabaseBrowserClient();
      let request = client
        .from("posts")
        .select("id,author_id,caption,media_path,media_type,created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (mode === "reels") request = request.eq("media_type", "video");

      const { data, error: postsError } = await request.range(offset, offset + PAGE_SIZE - 1);
      if (postsError) throw postsError;

      const rows = (data ?? []) as FeedRow[];
      const selectedRows = mode === "reels" ? filterVideoPosts(rows) : rows;
      const authorIds = [...new Set(selectedRows.map((post) => post.author_id))];
      const { data: profiles, error: profilesError } = authorIds.length
        ? await client.from("profiles").select("id,username,display_name,avatar_path").in("id", authorIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileById = new Map(((profiles ?? []) as FeedProfile[]).map((profile) => [profile.id, profile]));

      const enrichedPosts = await Promise.all(selectedRows.map(async (post): Promise<FeedPost> => {
        const { data: media, error: mediaError } = await client.storage
          .from("post-media")
          .createSignedUrl(post.media_path, 300);
        if (mediaError) throw mediaError;

        const [{ count: likes, error: likesError }, { count: comments, error: commentsError }, likedResult] = await Promise.all([
          client.from("post_likes").select("post_id", { count: "exact", head: true }).eq("post_id", post.id),
          client.from("comments").select("id", { count: "exact", head: true }).eq("post_id", post.id),
          userId
            ? client.from("post_likes").select("post_id").eq("post_id", post.id).eq("user_id", userId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (likesError) throw likesError;
        if (commentsError) throw commentsError;
        if (likedResult.error) throw likedResult.error;

        return {
          ...post,
          media_url: media.signedUrl,
          profile: profileById.get(post.author_id) ?? null,
          likes: likes ?? 0,
          comments: comments ?? 0,
          liked_by_viewer: Boolean(likedResult.data),
        };
      }));

      setPosts((current) => reset ? enrichedPosts : appendUniquePosts(current, enrichedPosts));
      nextOffset.current = offset + rows.length;
      hasMoreRef.current = rows.length === PAGE_SIZE;
      setHasMore(hasMoreRef.current);
    } catch (caught) {
      console.error("Content feed could not be loaded:", caught instanceof Error ? caught.message : "Unknown error");
      setError("Posts could not be loaded. Please try again.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [mode, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNextPage(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadNextPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || loadingMore || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (shouldLoadNextPage(entries.some((entry) => entry.isIntersecting), loadingRef.current, hasMoreRef.current)) {
        void loadNextPage();
      }
    }, { rootMargin: "500px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMore, loadNextPage, loading, loadingMore]);

  useEffect(() => {
    const root = document.querySelector(".content-feed-list");
    const videos = root ? [...root.querySelectorAll<HTMLVideoElement>("video[data-feed-video]")] : [];
    if (!videos.length) return;
    const pauseOffscreen = () => {
      const visibleRatios = videos.map((video) => {
        const rect = video.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return rect.height > 0 ? visibleHeight / rect.height : 0;
      });
      const activeIndex = selectActiveVideoIndex(visibleRatios);
      videos.forEach((video, index) => { if (index !== activeIndex) video.pause(); });
    };
    const observer = new IntersectionObserver(pauseOffscreen, { threshold: [0, 0.5, 1] });
    videos.forEach((video) => observer.observe(video));
    window.addEventListener("scroll", pauseOffscreen, { passive: true });
    pauseOffscreen();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", pauseOffscreen);
      videos.forEach((video) => video.pause());
    };
  }, [posts]);

  async function toggleLike(post: FeedPost) {
    if (!userId) {
      setActionError("Sign in to like posts.");
      return;
    }
    if (busyRef.current.has(post.id)) return;
    busyRef.current.add(post.id);
    setBusyPostIds((current) => [...current, post.id]);
    setActionError("");
    try {
      const client = createSupabaseBrowserClient();
      const result = post.liked_by_viewer
        ? await client.from("post_likes").delete().eq("post_id", post.id).eq("user_id", userId)
        : await client.from("post_likes").insert({ post_id: post.id, user_id: userId });
      if (result.error) throw result.error;
      setPosts((current) => current.map((item) => item.id === post.id
        ? { ...item, liked_by_viewer: !post.liked_by_viewer, likes: item.likes + (post.liked_by_viewer ? -1 : 1) }
        : item));
    } catch (caught) {
      console.error("Post like could not be updated:", caught instanceof Error ? caught.message : "Unknown error");
      setActionError("Your like could not be saved. Please try again.");
    } finally {
      busyRef.current.delete(post.id);
      setBusyPostIds((current) => current.filter((id) => id !== post.id));
    }
  }

  async function toggleComments(post: FeedPost) {
    const isOpen = expandedPostIds.includes(post.id);
    setExpandedPostIds((current) => isOpen ? current.filter((id) => id !== post.id) : [...current, post.id]);
    if (isOpen || commentRows[post.id]) return;

    try {
      const client = createSupabaseBrowserClient();
      const { data, error: commentsError } = await client.from("comments")
        .select("id,author_id,body,created_at")
        .eq("post_id", post.id)
        .order("created_at", { ascending: true })
        .limit(50);
      if (commentsError) throw commentsError;
      const rows = (data ?? []) as Omit<FeedComment, "profile">[];
      const authorIds = [...new Set(rows.map((comment) => comment.author_id))];
      const { data: profiles, error: profilesError } = authorIds.length
        ? await client.from("profiles").select("id,username,display_name,avatar_path").in("id", authorIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileById = new Map(((profiles ?? []) as FeedProfile[]).map((profile) => [profile.id, profile]));
      setCommentRows((current) => ({
        ...current,
        [post.id]: rows.map((comment) => ({ ...comment, profile: profileById.get(comment.author_id) ?? null })),
      }));
    } catch (caught) {
      console.error("Post comments could not be loaded:", caught instanceof Error ? caught.message : "Unknown error");
      setActionError("Comments could not be loaded. Please try again.");
    }
  }

  async function addComment(post: FeedPost, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) {
      setActionError("Sign in to comment on posts.");
      return;
    }
    const parsed = postCommentSchema.safeParse(commentDrafts[post.id] ?? "");
    if (!parsed.success) {
      setActionError(parsed.error.issues[0]?.message ?? "Enter a valid comment.");
      return;
    }

    try {
      const client = createSupabaseBrowserClient();
      const { data, error: insertError } = await client.from("comments")
        .insert({ post_id: post.id, author_id: userId, body: parsed.data })
        .select("id,author_id,body,created_at")
        .single();
      if (insertError) throw insertError;
      const profile = userId
        ? await client.from("profiles").select("id,username,display_name,avatar_path").eq("id", userId).maybeSingle()
        : { data: null, error: null };
      if (profile.error) throw profile.error;
      const row = data as Omit<FeedComment, "profile">;
      setCommentRows((current) => ({
        ...current,
        [post.id]: [...(current[post.id] ?? []), { ...row, profile: profile.data as FeedProfile | null }],
      }));
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, comments: item.comments + 1 } : item));
      setCommentDrafts((current) => ({ ...current, [post.id]: "" }));
      setExpandedPostIds((current) => current.includes(post.id) ? current : [...current, post.id]);
      setActionError("");
    } catch (caught) {
      console.error("Post comment could not be saved:", caught instanceof Error ? caught.message : "Unknown error");
      setActionError("Your comment could not be saved. Please try again.");
    }
  }

  async function sharePost(post: FeedPost) {
    const url = `${window.location.origin}/feed#post-${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "PANDA post", text: post.caption, url });
      } else {
        await navigator.clipboard.writeText(url);
        setActionError("Post link copied.");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      console.error("Post could not be shared:", caught instanceof Error ? caught.message : "Unknown error");
      setActionError("This post could not be shared from your browser.");
    }
  }

  const visiblePosts = mode === "reels"
    ? posts.filter((post) => post.media_type === "video")
    : posts;

  return (
    <div className={`content-feed-page${mode === "reels" ? " reels-page" : ""}`}>
      <header className="content-feed-heading">
        <div><span className="eyebrow">{mode === "reels" ? <Video size={14} /> : null}{mode === "reels" ? "PANDA VIDEO" : "YOUR PEOPLE, IN ONE PLACE"}</span>
          <h1>{mode === "reels" ? "Reels" : "Feed"}</h1>
          <p>{mode === "reels" ? "Video posts shared by PANDA members." : "Posts from public accounts and people you follow."}</p>
        </div>
      </header>
      {actionError && <p className="content-feed-alert" role="status">{actionError}</p>}
      {error && <div className="content-feed-state" role="alert"><strong>{error}</strong><button type="button" className="outline-button" onClick={() => void loadNextPage(posts.length === 0)}>Try again</button></div>}
      {loading && !posts.length && <p className="content-feed-state" role="status">Loading {mode === "reels" ? "Reels" : "posts"}…</p>}
      {!loading && !error && !visiblePosts.length && <div className="content-feed-state"><strong>{mode === "reels" ? "No Reels yet" : "No posts to show yet"}</strong><span>{mode === "reels" ? "Video posts will appear here when members share them." : "Posts from public accounts and approved follows will appear here."}</span></div>}
      <div className="content-feed-list" aria-live="polite">
        {visiblePosts.map((post) => {
          const authorName = post.profile?.display_name || post.profile?.username || "PANDA member";
          const handle = post.profile?.username ?? "member";
          const busy = busyPostIds.includes(post.id);
          const thread = commentRows[post.id] ?? [];
          return <article className={`content-post-card${mode === "reels" ? " reel-card" : ""}`} id={`post-${post.id}`} key={post.id}>
            <header className="content-post-header">
              <button type="button" className="content-author-button" onClick={() => post.profile && onOpenProfile(post.author_id)} disabled={!post.profile}>
                <span className="content-avatar" aria-hidden="true">{authorName.slice(0, 1).toUpperCase()}</span>
                <span><strong>{authorName}</strong><small>@{handle} · {new Date(post.created_at).toLocaleString()}</small></span>
              </button>
            </header>
            <div className="content-post-media">
              {post.media_type === "video"
                ? <video data-feed-video controls playsInline preload="metadata" src={post.media_url} aria-label={`Video by ${authorName}`} />
                : <Image unoptimized width={1200} height={1200} src={post.media_url} alt={post.caption ? `Post by ${authorName}: ${post.caption}` : `Post by ${authorName}`} loading="lazy" />}
            </div>
            {post.caption && <p className="content-post-caption"><strong>@{handle}</strong> {post.caption}</p>}
            <div className="content-post-actions">
              <button type="button" className={post.liked_by_viewer ? "is-liked" : ""} aria-label={post.liked_by_viewer ? "Unlike post" : "Like post"} disabled={busy} onClick={() => void toggleLike(post)}><Heart size={20} fill={post.liked_by_viewer ? "currentColor" : "none"} /><span>{post.likes}</span></button>
              <button type="button" aria-expanded={expandedPostIds.includes(post.id)} onClick={() => void toggleComments(post)}><MessageSquare size={19} /><span>{post.comments}</span></button>
              <button type="button" aria-label="Share post" onClick={() => void sharePost(post)}><Share2 size={19} /></button>
              <button type="button" aria-label="Bookmarks are not available yet" title="Bookmarks are not connected to the database yet" disabled><Bookmark size={19} /></button>
            </div>
            {expandedPostIds.includes(post.id) && <section className="content-comments" aria-label={`Comments on ${authorName}'s post`}>
              {thread.map((comment) => <p key={comment.id}><strong>@{comment.profile?.username ?? "member"}</strong> {comment.body}</p>)}
              {!thread.length && <p className="content-comments-empty">No comments yet.</p>}
              <form onSubmit={(event) => void addComment(post, event)}>
                <input value={commentDrafts[post.id] ?? ""} maxLength={500} aria-label={`Comment on ${authorName}'s post`} placeholder="Write a comment…" onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} />
                <button type="submit" aria-label="Send comment" disabled={!commentDrafts[post.id]?.trim()}><Send size={16} /></button>
              </form>
            </section>}
          </article>;
        })}
      </div>
      <div ref={sentinelRef} className="content-feed-sentinel" aria-hidden="true" />
      {loadingMore && <p className="content-feed-state" role="status">Loading more…</p>}
      {!loading && !loadingMore && !hasMore && visiblePosts.length > 0 && <p className="content-feed-end">You’re all caught up.</p>}
    </div>
  );
}
