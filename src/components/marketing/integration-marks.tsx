/*
 * Integration marks.
 *
 * These are the current official brand marks, inlined as multi-colour SVG.
 *
 * The previous implementation pulled each mark from cdn.simpleicons.org and
 * used it as a CSS mask, which flattened every logo to a single grey
 * silhouette. A masked Gmail envelope and a masked Drive triangle read as
 * generic shapes rather than the products people recognise, and each one cost
 * a third-party request on first paint.
 *
 * Inlining them fixes all of that: real brand colour, no network dependency,
 * no layout shift, and both themes served by one asset.
 *
 * Geometry is the vendor artwork, so the marks stay trademark-accurate.
 */

type MarkProps = {
  className?: string;
};

export type Integration = {
  Mark: (props: MarkProps) => React.ReactElement;
  name: string;
  slug: string;
};

function GmailMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4caf50"
        d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"
      />
      <path
        fill="#1e88e5"
        d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"
      />
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
      <path
        fill="#c62828"
        d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.923,8,3,9.923,3,12.298z"
      />
      <path
        fill="#fbc02d"
        d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0C43.077,8,45,9.923,45,12.298z"
      />
    </svg>
  );
}

function GoogleMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#ffc107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#ff3d00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4caf50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976d2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );
}

function GoogleDriveMark({ className }: MarkProps) {
  /* Vendor artwork uses an 87.3 x 78 canvas rather than a square one. */
  return (
    <svg className={className} viewBox="0 0 87.3 78" aria-hidden="true" focusable="false">
      <path
        fill="#0066da"
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
      />
      <path
        fill="#00ac47"
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.79 1.35-1.2 2.9-1.2 4.5h27.5z"
      />
      <path
        fill="#ea4335"
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
      />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path
        fill="#ffba00"
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.6-.4-3.15-1.2-4.5z"
      />
    </svg>
  );
}

function GoogleSheetsMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#43a047"
        d="M37,45H11c-1.657,0-3-1.343-3-3V6c0-1.657,1.343-3,3-3h19l10,10v29C40,43.657,38.657,45,37,45z"
      />
      <path fill="#c8e6c9" d="M40,13H30V3L40,13z" />
      <path fill="#2e7d32" d="M30,13l10,10V13H30z" />
      <path
        fill="#e8f5e9"
        d="M31,23H17h-2v2v2v2v2v2v2v2h2h14h2v-2v-2v-2v-2v-2v-2v-2H31z M17,25h4v2h-4V25z M17,29h4v2h-4V29z M17,33h4v2h-4V33z M31,35h-8v-2h8V35z M31,31h-8v-2h8V31z M31,27h-8v-2h8V27z"
      />
    </svg>
  );
}

function ExcelMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#169154" d="M29,6H15.744C14.781,6,14,6.781,14,7.744v7.259h15V6z" />
      <path fill="#18482a" d="M14,33.054v7.202C14,41.219,14.781,42,15.743,42H29v-8.946H14z" />
      <path fill="#0c8045" d="M14 15.003H29V24.005000000000003H14z" />
      <path fill="#17472a" d="M14 24.005H29V33.055H14z" />
      <path
        fill="#29c27f"
        d="M42.256,6H29v9.003h14V7.744C43,6.781,42.219,6,41.256,6H42.256z"
      />
      <path fill="#27663f" d="M29,33.054V42h12.257C42.219,42,43,41.219,43,40.256v-7.202H29z" />
      <path fill="#19ac65" d="M29 15.003H43V24.005000000000003H29z" />
      <path fill="#129652" d="M29 24.005H43V33.055H29z" />
      <path
        fill="#0c7238"
        d="M22.319,34H5.681C4.753,34,4,33.247,4,32.319V15.681C4,14.753,4.753,14,5.681,14h16.638C23.247,14,24,14.753,24,15.681v16.638C24,33.247,23.247,34,22.319,34z"
      />
      <path
        fill="#fff"
        d="M9.807 19L12.193 19 14.129 22.754 16.175 19 18.404 19 15.333 24 18.474 29 16.123 29 14.013 25.246 11.774 29 9.526 29 12.719 24z"
      />
    </svg>
  );
}

/*
 * Real integrations Sendloom supports, not customer logos. A "trusted by" wall
 * of invented company names on a product without public customers would be a
 * fabrication, so the strip answers a question a visitor actually has: does
 * this work with what I already use?
 */
export const integrations: readonly Integration[] = [
  { Mark: GmailMark, name: "Gmail", slug: "gmail" },
  { Mark: GoogleMark, name: "Google Workspace", slug: "google-workspace" },
  { Mark: GoogleSheetsMark, name: "Google Sheets", slug: "google-sheets" },
  { Mark: ExcelMark, name: "Microsoft Excel", slug: "microsoft-excel" },
  { Mark: GoogleDriveMark, name: "Google Drive", slug: "google-drive" }
] as const;
