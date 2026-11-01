import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters.")
  .max(24, "Username must be 24 characters or fewer.")
  .regex(/^[a-z0-9_]+$/, "Use only letters, numbers, and underscores.");

const passwordSchema = z
  .string()
  .min(8, "Your password must be at least 8 characters.")
  .max(72, "Your password must be 72 characters or fewer.");

export const signInSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const signUpSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    displayName: z
      .string()
      .trim()
      .min(1, "Add a display name.")
      .max(60, "Display name must be 60 characters or fewer."),
    isPrivate: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Those passwords don’t match.",
    path: ["confirmPassword"],
  });

export const resetRequestSchema = z.object({ username: usernameSchema });
