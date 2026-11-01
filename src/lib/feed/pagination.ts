export type FeedMediaType = "image" | "video";

export function filterVideoPosts<T extends { media_type: FeedMediaType }>(posts: T[]): T[] {
  return posts.filter((post) => post.media_type === "video");
}

export function appendUniquePosts<T extends { id: string }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map((post) => post.id));
  return [...current, ...next.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  })];
}

export function shouldLoadNextPage(isIntersecting: boolean, loading: boolean, hasMore: boolean): boolean {
  return isIntersecting && !loading && hasMore;
}

export function selectActiveVideoIndex(visibleRatios: number[], threshold = 0.5): number {
  let activeIndex = -1;
  let highestRatio = threshold;
  visibleRatios.forEach((ratio, index) => {
    if (Number.isFinite(ratio) && ratio >= threshold && (activeIndex === -1 || ratio > highestRatio)) {
      activeIndex = index;
      highestRatio = ratio;
    }
  });
  return activeIndex;
}

export type AppSection = "Home" | "Explore" | "Feed" | "Reels" | "Messages" | "Hidden Chats" | "Member Profile" | "Notifications" | "Profile" | "Settings";

export function viewFromLocation(pathname: string, search: string): AppSection | null {
  if (pathname === "/feed") return "Feed";
  if (pathname === "/reels") return "Reels";
  if (pathname !== "/") return null;

  const requestedView = new URLSearchParams(search).get("view");
  return requestedView && ["Home", "Explore", "Messages", "Hidden Chats", "Member Profile", "Notifications", "Profile", "Settings"].includes(requestedView)
    ? requestedView as AppSection
    : "Home";
}
