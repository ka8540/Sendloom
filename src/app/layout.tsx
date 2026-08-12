import type { Metadata } from "next";
import { Bebas_Neue, Geist_Mono, Inter, Inter_Tight, Space_Grotesk } from "next/font/google";
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
 * Originally globals.css declared `Inter` as the root font but no Inter was
 * ever loaded, so every surface silently fell back to system-ui. These are the
 * real, loaded faces:
 *
 *   --font-sans     Inter        body copy, UI, buttons
 *   --font-display  Inter Tight  headlines, including the italic emphasis run
 *   --font-mono     Geist Mono   chapter numbers, metrics, tabular figures
 *
 * Inter Tight carries the display role because the headline treatment on this
 * site sets one emphasised phrase in true italic inside an otherwise upright
 * line. That needs a real italic cut of the same family; faux-oblique or a
 * second family would both read as a mistake.
 */
const bodyFont = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

const displayFont = Inter_Tight({
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display"
});

const monoFont = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono"
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
  /* Resolves the relative URLs below against the production origin. Without
     it Next emits Open Graph tags with relative paths, which crawlers and
     link unfurlers cannot follow, and logs a build-time warning. */
  metadataBase: new URL("https://sendloom.net"),
  title: {
    default: "Sendloom",
    template: "%s · Sendloom"
  },
  description:
    "Import a list, fill the missing emails, write once, and run a paced sequence from your own inbox. Delivery, replies and follow-ups tracked on a single screen.",
  applicationName: "Sendloom",
  /* No canonical here on purpose: metadata set on the root layout is inherited
     by every route that does not override it, so a canonical of "/" would make
     /privacy, /terms and the rest all declare themselves copies of the home
     page. Canonicals belong on the individual pages. */
  openGraph: {
    type: "website",
    siteName: "Sendloom",
    title: "Sendloom, outreach operations on one surface",
    description:
      "Import a list, fill the missing emails, write once, and run a paced sequence from your own inbox."
  },
  twitter: {
    card: "summary_large_image",
    title: "Sendloom, outreach operations on one surface",
    description:
      "Import a list, fill the missing emails, write once, and run a paced sequence from your own inbox."
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} ${loaderDisplayFont.variable} ${loaderBodyFont.variable}`}
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
