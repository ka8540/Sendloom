import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

import "@/app/globals.css";
import { CsrfFetchPatch } from "@/components/csrf-fetch-patch";
import { ErrorToastProvider } from "@/components/error-toast-provider";
import { ManualProvider } from "@/components/manual/ManualProvider";
import { PublicLoadScreen } from "@/components/public-load-screen";
import { loadScreenInitScript } from "@/lib/load-screen";
import { themeInitScript } from "@/lib/theme";

const interFont = Inter({
  subsets: ["latin"],
  variable: "--font-sans"
});

export const metadata: Metadata = {
  title: "Sendloom",
  description: "Professional sequence sending and outreach operations app"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={interFont.variable}
    >
      <head>
        <meta
          name="google-site-verification"
          content="KUCgQ2nKjx_X8bFPO3WZVRtl7I3rSIsqZ_LkrDVbviA"
        />
        <meta
          name="google-site-verification"
          content="swz_DSdFQJ-gVft6n0T7HlzmeVHa9-1daOCFQlJgf78"
        />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: loadScreenInitScript }} />
        <CsrfFetchPatch />
        <ErrorToastProvider>
          <ManualProvider>
            {children}
            <PublicLoadScreen />
            <SpeedInsights />
            <Analytics />
          </ManualProvider>
        </ErrorToastProvider>
      </body>
    </html>
  );
}
