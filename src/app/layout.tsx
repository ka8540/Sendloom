import type { Metadata } from "next";
import { Bebas_Neue, Space_Grotesk } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";

import "@/app/globals.css";
import { ErrorToastProvider } from "@/components/error-toast-provider";
import { PublicLoadScreen } from "@/components/public-load-screen";
import { themeInitScript } from "@/lib/theme";

const loaderDisplayFont = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-loader-display"
});

const loaderBodyFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-loader-body"
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
      className={`${loaderDisplayFont.variable} ${loaderBodyFont.variable}`}
    >
      <head>
        <meta
          name="google-site-verification"
          content="KUCgQ2nKjx_X8bFPO3WZVRtl7I3rSIsqZ_LkrDVbviA"
        />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ErrorToastProvider>
          {children}
          <PublicLoadScreen />
          <SpeedInsights />
        </ErrorToastProvider>
      </body>
    </html>
  );
}
