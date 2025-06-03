import { z } from "zod/v4";

export const loginFormSchema = z
  .object({
    email: z
      .email({
        pattern: z.regexes.html5Email,
        error: "Invalid email address",
      })
      .trim(),
    password: z
      .string()
      .trim()
      // TODO: consist with Supabase password validation
      .min(6, { error: "Password must be at least 6 characters long" }),
  })
  .required();

export const signupFormSchema = z
  .object({
    email: z.email({ pattern: z.regexes.html5Email }).trim(),
    firstName: z.string().trim().min(1, { error: "First name is too short" }),
    lastName: z.string().trim().min(1, { error: "Last name is too short" }),
    fullName: z.string().trim().min(1, { error: "Full name is too short" }),
    // TODO: consist with Supabase password validation
    password: z
      .string()
      .trim()
      .min(6, { error: "Password must be at least 6 characters long" }),
    // TODO: consist with Supabase password validation
    confirmPassword: z.string().trim().min(6, {
      error: "Confirm Password must be at least 6 characters long",
    }),
  })
  .required({ email: true, password: true, confirmPassword: true })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords do not match",
  });

export type LoginFormSchema = z.infer<typeof loginFormSchema>;
export type SignupFormSchema = z.infer<typeof signupFormSchema>;
