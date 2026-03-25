import type { Metadata } from "next";

import "@/app/globals.css";
import { themeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Sendloom",
  description: "Professional sequence sending and outreach operations app"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
