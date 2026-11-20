import { DigitalIdentityNavigation } from "@/components/digital-identity-navigation";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DigitalIdentityNavigation />
      {children}
    </>
  );
}
