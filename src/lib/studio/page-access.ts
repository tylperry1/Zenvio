import { redirect } from "next/navigation";
import { currentUser } from "./shopper";
import { marketSettings } from "../marketplace";
import { configured } from "../server";

/** Storefront pages: signed-in users, or anyone once guest checkout is enabled. */
export async function storefrontPage() {
  if (!configured()) redirect("/sign-in");
  const user = await currentUser().catch(() => null);
  if (user) return { user, guest: false };
  if ((await marketSettings().catch(() => ({ guestCheckoutEnabled: false }))).guestCheckoutEnabled) return { user: null, guest: true };
  redirect("/sign-in");
}
