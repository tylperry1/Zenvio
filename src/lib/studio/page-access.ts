import { currentUser } from "./shopper";
import { configured } from "../server";

/** Storefront pages are public; reports whether the visitor is a guest. */
export async function storefrontPage() {
  if (!configured()) return { user: null, guest: true };
  const user = await currentUser().catch(() => null);
  return { user, guest: !user };
}
