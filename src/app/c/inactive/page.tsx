import Link from "next/link";
import { Logo } from "@/components/icons";
export const metadata = { title: "Card not active", robots: { index: false, follow: false } };
export default function Page() {
  return (
    <main className="sc-public sc-inactive">
      <Logo />
      <div className="sc-public-card">
        <h1>This card isn’t active</h1>
        <p>The owner has deactivated this card or hasn’t linked it to a profile yet. If you were expecting contact details, ask them to share their link directly.</p>
        <Link href="/">About Zenvio</Link>
      </div>
    </main>
  );
}
