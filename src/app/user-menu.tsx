import { findCurrentUser } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { logoutAction } from "./login/actions";

/** Who is signed in, with a sign-out button. Renders nothing on the login page. */
export async function UserMenu() {
  const user = await findCurrentUser(getDb());
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{user.name}</span>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
