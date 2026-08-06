import { z } from "zod";

const authNextSchema = z.enum(["dashboard", "radars", "connect-telegram"]);

export const authSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  next: authNextSchema.optional(),
});

export type AuthInput = z.infer<typeof authSchema>;
export type AuthNext = z.infer<typeof authNextSchema>;
