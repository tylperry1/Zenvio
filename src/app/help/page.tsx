import Link from "next/link";
export const metadata = { title: "Zenvio Help Center" };
const articles = [
  { title: "Publish a booking page", text: "Sign in, create an event type, set its duration, and review your weekly availability and time zone. Copy your booking page link from the workspace and test it before sharing." },
  { title: "Reschedule or cancel an appointment", text: "Open the management link in the booking confirmation. Choose another available time or cancel. Keep this private link safe because it controls the appointment." },
  { title: "Connect a calendar", text: "Open Settings and Calendar connections. Connect Google or Microsoft, approve the requested access, and choose the calendar. If connection is unavailable, contact Zenvio support." },
  { title: "Billing and included usage", text: "Individual is $29.99 monthly. Teams is $49.99 monthly with three seats, plus $9.99 per additional seat. Open Usage & Billing to see your plan and allowances. Add-ons and checkout are available when validated and activated." },
  { title: "Sign a document", text: "Open your secure signing invitation. Review the document, complete the required fields and confirm your signature. Sequential documents become available when it is your turn. Contact the sender if your link is unavailable." },
  { title: "Share a Smart Card", text: "Open Smart Cards, create your profile, choose the contact details to show, and publish it. Wallet & sharing provides a QR code and your permanent link. Wallet options show their activation status." },
  { title: "Get help from Zenvio", text: "Signed in? Open Zenvio support from the help button at the top of your workspace. No account yet? Use Chat with us on this page and we’ll reply in the chat and by email. Keep passwords, payment card details and private signing links out of messages." },
];
export default async function Help({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const input = (await searchParams).q;
  const query = typeof input === "string" ? input.slice(0, 100) : "";
  const found = articles.filter((article) => (article.title + " " + article.text).toLowerCase().includes(query.toLowerCase()));
  return <main className="ds-root" style={{ maxWidth: 880, margin: "auto", padding: "40px 20px" }}>
    <Link href="/">Zenvio</Link><h1>How can we help?</h1>
    <form><label className="ds-field">Search help<input name="q" type="search" defaultValue={query} maxLength={100} /></label><button className="ds-btn primary">Search</button></form>
    <p><Link href="/support">Chat with the Zenvio team</Link> · <Link href="/app/support">Support for signed-in customers</Link></p>
    {!found.length && <p>No matching articles. Try another search or send us a message.</p>}
    {found.map((article) => <article key={article.title} className="ds-panel" style={{ padding: 20, marginTop: 14 }}><h2>{article.title}</h2><p>{article.text}</p></article>)}
  </main>;
}
