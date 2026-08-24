// Content-Security-Policy notes:
// - `script-src 'self' 'unsafe-inline'` is required for the small theme-init
//   script inlined in `src/app/layout.tsx` to avoid a flash of unstyled
//   content. A nonce-based CSP would require moving every Next.js inline
//   bootstrap script behind a server-issued nonce, which is invasive.
// - `style-src 'self' 'unsafe-inline'` is required for Next.js/CSS modules and
//   for inline `style="..."` attributes used in tracking-pixel markup.
// - `connect-src` permits the OpenAI Responses API and the Google OAuth/token
//   endpoints the app calls server-side; the wildcard `https:` for img-src
//   covers email previews and Google profile pictures.
// - `frame-src 'self' blob:` lets the in-app attachment preview render a PDF
//   that is fetched from the authenticated attachment route and turned into a
//   local `blob:` object URL. This only widens *nested* framing to same-origin
//   blobs; `frame-ancestors 'none'` still blocks the app itself from being
//   embedded, and `object-src 'none'` is left untouched.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https://pub-9400568eaa014d6cbfd93f37668641cd.r2.dev",
  "font-src 'self' data:",
  "connect-src 'self' https://api.openai.com https://oauth2.googleapis.com https://openidconnect.googleapis.com https://accounts.google.com https://www.googleapis.com"
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: csp }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
