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
    body: "Access may be suspended or terminated when required by law or when risk to the service appears."
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
      guideBody="This version keeps the substance of the original terms intact, but organizes the reading path around the questions operators usually have before they connect a sender or launch outreach."
      guideTitle="The quick read"
      highlights={highlights}
      lastUpdated={policy.lastUpdated}
      quickFacts={quickFacts}
      relatedHref="/privacy"
      relatedLabel="Read privacy policy"
      sectionBody="The sections below cover the major operating boundaries: lawful use, account responsibility, sender responsibility, product changes, suspension, and the standard service disclaimer."
      sectionEyebrow="Terms details"
      sectionTitle="How Sendloom can be used and where responsibility stays."
      sections={policy.sections}
      title={policy.title}
    />
  );
}
