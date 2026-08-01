import { LegalPage } from "@/components/legal-page";

const highlights = [
  {
    label: "Google data",
    value: "Scoped use",
    detail: "Only used for sign-in, sender connection, and the product action you explicitly authorize."
  },
  {
    label: "Data sales",
    value: "None",
    detail: "Sendloom does not sell your personal information or Google user data."
  },
  {
    label: "Your control",
    value: "You decide",
    detail: "You can stop using the service, revoke Google access, or request deletion of account data."
  },
  {
    label: "Age policy",
    value: "18+ only",
    detail: "Sendloom does not knowingly collect data from users under 18. Ineligible accounts are blocked."
  }
] as const;

const quickFacts = [
  {
    title: "Account data",
    body: "Email address, sign-in method, and profile information needed to identify your account."
  },
  {
    title: "Operational data",
    body: "Templates, imports, campaigns, sender profiles, suppressions, and uploads created inside the app."
  },
  {
    title: "Limited sharing",
    body: "Used with infrastructure partners needed to run authentication, storage, email workflows, and hosting."
  },
  {
    title: "Deletion requests",
    body: "You can request account data deletion by emailing the contact listed on this page."
  },
  {
    title: "Eligibility enforcement",
    body: "Users must confirm they are 18 or older and accept policies before accessing product features. Unverified accounts are blocked."
  }
] as const;

