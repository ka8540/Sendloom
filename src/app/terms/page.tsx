import { LegalPage } from "@/components/legal-page";

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
  }
] as const;

const sections = [
  {
    id: "use-of-service",
    title: "Use of the service",
    paragraphs: [
      "Sendloom is provided for lawful outreach, campaign operations, and related workflow management.",
      "You agree to use the service responsibly and in compliance with all applicable laws, regulations, and platform rules."
    ]
  },
  {
    id: "accounts",
    title: "Accounts",
    bullets: [
      "You are responsible for the accuracy of the account information you provide.",
      "You are responsible for activity that happens through your account.",
      "You must keep your login credentials and connected accounts secure."
    ]
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    bullets: [
      "You may not use Sendloom for spam, phishing, fraud, or unlawful messaging activity.",
      "You may not attempt to gain unauthorized access to the service or other user accounts.",
      "You may not use the service in a way that harms the platform, its infrastructure, or other users."
    ]
  },
  {
    id: "google-and-connected-email",
    title: "Google and connected email accounts",
    paragraphs: [
      "If you connect a Google account or Gmail sender, you authorize Sendloom to use the granted access only for the functionality you requested inside the product.",
      "You remain responsible for the messages sent from your connected account."
    ]
  },
  {
    id: "your-content-and-data",
    title: "Your content and data",
    paragraphs: [
      "You retain responsibility for the contact lists, templates, uploaded files, and other data you put into Sendloom.",
      "You represent that you have the right to use that content with the service."
    ]
  },
  {
    id: "availability-and-changes",
    title: "Availability and changes",
    paragraphs: [
      "Sendloom may evolve over time. Features may be modified, improved, or removed.",
      "We do not guarantee uninterrupted or error-free availability of the service."
    ]
  },
  {
    id: "termination",
    title: "Termination",
    paragraphs: [
      "We may suspend or terminate access to Sendloom if these terms are violated, if required by law, or if continued access creates risk to the service or other users."
    ]
  },
  {
    id: "disclaimer",
    title: "Disclaimer",
    paragraphs: [
      "Sendloom is provided on an \"as is\" and \"as available\" basis to the fullest extent permitted by law, without warranties of any kind, express or implied."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: ["If you have questions about these terms, contact Sendloom at ka8540@g.rit.edu."]
  }
] as const;

export default function TermsPage() {
  return (
    <LegalPage
      commitments={[
        "Use the service for lawful outreach and real workflow operations.",
        "Keep control of your login and any connected sender accounts.",
        "Expect platform protections when activity puts the service or other users at risk."
      ]}
      description="These Terms of Service govern your use of Sendloom and outline the responsibilities that come with account access, connected senders, and lawful outreach activity."
      eyebrow="Service boundaries"
      guideBody="This version keeps the substance of the original terms intact, but organizes the reading path around the questions operators usually have before they connect a sender or launch outreach."
      guideTitle="The quick read"
      highlights={highlights}
      lastUpdated="March 25, 2026"
      quickFacts={quickFacts}
      relatedHref="/privacy"
      relatedLabel="Read privacy policy"
      sectionBody="The sections below cover the major operating boundaries: lawful use, account responsibility, sender responsibility, product changes, suspension, and the standard service disclaimer."
      sectionEyebrow="Terms details"
      sectionTitle="How Sendloom can be used and where responsibility stays."
      sections={sections}
      title="Terms of Service"
    />
  );
}
