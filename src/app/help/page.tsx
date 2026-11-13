import Link from "next/link";
import {Icon,Logo} from "@/components/icons";
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
  return <main className="ds-root hc-page">
    <header className="hc-header"><Link href="/" aria-label="Zenvio home"><Logo/></Link><h1>How can we help?</h1><p>Clear answers for your next step with Zenvio.</p></header>
    <form className="hc-search"><label className="ds-field">Search help<input name="q" type="search" defaultValue={query} maxLength={100} /></label><button className="ds-btn primary">Search</button></form>
    <p><Link href="/support">Chat with the Zenvio team</Link> · <Link href="/app/support">Support for signed-in customers</Link></p>
    {!found.length && <p>No matching articles. Try another search or send us a message.</p>}
    <div className="hc-articles">{found.map((article) => <article key={article.title}><Icon name={["calendar","clock","plug","card","file","link","message"][articles.indexOf(article)]} size={23}/><h2>{article.title}</h2><p>{article.text}</p></article>)}</div>
  </main>;
}
