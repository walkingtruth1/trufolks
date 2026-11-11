/**
 * Sign-up / sign-in form checks and plain-language error messages (Ticket 2b).
 * Pure functions — no React, no network — so they can be unit-tested.
 * Messages follow NFR-06 (plain reason, never a raw technical error) and P8
 * (plain words).
 */
import { minPasswordLength } from "./email-password.ts";

export const MIN_PASSWORD_LENGTH = minPasswordLength;

export type AuthField = "name" | "email" | "password";
export type FieldErrors = Partial<Record<AuthField, string>>;
export type AuthContext = "sign-up" | "sign-in";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkEmail(email: string, errors: FieldErrors): void {
  const value = email.trim();
  if (!value) errors.email = "Please enter your email.";
  else if (!EMAIL_SHAPE.test(value)) errors.email = "Please enter a valid email address.";
}

export function validateSignUp(input: { name: string; email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.name.trim()) errors.name = "Please enter your name.";
  checkEmail(input.email, errors);
  if (!input.password) errors.password = "Please choose a password.";
  else if (input.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return errors;
}

export function validateSignIn(input: { email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  checkEmail(input.email, errors);
  if (!input.password) errors.password = "Please enter your password.";
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Shape of the error object Better Auth's client returns (all fields optional). */
export type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

/** Map a Better Auth error to a plain message. Unknown errors get a safe generic one. */
export function friendlyAuthError(error: AuthErrorLike, context: AuthContext): string {
  const code = error?.code ?? "";
  if (code.startsWith("USER_ALREADY_EXISTS")) {
    return "That email is already registered. Try signing in instead.";
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "Wrong email or password.";
  if (code === "PASSWORD_TOO_SHORT") {
    return `Password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (code === "PASSWORD_TOO_LONG") return "That password is too long.";
  if (code === "INVALID_EMAIL") return "Please enter a valid email address.";
  if (error?.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return context === "sign-up"
    ? "Something went wrong creating your account. Please try again."
    : "Something went wrong signing in. Please try again.";
}
