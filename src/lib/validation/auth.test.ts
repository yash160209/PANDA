import { describe, expect, it } from "vitest";
import { resetRequestSchema, signInSchema, signUpSchema, usernameSchema } from "./auth";

describe("usernameSchema", () => {
  it("trims and lowercases usernames consistently", () => {
    expect(usernameSchema.parse(" Yash_01 ")).toBe("yash_01");
  });

  it.each(["ab", "has space", "dot.name", "x".repeat(25)])("rejects invalid username %s", (username) => {
    expect(usernameSchema.safeParse(username).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts a valid username and password", () => {
    expect(signInSchema.safeParse({ username: "panda_friend", password: "long-password" }).success).toBe(true);
  });

  it("normalizes the username", () => {
    expect(signInSchema.parse({ username: "PANDA_FRIEND", password: "long-password" }).username).toBe("panda_friend");
  });

  it("rejects malformed usernames and short passwords", () => {
    expect(signInSchema.safeParse({ username: "not a username", password: "short" }).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  const validUser = {
    username: "panda_friend",
    password: "long-password",
    confirmPassword: "long-password",
    displayName: "Panda Friend",
    isPrivate: false,
  };

  it("normalizes usernames and display names", () => {
    expect(signUpSchema.parse({ ...validUser, username: "PANDA_FRIEND", displayName: " Panda Friend " })).toMatchObject({
      username: "panda_friend",
      displayName: "Panda Friend",
      isPrivate: false,
    });
  });

  it("preserves the selected private-account setting", () => {
    expect(signUpSchema.parse({ ...validUser, isPrivate: true }).isPrivate).toBe(true);
  });

  it.each(["ab", "has space", "dot.name", "x".repeat(25)])("rejects invalid username %s", (username) => {
    expect(signUpSchema.safeParse({ ...validUser, username }).success).toBe(false);
  });

  it("requires a display name and matching passwords", () => {
    expect(signUpSchema.safeParse({ ...validUser, displayName: "  " }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...validUser, confirmPassword: "different-password" }).success).toBe(false);
    expect(signUpSchema.safeParse({
      username: validUser.username,
      password: validUser.password,
      confirmPassword: validUser.confirmPassword,
      displayName: validUser.displayName,
    }).success).toBe(false);
  });
});

describe("resetRequestSchema", () => {
  it("accepts a username and never requires an email", () => {
    expect(resetRequestSchema.safeParse({ username: "panda_friend" }).success).toBe(true);
  });
});
