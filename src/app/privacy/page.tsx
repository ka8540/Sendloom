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
      "To read automated delivery-status notifications (bounce messages from Mail Delivery Subsystem) so failed addresses can be marked Failed and excluded from future sends. Sendloom inspects only messages that look like automated delivery reports, keeps only structured failure details (recipient address, failure code, category), and never stores the message body.",
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
      "To protect the service against abuse, unauthorized access, and operational failures."
    ]
  },
  {
    id: "storage-and-retention",
    title: "How data is stored and retained",
    paragraphs: [
      "Sendloom stores account data, templates, campaign records, sender profile details, and imported audience data in the application database and related service infrastructure.",
      "We retain information for as long as it is needed to operate your account, comply with legal obligations, resolve disputes, and enforce our agreements."
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
    paragraphs: ["If you have privacy questions or data requests, contact Sendloom at ka8540@g.rit.edu."]
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
      lastUpdated="June 12, 2026"
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
