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
    value: "Two deletion choices",
    detail: "Account Settings offers account-only deletion or a reviewed request to remove eligible private outreach data."
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
    body: "Eligible accounts can choose a deletion scope in Account Settings. Full private-data deletion is reviewed before processing."
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
        "Eligible account holders can choose deletion options in Account Settings.",
        "No unnecessary data is collected from unverified or ineligible users."
      ]}
      description="This Privacy Policy explains what information Sendloom collects, how it is used, and what control you keep over the data attached to your account."
      eyebrow="Trust and transparency"
      guideBody="Review what Sendloom collects and uses, then see what each deletion choice removes and which limited records may remain."
      guideTitle="The short read"
      highlights={highlights}
      lastUpdated={policy.lastUpdated}
      quickFacts={quickFacts}
      relatedHref="/terms"
      relatedLabel="Read terms"
      sectionBody="This policy covers what Sendloom collects, how connected data is used, the two deletion choices, and which records may remain."
      sectionEyebrow="Privacy details"
      sectionTitle="What Sendloom collects, uses, and keeps."
      sections={policy.sections}
      title={policy.title}
    />
  );
}
