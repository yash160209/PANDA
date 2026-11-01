import { describe, expect, it } from "vitest";
import {
  appendUniquePosts,
  filterVideoPosts,
  selectActiveVideoIndex,
  shouldLoadNextPage,
  viewFromLocation,
} from "./pagination";

describe("feed pagination helpers", () => {
  it("appends only new post IDs across pages", () => {
    const first = [{ id: "a" }, { id: "b" }];
    expect(appendUniquePosts(first, [{ id: "b" }, { id: "c" }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
  });

  it("filters video posts for the Reels view without changing their order", () => {
    const posts = [
      { id: "1", media_type: "image" as const },
      { id: "2", media_type: "video" as const },
      { id: "3", media_type: "video" as const },
    ];
    expect(filterVideoPosts(posts).map((post) => post.id)).toEqual(["2", "3"]);
  });

  it("requests another page only when the sentinel is visible and loading can continue", () => {
    expect(shouldLoadNextPage(true, false, true)).toBe(true);
    expect(shouldLoadNextPage(false, false, true)).toBe(false);
    expect(shouldLoadNextPage(true, true, true)).toBe(false);
    expect(shouldLoadNextPage(true, false, false)).toBe(false);
  });

  it("selects only the most visible video and yields no active video offscreen", () => {
    expect(selectActiveVideoIndex([0.2, 0.8, 0.6])).toBe(1);
    expect(selectActiveVideoIndex([0.2, 0.4])).toBe(-1);
  });
});

describe("navigation route resolution", () => {
  it("restores feed and reels from direct routes and refreshes", () => {
    expect(viewFromLocation("/feed", "")).toBe("Feed");
    expect(viewFromLocation("/reels", "")).toBe("Reels");
  });

  it("restores a non-feed section when returning from a content route", () => {
    expect(viewFromLocation("/", "?view=Profile")).toBe("Profile");
    expect(viewFromLocation("/", "")).toBe("Home");
  });
});
