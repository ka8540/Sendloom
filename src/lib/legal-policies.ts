export type LegalPolicyId = "terms" | "privacy" | "abuse";
export type LegalPolicyPath = "/terms" | "/privacy" | "/abuse";

export type LegalPolicySection = {
  readonly id: string;
  readonly title: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
  readonly note?: string;
};

export type LegalPolicy = {
  readonly id: LegalPolicyId;
  readonly title: string;
  readonly path: LegalPolicyPath;
  /** Immutable release identifier: YYYY-MM-DD, then YYYY-MM-DD-v2 if needed. */
  readonly version: string;
  /** Explicit delivery group: policies with the same value share one account email. */
  readonly releaseGroup: string;
  readonly lastUpdated: string;
  /** Intentionally authored by the developer; never generated automatically. */
  readonly changeSummary: readonly string[];
  /** The policy text rendered by the public page and covered by its content hash. */
  readonly sections: readonly LegalPolicySection[];
};

const termsSections = [
  {
    id: "use-of-service",
    title: "Use of the service",
    paragraphs: [
      "Sendloom is provided for lawful outreach, campaign operations, and related workflow management.",
      "You agree to use the service responsibly and in compliance with all applicable laws, regulations, and platform rules."
    ]
  },
  {
    id: "eligibility",
    title: "Eligibility",
    bullets: [
      "You must be 18 years of age or older to create an account or use Sendloom.",
      "By creating an account, you represent that you meet this age requirement.",
      "Sendloom is a business outreach tool and is not intended for children, teens, or minors."
    ]
  },
  {
    id: "accounts",
    title: "Accounts",
    bullets: [
      "You are responsible for the accuracy of the account information you provide.",
      "You are responsible for activity that happens through your account.",
      "You must maintain access to and protect the email account associated with Sendloom, along with your login credentials and connected accounts.",
      "You must not share your password, verification codes, or other account credentials with anyone."
    ]
  },
  {
    id: "account-verification",
    title: "Account verification",
    paragraphs: [
      "Sendloom requires verification of the account email before completing email-and-password registration and may require verification during other security-sensitive account actions. Verification may include a time-limited code sent to the account email.",
      "Google sign-in uses Google's authentication and verified-email flow; it does not require Sendloom's email-and-password registration code."
    ]
  },
  {
    id: "password-security",
    title: "Password security",
    paragraphs: [
      "Sendloom may require additional verification through the account email before a password is established or changed, including when an account originally created with Google authentication later adds a password. This verification is used for the security-sensitive password action and does not mean that every normal login requires a verification code."
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
    id: "recipient-data",
    title: "Recipient data and outreach rules",
    bullets: [
      "You must have a lawful basis for the contact lists you upload and use with Sendloom.",
      "You must honor unsubscribe and opt-out requests from recipients.",
      "You must not use Sendloom to contact individuals known or believed to be minors.",
      "Sendloom may restrict or suspend accounts that violate these outreach rules."
    ]
  },
  {
    id: "discover-and-inferred-contacts",
    title: "Discover and inferred contact information",
    bullets: [
      "Discover is provided to help you organize lawful business outreach.",
      "Discover results may include inferred or generated email addresses based on public evidence, company domains, naming patterns, and provider data.",
      "Sendloom does not guarantee that inferred email addresses are accurate, verified, deliverable, current, or appropriate for every use.",
      "You are responsible for verifying results and deciding whether outreach is lawful and appropriate before you send.",
      "You must comply with applicable email, privacy, anti-spam, employment, platform, and data-protection laws.",
      "You may not use Discover for harassment, spam, deception, unlawful profiling, sensitive targeting, or otherwise prohibited outreach.",
      "Sendloom may limit, suspend, or restrict Discover access in response to abuse or policy violations.",
      "Manual reports and issue reports are for product support and safety review, not emergency support."
    ],
    note: "This section is product policy information and not legal advice."
  },
  {
    id: "ai-assisted-features",
    title: "AI-Assisted Features",
    paragraphs: [
      "Sendloom may provide AI-assisted and automated features, including tools that generate or refine outreach content, analyze deliverability or spam risk, resolve company or domain information, classify professional roles, search for or parse public-source URLs, infer Discover email formats, generate inferred email addresses, or suggest workflow improvements.",
      "AI-assisted outputs are provided for convenience and productivity only. They are not legal, compliance, employment, financial, or other professional advice and may be inaccurate, incomplete, outdated, inappropriate, or unsuitable for your use."
    ],
    bullets: [
      "You must review, edit as needed, and approve all AI-assisted outputs before using or sending them. You are solely responsible for the content, communications, contact lists, imported data, and decisions you make through the service.",
      "You are responsible for ensuring that your emails, outreach practices, and use of Sendloom comply with applicable anti-spam, privacy, consent, employment, platform, email-provider, and other legal or third-party requirements.",
      "You represent that you have the rights, permissions, and lawful basis needed to upload, import, or otherwise use contact, prospect, company, and other data in Sendloom.",
      "You may not use AI-assisted features to create or facilitate deceptive, unlawful, discriminatory, harmful, infringing, impersonating, spammy, or misleading content or conduct.",
      "You may not misrepresent AI-generated or automated communications as human-generated where disclosure is required by applicable law or third-party rules.",
      "Third-party AI, model, web-search, or infrastructure providers may process inputs, outputs, and related metadata on Sendloom's behalf as service providers or subprocessors.",
      "Sendloom may suspend, restrict, or terminate access when AI-assisted or outreach features are misused or create risk to the service, its users, recipients, or third parties."
    ],
    note:
      "Sendloom does not guarantee deliverability, response rates, inferred email-address or email-format accuracy, data availability or currency, spam-check scores or risk assessments, source parsing, AI outputs, or legal and compliance outcomes."
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
    id: "policy-changes-and-notices",
    title: "Policy changes and notices",
    paragraphs: [
      "Sendloom may update these Terms, the Privacy Policy, or the Anti-Abuse Policy as the service and its practices change.",
      "For relevant or material updates, Sendloom may send an account or service notice to your account email. A notice may identify the policy that changed, the update date, a concise summary of the changes, and a link to the updated policy.",
      "When multiple Sendloom policies are updated as part of the same release, Sendloom may combine those changes into a single account or service notice while providing separate links to each updated policy."
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
    id: "legal-review-notice",
    title: "Legal review notice",
    paragraphs: [
      "These terms are provided for transparency and operational guidance. They should be reviewed by qualified legal counsel before reliance in any regulated context."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: ["If you have questions about these terms, contact Sendloom at ka8540@g.rit.edu."]
  }
] as const satisfies readonly LegalPolicySection[];

const privacySections = [
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
      "Email-verification data, including the account email address, temporary verification or challenge information, and security and rate-limit metadata needed to confirm email control and prevent abuse.",
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
      "To verify control of the account email during email-and-password registration and security-sensitive password actions.",
      "To deliver verification, security, and important policy-update communications to your account email.",
      "To let you create templates, upload lists, connect senders, and launch sequences.",
      "To process email delivery activity, track statuses, and apply suppressions.",
      "To provide AI-assisted and automated features, including content generation and refinement, classification, public-source analysis, email-format inference, and deliverability or spam-risk analysis.",
      "To protect the service against abuse, unauthorized access, and operational failures."
    ]
  },
  {
    id: "account-verification-and-password-security",
    title: "Account verification and password security",
    paragraphs: [
      "When you register with an email address and password, Sendloom uses the account email and a temporary verification challenge to confirm that you control that address before the account is created. Google sign-in instead relies on Google's authentication and verified-email flow.",
      "Sendloom may also require account-email verification when you set or change a password, including when a Google-based account later adds a password.",
      "Verification challenges are temporary. Sendloom uses reasonable expiration, attempt, resend, and rate controls designed to reduce repeated, unauthorized, or abusive verification activity."
    ]
  },
  {
    id: "account-service-email",
    title: "Account and service email delivery",
    paragraphs: [
      "Sendloom uses a transactional email service provider, currently Resend, to deliver operational account and service communications. These communications may include account verification codes, password or security verification messages, and important policy-update notices.",
      "To deliver these messages, the provider may process your account email address, the message content, and delivery metadata needed to route, deliver, secure, and troubleshoot the email.",
      "Account and service communications are sent to the email address associated with your Sendloom account. They are not sent through a Gmail sender account that you connect for outreach."
    ]
  },
  {
    id: "policy-update-notices",
    title: "Policy-update notices and delivery records",
    paragraphs: [
      "Sendloom may use your account email to notify you when its Terms of Service, Privacy Policy, or Anti-Abuse Policy is materially updated. A notice may include the policy name, the update date, a concise change summary, and a link to the current policy.",
      "Sendloom may retain limited operational records associated with policy-notice delivery, such as delivery status, attempt or retry information, a provider message identifier, and timestamps. These records are used for delivery reliability, auditing, duplicate prevention, troubleshooting, and retry handling; the recipient delivery record does not store a separate full copy of the email.",
      "When several Sendloom policies are updated together, their change summaries and review links may be included in one combined account-service email rather than separate emails for each policy."
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
      "Temporary account-verification challenges are retained only as needed to complete or protect the verification process. Limited policy-notice delivery records may be retained for reliability, auditing, duplicate prevention, retry handling, and troubleshooting.",
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
      "Sendloom shares data only with service providers and infrastructure partners needed to operate the app, such as authentication, hosting, database, storage, and transactional email delivery services. The current provider for account and service email delivery is Resend.",
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
      "We use reasonable administrative, technical, and organizational safeguards designed to protect your information. These safeguards include account-email verification for certain registration and password actions and controls designed to limit repeated verification abuse. However, no system can be guaranteed to be completely secure."
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
] as const satisfies readonly LegalPolicySection[];

const abuseSections = [
  {
    id: "prohibited-uses",
    title: "Prohibited uses",
    bullets: [
      "Spam: unsolicited bulk messaging, deceptive subject lines, or misleading sender identity.",
      "Harassment: threats, intimidation, stalking, or targeted abuse of any individual.",
      "Illegal outreach: messaging that violates applicable law in any jurisdiction.",
      "Contacting minors: using Sendloom to reach individuals known or believed to be under 18.",
      "Phishing and impersonation: pretending to be another person, company, or organization to deceive recipients.",
      "Credential theft: attempting to collect passwords, security codes, or personal credentials through outreach.",
      "Malware distribution: including links to or attachments containing viruses, trojans, ransomware, or other harmful software.",
      "Hate speech and threats: promoting violence, discrimination, or hatred against any group.",
      "Sexual content involving minors: absolutely prohibited, reported to authorities.",
      "Selling or sourcing child data: collecting, purchasing, or using data about individuals under 18.",
      "Unlawful contact scraping: using contacts obtained through scraping, hacking, or other unauthorized means.",
      "Suppression bypass: circumventing unsubscribe requests, suppression lists, or opt-out mechanisms.",
      "Google policy violations: any use that violates Google's Gmail API Terms of Service or Acceptable Use Policy.",
      "Fraudulent or automated account creation: creating accounts through deceptive or automated means, or creating an account to evade a prior suspension, restriction, or other enforcement action.",
      "Verification abuse: attempting to bypass email verification, brute-force a verification code, use another person's verification code without authorization, or circumvent verification attempt limits, resend controls, or rate limits.",
      "Credential attacks: using credential stuffing or other unauthorized methods to access or take over an account.",
      "Security-control interference: probing, disabling, evading, or otherwise interfering with Sendloom authentication or account-security controls."
    ]
  },
  {
    id: "enforcement",
    title: "Enforcement",
    paragraphs: [
      "When Sendloom identifies a violation, the account may be restricted, suspended, or permanently terminated depending on severity.",
      "Sendloom reserves the right to restrict first and investigate second when the potential for harm is immediate."
    ]
  },
  {
    id: "reporting",
    title: "Reporting abuse",
    paragraphs: [
      "Report abuse or misuse through the support contact listed on this site.",
      "If you have received unwanted communication sent through Sendloom, please include the sender email and message details in your report."
    ]
  },
  {
    id: "cooperation",
    title: "Cooperation with authorities",
    paragraphs: [
      "Sendloom will cooperate with law enforcement authorities when legally required and when activity on the platform poses a credible risk of harm."
    ]
  },
  {
    id: "policy-updates",
    title: "Policy updates",
    paragraphs: [
      "When the Anti-Abuse Policy is updated alongside other Sendloom policies, the changes may be communicated through one combined account-service notice with a separate link to this policy."
    ]
  },
  {
    id: "review-notice",
    title: "Legal review notice",
    paragraphs: [
      "This policy is provided for transparency and operational guidance. It should be reviewed by qualified legal counsel before reliance in any regulated context."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: ["If you have questions about this policy, contact Sendloom at ka8540@g.rit.edu."]
  }
] as const satisfies readonly LegalPolicySection[];

export const LEGAL_POLICIES = {
  terms: {
    id: "terms",
    title: "Terms of Service",
    path: "/terms",
    version: "2026-08-23-v2",
    releaseGroup: "2026-08-23-v2-combined-policy-notice",
    lastUpdated: "August 23, 2026",
    changeSummary: [
      "Clarified that related Sendloom policy updates may be combined into a single account or service notice."
    ],
    sections: termsSections
  },
  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    path: "/privacy",
    version: "2026-08-23-v2",
    releaseGroup: "2026-08-23-v2-combined-policy-notice",
    lastUpdated: "August 23, 2026",
    changeSummary: [
      "Clarified that related policy updates may be grouped into one account-service email with separate review links."
    ],
    sections: privacySections
  },
  abuse: {
    id: "abuse",
    title: "Anti-Abuse Policy",
    path: "/abuse",
    version: "2026-08-23-v2",
    releaseGroup: "2026-08-23-v2-combined-policy-notice",
    lastUpdated: "August 23, 2026",
    changeSummary: [
      "Clarified how Anti-Abuse Policy updates may be included in a combined Sendloom policy notice."
    ],
    sections: abuseSections
  }
} as const satisfies Record<LegalPolicyId, LegalPolicy>;

export const LEGAL_POLICY_LIST = Object.values(LEGAL_POLICIES) as readonly LegalPolicy[];

const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}(?:-v(?:[2-9]|[1-9]\d+))?$/;

function isValidPolicyVersion(version: string) {
  if (!VERSION_PATTERN.test(version)) return false;
  const [year, month, day] = version.slice(0, 10).split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function validateLegalPolicyRegistry(policies: readonly LegalPolicy[] = LEGAL_POLICY_LIST) {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const policy of policies) {
    if (seenIds.has(policy.id)) errors.push(`Duplicate legal policy id: ${policy.id}`);
    if (seenPaths.has(policy.path)) errors.push(`Duplicate legal policy path: ${policy.path}`);
    seenIds.add(policy.id);
    seenPaths.add(policy.path);

    if (!isValidPolicyVersion(policy.version)) errors.push(`Invalid version for ${policy.id}: ${policy.version}`);
    if (!policy.releaseGroup.trim()) errors.push(`Missing releaseGroup for ${policy.id}`);
    if (!policy.title.trim()) errors.push(`Missing title for ${policy.id}`);
    if (!policy.lastUpdated.trim()) errors.push(`Missing lastUpdated for ${policy.id}`);
    if (policy.sections.length === 0) errors.push(`Missing policy content for ${policy.id}`);
    if (policy.changeSummary.some((item) => !item.trim())) errors.push(`Empty change summary item for ${policy.id}`);
  }

  return errors;
}
