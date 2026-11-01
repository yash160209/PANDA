"use client";

import { ChevronLeft, ChevronRight, Clock3, Eye, Flame, Hand, Heart, Laugh, Plus, Trash2, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { z } from "zod";
import { validateStoryMedia } from "@/lib/stories/media";

const storySchema = z.object({
  id: z.string().uuid(),
  mediaType: z.enum(["image", "video"]),
  mediaUrl: z.string().url(),
  caption: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  viewed: z.boolean(),
  myReaction: z.enum(["heart", "fire", "laugh", "clap"]).nullable(),
});
const groupSchema = z.object({
  owner: z.object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().url().nullable(),
    isOwn: z.boolean(),
  }),
  stories: z.array(storySchema).min(1),
});
const feedSchema = z.object({ groups: z.array(groupSchema) });
const viewersSchema = z.object({
  viewers: z.array(z.object({
    username: z.string().nullable(),
    displayName: z.string(),
    avatarUrl: z.string().url().nullable(),
    viewedAt: z.string(),
  })),
});

type StoryGroup = z.infer<typeof groupSchema>;
type Story = z.infer<typeof storySchema>;
type Viewer = z.infer<typeof viewersSchema>["viewers"][number];
type Reaction = NonNullable<Story["myReaction"]>;

const reactionOptions: { value: Reaction; label: string; icon: typeof Heart }[] = [
  { value: "heart", label: "Love", icon: Heart },
  { value: "fire", label: "Fire", icon: Flame },
  { value: "laugh", label: "Funny", icon: Laugh },
  { value: "clap", label: "Clap", icon: Hand },
];

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function uploadStory(file: File, caption: string, onProgress: (progress: number) => void) {
  return new Promise<{ storyId: string }>((resolve, reject) => {
    const body = new FormData();
    body.set("file", file);
    body.set("caption", caption);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/stories");
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    request.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error("The story could not be uploaded."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        const message = payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : "The story could not be uploaded.";
        reject(new Error(message));
        return;
      }
      const result = z.object({ storyId: z.string().uuid() }).safeParse(payload);
      if (!result.success) reject(new Error("The story could not be uploaded."));
      else resolve(result.data);
    };
    request.send(body);
  });
}

