import { redirect } from "next/navigation";

import { AuthPage } from "@/components/auth-page";
import { LoginForm } from "@/components/forms";
import { getSession } from "@/lib/auth";

const features = [
  {
    title: "Connected senders",
    body: "Reopen the Gmail senders already tied to your workspace and keep delivery attached to the right account."
  },
  {
    title: "Flexible templates",
    body: "Pick back up with the plain text, HTML, or JSON drafts your team already uses."
  },
  {
    title: "Campaign visibility",
    body: "Recent runs, suppressions, and launch activity stay attached to the same account once you are back in."
  }
] as const;

const checklist = [
  "Sign in with Google if that is already how you connect your sender.",
  "Use email and password if you prefer a separate login path.",
  "Head straight back to the workspace after authentication completes."
] as const;

export default async function LoginPage(props: { searchParams?: Promise<{ error?: string }> }) {
  const session = await getSession();
  const searchParams = await props.searchParams;

  if (session) {
    redirect("/workspace");
  }

  return (
    <AuthPage
      checklist={checklist}
      description="Use Google or your email and password to reopen your dashboard, senders, templates, and live campaign status without dropping into a bare auth screen."
      eyebrow="Account access"
      features={features}
      panelDescription="Continue with Google or sign in with your email and password to get back to the workspace."
      panelEyebrow="Welcome back"
      panelTitle="Sign in to Sendloom"
      providerError={searchParams?.error}
      storyBody="The product flow stays intact after you sign back in, so imports, templates, sender setup, and launch work still feel like one continuous system instead of scattered tabs."
      storyTitle="Pick the sequence back up without losing context."
      switchHref="/signup"
      switchLabel="Create an account"
      switchText="New to Sendloom?"
      title="Sign in and get back to the work."
    >
      <LoginForm />
    </AuthPage>
  );
}
