import { LegalPage } from "@/components/legal-page";
import { LEGAL_POLICIES } from "@/lib/legal-policies";

const highlights = [
  {
    label: "Use",
    value: "Lawful only",
    detail: "The service is for responsible outreach and workflow operations, not spam, fraud, or abuse."
  },
  {
    label: "Connected senders",
    value: "Your responsibility",
    detail: "You remain responsible for the messages sent from the Gmail account you connect."
  },
  {
    label: "Enforcement",
    value: "Access can end",
    detail: "Accounts can be suspended or terminated when terms are violated or risk is created."
  },
  {
    label: "Your choice",
    value: "Delete account",
    detail: "Eligible account holders can choose account-only or private-data deletion in Account Settings."
  },
  {
    label: "Age",
    value: "18+ only",
    detail: "Sendloom is for adults conducting lawful business outreach. Users must be 18 or older."
  }
] as const;

const quickFacts = [
  {
    title: "Account ownership",
    body: "You are responsible for account accuracy, credential security, and activity through your login."
  },
  {
    title: "Acceptable use",
    body: "No spam, phishing, fraud, unauthorized access attempts, or behavior that harms the platform."
  },
  {
    title: "Service changes",
    body: "Features may evolve, improve, or be removed as the product changes over time."
  },
  {
    title: "Termination",
    body: "You can choose deletion in Account Settings. Sendloom may separately restrict or terminate access for enforcement reasons."
  },
  {
    title: "Age requirement",
    body: "You must be 18 or older to use Sendloom. The service is not intended for minors."
  }
] as const;

export default function TermsPage() {
  const policy = LEGAL_POLICIES.terms;

  return (
    <LegalPage
      commitments={[
        "Use the service for lawful outreach and real workflow operations.",
        "Keep control of your login and any connected sender accounts.",
        "Expect platform protections when activity puts the service or other users at risk.",
        "Comply with the Anti-Abuse Policy when conducting outreach."
      ]}
      description="These Terms of Service govern your use of Sendloom and outline the responsibilities that come with account access, connected senders, and lawful outreach activity."
      eyebrow="Service boundaries"
      guideBody="Start with account responsibility and lawful outreach, then review the deletion choices and enforcement rules that affect access."
      guideTitle="The quick read"
      highlights={highlights}
      lastUpdated={policy.lastUpdated}
      quickFacts={quickFacts}
      relatedHref="/privacy"
      relatedLabel="Read privacy policy"
      sectionBody="The sections below cover lawful use, account and sender responsibility, deletion choices, enforcement, product changes, and the service disclaimer."
      sectionEyebrow="Terms details"
      sectionTitle="How Sendloom can be used and where responsibility stays."
      sections={policy.sections}
      title={policy.title}
    />
  );
}
