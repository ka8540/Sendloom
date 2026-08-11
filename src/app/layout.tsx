import type { Metadata } from "next";
import { Bebas_Neue, Geist, Geist_Mono, Instrument_Serif, Space_Grotesk } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

import "@/app/globals.css";
import { CsrfFetchPatch } from "@/components/csrf-fetch-patch";
import { ErrorToastProvider } from "@/components/error-toast-provider";
import { ManualProvider } from "@/components/manual/ManualProvider";
import { PublicLoadScreen } from "@/components/public-load-screen";
import { loadScreenInitScript } from "@/lib/load-screen";
import { themeInitScript } from "@/lib/theme";

/*
 * Type system.
 *
 * Before this, globals.css declared `Inter` as the root font but no Inter was
 * ever loaded, so every surface silently fell back to system-ui. The three
 * fonts below are the real, loaded system:
 *
 *   --font-sans     Geist            UI, body copy, buttons, labels
 *   --font-mono     Geist Mono       eyebrows, metrics, tabular figures
 *   --font-display  Instrument Serif hero + section display type
 *
 * `Instrument Serif` replaces the previous "Iowan Old Style" stack, which was
 * a macOS-only system serif — Windows and Linux visitors were silently served
 * Georgia, so the brand's most prominent type was inconsistent by platform.
 */
const sansFont = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

const monoFont = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono"
});

const displayFont = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display"
});

/*
 * Retained for the startup splash / loader, which is a deliberate brand moment
 * with its own condensed-display treatment. Not used by the marketing surface.
 */
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
  title: {
    default: "Sendloom — outreach operations, on one surface",
    template: "%s · Sendloom"
  },
  description:
    "Import a list, fill the missing emails, write once, and run a paced sequence from your own inbox — with delivery, replies and follow-ups tracked on a single screen.",
  applicationName: "Sendloom",
  openGraph: {
    type: "website",
    siteName: "Sendloom",
    title: "Sendloom — outreach operations, on one surface",
    description:
      "Import a list, fill the missing emails, write once, and run a paced sequence from your own inbox."
  },
  twitter: {
    card: "summary_large_image",
    title: "Sendloom — outreach operations, on one surface",
    description:
      "Import a list, fill the missing emails, write once, and run a paced sequence from your own inbox."
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sansFont.variable} ${monoFont.variable} ${displayFont.variable} ${loaderDisplayFont.variable} ${loaderBodyFont.variable}`}
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
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
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