const sections = [
  {
    id: "what-sendloom-does",
    title: "What Sendloom does",
    paragraphs: [
      "Sendloom helps users upload contact lists, create templates, connect a Gmail account, and run outreach sequences from a single dashboard."
    ]
  },
  {
    id: "information-we-collect",
    title: "Information we collect",
    bullets: [
      "Account information such as your email address and sign-in method.",
      "Google profile information such as your name, email address, and profile image when you sign in with Google.",
      "Connected Gmail account information needed to send email on your behalf after you explicitly authorize it.",
      "Templates, imports, uploaded files, mappings, sender profiles, campaigns, and suppression records that you create inside Sendloom.",
      "AI and automated-feature data such as prompts, template and email content, spam-check inputs and results, prospect or company information, source URLs, inferred email-format evidence, feature outputs, and related usage metadata.",
      "Usage and operational data needed to keep the service secure, reliable, and functioning correctly."
    ]
  },
  {
    id: "age-and-eligibility",
    title: "Age and eligibility",
    paragraphs: [
      "Sendloom is intended for users 18 years of age and older. We do not knowingly collect personal information from individuals under 18.",
      "Users who indicate they are under 18 are blocked from using the service. We do not collect exact date of birth; eligibility is confirmed through an adult certification step during onboarding.",
      "Accounts that have not completed eligibility verification within 30 days of creation may be purged, along with any associated temporary data."
    ]
  },
  {
    id: "google-user-data",
    title: "How we use Google user data",
    bullets: [
      "To sign you into your Sendloom account when you choose Google sign-in.",
      "To connect a Gmail sender that you choose and send emails from that account inside the product.",
      "To read replies to messages Sendloom sent for you, so sequences can stop following up after a response.",
      "To read automated delivery-status notifications (bounce messages from Mail Delivery Subsystem) so invalid addresses can be marked skipped and excluded from future sends. Sendloom inspects only messages that look like automated delivery reports, keeps only structured failure details (recipient address, failure code, category), and never stores the message body.",
      "To store the minimum Google account details needed to identify the connected sender and maintain your session."
    ],
    note:
      "Sendloom does not read, store, or index your other mailbox content. Sendloom does not use Google user data for advertising, does not sell Google user data, and does not use Google user data (including mailbox content) to train generalized AI or machine learning models or to discover new contacts."
  },
  {
    id: "how-we-use-information",
    title: "How we use your information",
    bullets: [
      "To create and manage your account.",
      "To authenticate you and maintain a secure login session.",
      "To let you create templates, upload lists, connect senders, and launch sequences.",
      "To process email delivery activity, track statuses, and apply suppressions.",
      "To provide AI-assisted and automated features, including content generation and refinement, classification, public-source analysis, email-format inference, and deliverability or spam-risk analysis.",
      "To protect the service against abuse, unauthorized access, and operational failures."
    ]
  },
  {
    id: "artificial-intelligence-and-automated-features",
    title: "Artificial Intelligence and Automated Features",
    paragraphs: [
      "Sendloom includes AI-assisted and automated features that may help generate, rewrite, analyze, classify, summarize, infer, or improve content and workflows. Depending on the feature, this may include email and template generation or refinement, automated deliverability or spam-risk analysis, company or domain resolution, role classification, public-source and source URL parsing, Discover email-format inference, generated or inferred email addresses, and related workflow suggestions.",
      "To provide these features, Sendloom may process information you provide, upload, import, connect, or generate through the service. This information may include account information, prompts, templates and email content, imported contact lists, prospect or company information, professional roles or titles, domains, public professional data, source URLs and public-source evidence, deliverability or spam-check inputs and results, feature outputs, and usage metadata.",
      "Some AI-assisted features may rely on third-party AI, model, web-search, or infrastructure providers acting as service providers or subprocessors. These providers may process inputs, outputs, and related metadata to provide, secure, support, and troubleshoot the features, subject to their applicable contractual and policy terms.",
      "Sendloom may log or retain limited prompts, outputs, related metadata, errors, and usage events as needed for security, debugging, abuse prevention, quality assurance, and operation of the service. Retention may vary based on the feature, operational need, account status, provider arrangements, and legal requirements.",
      "Do not submit sensitive personal information, confidential information, or data you are not authorized to use unless it is necessary for your use of the service and you are authorized to provide it.",
      "AI-generated or AI-assisted outputs may be inaccurate, incomplete, outdated, inappropriate, or unsuitable for your specific use. You are responsible for reviewing, editing, and approving any output before using it, sending it, or relying on it.",
      "For questions about privacy or how data is handled by AI-assisted features, contact Sendloom using the information at the end of this policy."
    ]
  },
  {
    id: "customer-content-and-contact-data",
    title: "Customer content and imported contact data",
    paragraphs: [
      "You control the contact, prospect, company, and outreach data you upload, import, connect, or otherwise make available through Sendloom. You are responsible for ensuring that you have the rights, permissions, and lawful basis needed to provide and use that data.",
      "Sendloom uses customer-provided content and contact data to provide the features you request and for related service operation, security, support, and abuse prevention."
    ]
  },
  {
    id: "discover-data",
    title: "Discover data",
    bullets: [
      "Search inputs you provide, such as company, role, domain, location, or LinkedIn and company information.",
      "Public professional and profile information returned by providers.",
      "Inferred email domain and pattern evidence.",
      "Generated or inferred email addresses.",
      "Your selections, exports, imports, and Add more actions.",
      "Timestamps and usage metadata needed for limits, safety, abuse prevention, and product reliability."
    ],
    note:
      "Generated emails may be inferred and may not be verified. Discover data is used to show results, enable exports and imports, support deduplication and caching where applicable, prevent abuse, and improve reliability. Please do not enter sensitive personal data into search fields unless it is necessary."
  },
  {
    id: "report-issue-data",
    title: "Report issue data",
    paragraphs: [
      "When you submit a manual issue report from a dashboard help/guide menu, Sendloom may collect the details below."
    ],
    bullets: [
      "Your written report description.",
      "The issue type or category you choose.",
      "The current route or page context.",
      "A timestamp for the report.",
      "Basic browser and platform diagnostic information, when collected.",
      "An authenticated user or account reference needed for support follow-up."
    ],
    note:
      "Please do not include passwords, API keys, OAuth tokens, private contact lists, confidential email bodies, or sensitive personal data in a report. Reports are used to diagnose bugs, improve product quality, handle support, and enforce safety and policy rules."
  },
  {
    id: "storage-and-retention",
    title: "How data is stored and retained",
    paragraphs: [
      "Sendloom stores account data, templates, campaign records, sender profile details, and imported audience data in the application database and related service infrastructure.",
      "We retain information for as long as it is needed to operate your account, comply with legal obligations, resolve disputes, and enforce our agreements.",
      "AI-feature inputs, outputs, and related operational metadata may be retained for the purposes described in this policy. Retention periods may depend on the feature, the type of data, account status, security and support needs, provider arrangements, and applicable law."
    ]
  },
  {
    id: "data-minimization",
    title: "Data minimization",
    paragraphs: [
      "Sendloom does not collect exact date of birth, unnecessary location data, device fingerprints, or behavioral analytics from users who have not completed eligibility verification.",
      "Incomplete or unverified onboarding records may be purged after 30 days if the user never completed eligibility and policy confirmation.",
      "Data needed for fraud prevention, security, or legal compliance is retained as required regardless of verification status."
    ]
  },
  {
    id: "sharing",
    title: "How data is shared",
    paragraphs: [
      "Sendloom shares data only with service providers and infrastructure partners needed to operate the app, such as authentication, hosting, database, storage, and email-related services.",
      "For AI-assisted features, Sendloom may share relevant inputs, outputs, and related metadata with third-party AI, model, web-search, and infrastructure providers that process the information on our behalf as service providers or subprocessors.",
      "We do not sell your personal information."
    ]
  },
  {
    id: "your-choices",
    title: "Your choices",
    bullets: [
      "You can stop using Sendloom at any time.",
      "You can disconnect Google access from your Google account permissions page.",
      "You can request deletion of your account data by contacting us."
    ]
  },
  {
    id: "security",
    title: "Security",
    paragraphs: [
      "We use reasonable administrative, technical, and organizational safeguards designed to protect your information. However, no system can be guaranteed to be completely secure."
    ]
  },
  {
    id: "legal-review-notice",
    title: "Legal review notice",
    paragraphs: [
      "This policy is provided for transparency and operational guidance. It should be reviewed by qualified legal counsel before reliance in any regulated context."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: [
      "If you have privacy questions, AI-data questions, or data requests, contact Sendloom at ka8540@g.rit.edu."
    ]
  }
] as const;

export default function PrivacyPage() {
  return (
    <LegalPage
      commitments={[
        "Google account access stays tied to the product action you choose.",
        "Operational data supports sending, tracking, and suppression workflows.",
        "You can revoke access or request deletion whenever you need to.",
        "No unnecessary data is collected from unverified or ineligible users."
      ]}
      description="This Privacy Policy explains what information Sendloom collects, how it is used, and what control you keep over the data attached to your account."
      eyebrow="Trust and transparency"
      guideBody="Everything below keeps the original policy substance, but the flow is organized so the answers are easier to scan before you log in, connect Google, or upload a list."
      guideTitle="The short read"
      highlights={highlights}
      lastUpdated="August 1, 2026"
      quickFacts={quickFacts}
      relatedHref="/terms"
      relatedLabel="Read terms"
      sectionBody="This policy is organized around the questions people usually ask first: what gets collected, what Google access is used for, where the data lives, and what choices you still have after you connect your account."
      sectionEyebrow="Privacy details"
      sectionTitle="What Sendloom collects, uses, and keeps."
      sections={sections}
      title="Privacy Policy"
    />
  );
}
