// Ticket 2b — sign-up / sign-in form checks and plain-language errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  friendlyAuthError,
  hasErrors,
  MIN_PASSWORD_LENGTH,
  validateSignIn,
  validateSignUp,
} from "./forms.ts";

test("sign-up: empty fields are caught", () => {
  const errors = validateSignUp({ name: "  ", email: "", password: "" });
  assert.ok(errors.name && errors.email && errors.password);
});

test("sign-up: short password and bad email are caught", () => {
  const errors = validateSignUp({ name: "Ana", email: "ana@nowhere", password: "1234567" });
  assert.equal(errors.email, "Please enter a valid email address.");
  assert.equal(errors.password, `Password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});

test("sign-up: valid input has no errors", () => {
  assert.equal(hasErrors(validateSignUp({ name: "Ana", email: " ana@example.test ", password: "12345678" })), false);
});

test("sign-in: empty fields are caught, valid input passes", () => {
  const errors = validateSignIn({ email: "", password: "" });
  assert.ok(errors.email && errors.password);
  assert.equal(hasErrors(validateSignIn({ email: "ana@example.test", password: "x" })), false);
});

test("server errors map to plain messages", () => {
  assert.equal(
    friendlyAuthError({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }, "sign-up"),
    "That email is already registered. Try signing in instead.",
  );
  assert.equal(friendlyAuthError({ code: "USER_ALREADY_EXISTS" }, "sign-up"), "That email is already registered. Try signing in instead.");
  assert.equal(friendlyAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" }, "sign-in"), "Wrong email or password.");
  assert.equal(friendlyAuthError({ code: "PASSWORD_TOO_SHORT" }, "sign-up"), "Password needs at least 8 characters.");
  assert.equal(friendlyAuthError({ code: "INVALID_EMAIL" }, "sign-in"), "Please enter a valid email address.");
  assert.equal(friendlyAuthError({ status: 429 }, "sign-in"), "Too many attempts. Please wait a minute and try again.");
});

test("unknown errors get a safe generic message, never the raw text", () => {
  const raw = { code: "INTERNAL", status: 500, message: "relation \"user\" does not exist" };
  const signUp = friendlyAuthError(raw, "sign-up");
  const signIn = friendlyAuthError(null, "sign-in");
  assert.equal(signUp, "Something went wrong creating your account. Please try again.");
  assert.equal(signIn, "Something went wrong signing in. Please try again.");
  assert.ok(!signUp.includes("relation"));
});