export function Stories({ userId }: { userId: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState<{ group: number; story: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [viewersLoading, setViewersLoading] = useState(false);
  const [viewersError, setViewersError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [reactionError, setReactionError] = useState("");
  const filePreview = useMemo(() => selectedFile ? URL.createObjectURL(selectedFile) : "", [selectedFile]);
  const activeGroup = active ? groups[active.group] : null;
  const activeStory = activeGroup && active ? activeGroup.stories[active.story] : null;
  const ownGroup = groups.find((group) => group.owner.isOwn);

  const loadStories = useCallback(async () => {
    if (!userId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/stories", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Stories are unavailable.");
      const parsed = feedSchema.safeParse(payload);
      if (!parsed.success) throw new Error("The stories response was invalid.");
      setGroups(parsed.data.groups);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Stories are unavailable.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStories(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStories]);

  useEffect(() => {
    if (!filePreview) return;
    return () => URL.revokeObjectURL(filePreview);
  }, [filePreview]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!groups.length) return;
    const nextExpiry = Math.min(...groups.flatMap((group) => group.stories.map((story) => new Date(story.expiresAt).getTime())));
    const timeout = window.setTimeout(() => void loadStories(), Math.min(240_000, Math.max(1000, nextExpiry - Date.now() + 100)));
    return () => window.clearTimeout(timeout);
  }, [groups, loadStories]);

  useEffect(() => {
    if (!loadError || !userId) return;
    const timeout = window.setTimeout(() => void loadStories(), 30_000);
    return () => window.clearTimeout(timeout);
  }, [loadError, loadStories, userId]);

  const closeViewer = useCallback(() => {
    setActive(null);
    setViewers(null);
    setProgress(0);
  }, []);

  const moveStory = useCallback((direction: -1 | 1) => {
    if (!active) return;
    let groupIndex = active.group;
    let storyIndex = active.story + direction;
    while (groupIndex >= 0 && groupIndex < groups.length) {
      const group = groups[groupIndex];
      if (storyIndex >= 0 && storyIndex < group.stories.length) {
        setActive({ group: groupIndex, story: storyIndex });
        setProgress(0);
        setViewers(null);
        return;
      }
      groupIndex += direction;
      if (groupIndex < 0 || groupIndex >= groups.length) break;
      storyIndex = direction > 0 ? 0 : groups[groupIndex].stories.length - 1;
    }
    closeViewer();
  }, [active, closeViewer, groups]);

  useEffect(() => {
    if (!activeStory || activeGroup?.owner.isOwn || activeStory.viewed) return;
    const storyId = activeStory.id;
    void fetch(`/api/stories/${storyId}/view`, { method: "POST" })
      .then((response) => {
        if (response.ok) {
          setGroups((current) => current.map((group) => ({
            ...group,
            stories: group.stories.map((story) => story.id === storyId ? { ...story, viewed: true } : story),
          })));
        }
      })
      .catch((error: unknown) => console.error("Could not record story view:", error));
  }, [activeGroup?.owner.isOwn, activeStory]);

  useEffect(() => {
    if (!activeStory || activeStory.mediaType === "video" || viewers !== null) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const next = Math.min(100, ((Date.now() - started) / 5000) * 100);
      setProgress(next);
      if (next >= 100) moveStory(1);
    }, 40);
    return () => window.clearInterval(timer);
  }, [activeStory, moveStory, viewers]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowRight") moveStory(1);
      if (event.key === "ArrowLeft") moveStory(-1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, closeViewer, moveStory]);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setUploadError("");
    if (!file) return;
    const validation = validateStoryMedia(file);
    if ("error" in validation && validation.error) {
      setUploadError(validation.error);
      return;
    }
    setSelectedFile(file);
  }

  async function onUpload() {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setUploadError("");
    setUploadProgress(0);
    try {
      await uploadStory(selectedFile, caption, setUploadProgress);
      setSelectedFile(null);
      setCaption("");
      setNotice("Your story is live for 24 hours.");
      await loadStories();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The story could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  async function openViewers() {
    if (!activeStory) return;
    setViewersLoading(true);
    setViewers([]);
    setViewersError("");
    try {
      const response = await fetch(`/api/stories/${activeStory.id}/viewers`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Viewers are unavailable.");
      const parsed = viewersSchema.safeParse(payload);
      if (!parsed.success) throw new Error("The viewer list response was invalid.");
      setViewers(parsed.data.viewers);
    } catch (error) {
      setViewersError(error instanceof Error ? error.message : "Viewers are unavailable.");
    } finally {
      setViewersLoading(false);
    }
  }

  async function deleteActiveStory() {
    if (!activeStory || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/stories/${activeStory.id}`, { method: "DELETE" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "The story could not be deleted.");
      const storageCleanupPending = Boolean(payload && typeof payload === "object" && "storageCleanupPending" in payload && payload.storageCleanupPending);
      setGroups((current) => current.map((group) => ({ ...group, stories: group.stories.filter((story) => story.id !== activeStory.id) })).filter((group) => group.stories.length));
      setNotice(storageCleanupPending ? "Story deleted. Media cleanup will be retried." : "Story deleted.");
      moveStory(1);
      await loadStories();
    } catch (error) {
      setViewersError(error instanceof Error ? error.message : "The story could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function changeReaction(reaction: Reaction) {
    if (!activeStory || !activeGroup || reacting) return;
    const selected = activeStory.myReaction === reaction ? null : reaction;
    setReacting(true);
    setReactionError("");
    try {
      const response = await fetch(`/api/stories/${activeStory.id}/reaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: selected }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "The reaction could not be saved.");
      setGroups((current) => current.map((group) => ({
        ...group,
        stories: group.stories.map((story) => story.id === activeStory.id ? { ...story, myReaction: selected } : story),
      })));
    } catch (error) {
      setReactionError(error instanceof Error ? error.message : "The reaction could not be saved.");
    } finally {
      setReacting(false);
    }
  }

  function onCaptionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void onUpload();
  }

  return (
    <>
      <section className="story-strip" aria-label="Stories">
        <div className="story-heading">
          <span>Stories</span>
          <button type="button" onClick={() => void loadStories()} disabled={loading} aria-label="Refresh stories">
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div className="stories story-circles">
          {userId && <div className="story-own-wrap">
            <button className="story" type="button" onClick={() => {
              if (ownGroup) setActive({ group: groups.indexOf(ownGroup), story: 0 });
              else inputRef.current?.click();
            }} aria-label={ownGroup ? "View your story" : "Add a story"}>
              <span className="story-ring own-story">
                {ownGroup?.owner.avatarUrl
                  ? <span className="story-avatar"><Image src={ownGroup.owner.avatarUrl} alt="" width={45} height={45} unoptimized /></span>
                  : <span className="story-add-inner"><Plus size={19} /></span>}
              </span>
              <span className="story-name">Your story</span>
            </button>
            {ownGroup && <button className="story-plus-button" type="button" onClick={() => inputRef.current?.click()} aria-label="Add another story"><Plus size={11} /></button>}
          </div>}
          {groups.filter((group) => !group.owner.isOwn).map((group) => {
            const groupIndex = groups.indexOf(group);
            return <button className="story" type="button" key={group.owner.id} onClick={() => setActive({ group: groupIndex, story: 0 })} aria-label={`View ${group.owner.displayName}'s story`}>
              <span className={`story-ring${group.stories.every((story) => story.viewed) ? " story-seen" : ""}`}>
                <span className="story-avatar">{group.owner.avatarUrl ? <Image src={group.owner.avatarUrl} alt="" width={45} height={45} unoptimized /> : initials(group.owner.displayName)}</span>
              </span>
              <span className="story-name">{group.owner.displayName}</span>
            </button>;
          })}
          {!loading && !loadError && groups.length === 0 && userId && <span className="story-empty">No active stories yet. Share a moment to get started.</span>}
        </div>
        {loading && groups.length === 0 && <p className="story-status" role="status">Loading stories…</p>}
        {loadError && <p className="story-error" role="alert">{loadError} <button type="button" onClick={() => void loadStories()}>Try again</button></p>}
        {!userId && <p className="story-status">Sign in to view and share stories.</p>}
      </section>

      <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm" onChange={(event) => void onFileChange(event)} aria-label="Choose story photo or video" />
      {selectedFile && <div className="story-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !uploading) setSelectedFile(null); }}>
        <section className="story-composer" role="dialog" aria-modal="true" aria-labelledby="story-composer-title">
          <header><h2 id="story-composer-title">Add to your story</h2><button className="icon-button" type="button" onClick={() => setSelectedFile(null)} disabled={uploading} aria-label="Close story composer"><X size={20} /></button></header>
          <div className="story-preview">
            {selectedFile.type.startsWith("video/") ? <video src={filePreview} controls playsInline /> : <Image src={filePreview} alt="Story preview" width={540} height={720} unoptimized />}
          </div>
          <label className="story-caption-label">Caption <textarea value={caption} maxLength={500} onChange={(event) => setCaption(event.target.value)} onKeyDown={onCaptionKeyDown} placeholder="Add a caption…" /></label>
          <div className="story-composer-footer"><small>{caption.length}/500 · disappears after 24 hours</small><button type="button" className="story-submit" onClick={() => void onUpload()} disabled={uploading}>{uploading ? `Uploading ${uploadProgress}%` : "Share story"}</button></div>
          {uploadError && <p className="story-error" role="alert">{uploadError}</p>}
          {uploading && <progress className="story-upload-progress" max={100} value={uploadProgress} aria-label="Story upload progress" />}
        </section>
      </div>}

      {activeStory && activeGroup && active && <div className="story-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeViewer(); }}>
        <section className="story-viewer" role="dialog" aria-modal="true" aria-label={`${activeGroup.owner.displayName}'s story`} onClick={(event) => event.stopPropagation()}>
          <div className="story-progress-bars">{activeGroup.stories.map((story, index) => <span key={story.id}><i style={{ width: index < active.story ? "100%" : index === active.story ? `${progress}%` : "0%" }} /></span>)}</div>
          <header className="story-viewer-header">
            <span className="story-viewer-avatar">{activeGroup.owner.avatarUrl ? <Image src={activeGroup.owner.avatarUrl} alt="" width={35} height={35} unoptimized /> : initials(activeGroup.owner.displayName)}</span>
            <span><strong>{activeGroup.owner.displayName}</strong><small><Clock3 size={12} /> {relativeTime(activeStory.createdAt)}</small></span>
            <div className="story-viewer-actions">
              {activeGroup.owner.isOwn && <button type="button" className="story-viewer-icon" onClick={() => void openViewers()} disabled={viewersLoading} aria-label="View story viewers"><Eye size={18} /></button>}
              {activeGroup.owner.isOwn && <button type="button" className="story-viewer-icon" onClick={() => void deleteActiveStory()} disabled={deleting} aria-label="Delete story"><Trash2 size={18} /></button>}
              <button type="button" className="story-viewer-icon" onClick={closeViewer} aria-label="Close stories"><X size={20} /></button>
            </div>
          </header>
          <div className="story-viewer-media">
            {activeStory.mediaType === "video"
              ? <video key={activeStory.id} src={activeStory.mediaUrl} controls autoPlay playsInline onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (video.duration > 0) setProgress((video.currentTime / video.duration) * 100);
              }} onEnded={() => moveStory(1)} aria-label={`Story video by ${activeGroup.owner.displayName}`} />
              : <Image key={activeStory.id} src={activeStory.mediaUrl} alt={activeStory.caption || `Story by ${activeGroup.owner.displayName}`} width={900} height={1200} unoptimized />}
          </div>
          <button type="button" className="story-nav story-nav-prev" onClick={() => moveStory(-1)} aria-label="Previous story"><ChevronLeft /></button>
          <button type="button" className="story-nav story-nav-next" onClick={() => moveStory(1)} aria-label="Next story"><ChevronRight /></button>
          {activeStory.caption && <p className="story-viewer-caption">{activeStory.caption}</p>}
          {!activeGroup.owner.isOwn && <div className="story-reaction-actions" aria-label="React to story">
            {reactionOptions.map(({ value, label, icon: Icon }) => <button key={value} type="button" onClick={() => void changeReaction(value)} disabled={reacting} aria-label={`${label} reaction`} aria-pressed={activeStory.myReaction === value} className={activeStory.myReaction === value ? "selected" : ""}>
              <Icon size={18} /> {label}
            </button>)}
          </div>}
          {reactionError && <p className="story-error" role="alert">{reactionError}</p>}
          {viewersError && <p className="story-error" role="alert">{viewersError}</p>}
          {viewers !== null && <div className="story-viewer-list" role="region" aria-label="Story viewers">
            <div><strong>Viewed by</strong><button type="button" onClick={() => setViewers(null)} aria-label="Close viewer list"><X size={16} /></button></div>
            {viewersError ? <p role="alert">{viewersError}</p> : viewersLoading ? <p>Loading viewers…</p> : viewers.length ? viewers.map((viewer, index) => <div className="story-viewer-person" key={`${viewer.username ?? "private"}-${viewer.viewedAt}-${index}`}>
              <span className="story-viewer-avatar">{viewer.avatarUrl ? <Image src={viewer.avatarUrl} alt="" width={32} height={32} unoptimized /> : initials(viewer.displayName)}</span>
              <span><strong>{viewer.displayName}</strong><small>{viewer.username ? `@${viewer.username}` : "Private member"} · {relativeTime(viewer.viewedAt)}</small></span>
            </div>) : <p>No views yet.</p>}
          </div>}
          {viewersLoading && viewers === null && <span className="visually-hidden" role="status">Loading viewers…</span>}
        </section>
      </div>}
      {notice && <div className="story-toast" role="status">{notice}</div>}
    </>
  );
}
