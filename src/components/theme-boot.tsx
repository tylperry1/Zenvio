import { themeBootScript } from "@/lib/theme";

/** Server-rendered boot script for signed-in layouts — avoids a light flash before hydration. */
export function ThemeBootScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />;
}
