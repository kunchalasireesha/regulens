"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth/navigation";
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from "@/server/auth/current-actor";
import { createSession, deleteSession, verifyCredentials } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";

export type LoginState = { status: "idle" } | { status: "error"; message: string; email: string };

const loginInput = z.object({
  email: z.string().trim().min(1).max(320),
  // Bounded so a huge body cannot tie up scrypt; real passwords are far shorter.
  password: z.string().min(1).max(1024),
});

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const input = loginInput.safeParse({ email, password: formData.get("password") });
  const typedEmail = typeof email === "string" ? email : "";
  if (!input.success) {
    return { status: "error", message: "Enter your email and password.", email: typedEmail };
  }

  try {
    const db = getDb();
    const user = await verifyCredentials(db, input.data.email, input.data.password);
    if (!user) {
      // One message for an unknown email and a wrong password, so the form does not
      // reveal which addresses have accounts.
      return { status: "error", message: "Email or password is incorrect.", email: typedEmail };
    }
    const session = await createSession(db, user.userId);
    await setSessionCookie(session.token, session.expiresAt);
  } catch (error) {
    console.error("login failed", { error: error instanceof Error ? error.name : typeof error });
    return { status: "error", message: "Sign-in failed. Please try again.", email: typedEmail };
  }
  // Outside the try: redirect() throws to end the action.
  redirect(safeNextPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  // Deleting the row ends the session even if a copy of the cookie survives somewhere.
  if (token) await deleteSession(getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}
