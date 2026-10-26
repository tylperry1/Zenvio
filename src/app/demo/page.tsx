import { Workspace } from "@/components/workspace";
export const metadata = {
  title: "Explore the workspace",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <Workspace demo />;
}
