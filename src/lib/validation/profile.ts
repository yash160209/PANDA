import { z } from "zod";
import { usernameSchema } from "./auth";

export const profileUpdateSchema = z.object({
  username: usernameSchema,
  displayName: z
    .string()
    .trim()
    .min(1, "Add a display name.")
    .max(60, "Display name must be 60 characters or fewer."),
  bio: z.string().trim().max(300, "Bio must be 300 characters or fewer."),
});

export const accountPrivacySchema = z.object({
  isPrivate: z.boolean(),
}).strict();
