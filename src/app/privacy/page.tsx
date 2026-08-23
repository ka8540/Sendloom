import { LegalPage } from "@/components/legal-page";
import { LEGAL_POLICIES } from "@/lib/legal-policies";

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

export default function PrivacyPage() {
  const policy = LEGAL_POLICIES.privacy;

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
      lastUpdated={policy.lastUpdated}
      quickFacts={quickFacts}
      relatedHref="/terms"
      relatedLabel="Read terms"
      sectionBody="This policy is organized around the questions people usually ask first: what gets collected, what Google access is used for, where the data lives, and what choices you still have after you connect your account."
      sectionEyebrow="Privacy details"
      sectionTitle="What Sendloom collects, uses, and keeps."
      sections={policy.sections}
      title={policy.title}
    />
  );
}
