import { describe, expect, it } from "vitest";
import { accountPrivacySchema, profileUpdateSchema } from "./profile";

describe("profileUpdateSchema", () => {
  it("trims the display name and bio", () => {
    expect(profileUpdateSchema.parse({
      username: " PANDA_FRIEND ",
      displayName: " Panda Friend ",
      bio: " Hello there ",
    })).toEqual({
      username: "panda_friend",
      displayName: "Panda Friend",
      bio: "Hello there",
    });
  });

  it("allows an empty bio but requires a display name", () => {
    expect(profileUpdateSchema.parse({ username: "panda_friend", displayName: "Panda Friend", bio: "  " })).toEqual({
      username: "panda_friend",
      displayName: "Panda Friend",
      bio: "",
    });
    expect(profileUpdateSchema.safeParse({ username: "panda_friend", displayName: "  ", bio: "" }).success).toBe(false);
  });

  it("enforces the profile column length limits", () => {
    expect(profileUpdateSchema.safeParse({ username: "panda_friend", displayName: "x".repeat(61), bio: "" }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ username: "panda_friend", displayName: "Panda Friend", bio: "x".repeat(301) }).success).toBe(false);
  });

  it("rejects usernames with invalid characters", () => {
    expect(profileUpdateSchema.safeParse({ username: "panda.friend", displayName: "Panda", bio: "" }).success).toBe(false);
  });
});

describe("accountPrivacySchema", () => {
  it("accepts only an explicit public or private boolean", () => {
    expect(accountPrivacySchema.parse({ isPrivate: true })).toEqual({ isPrivate: true });
    expect(accountPrivacySchema.parse({ isPrivate: false })).toEqual({ isPrivate: false });
    expect(accountPrivacySchema.safeParse({ isPrivate: "private" }).success).toBe(false);
    expect(accountPrivacySchema.safeParse({ isPrivate: false, userId: "another-user" }).success).toBe(false);
  });
});
