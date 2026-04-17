import { redirect } from "next/navigation";

import { AuthPage } from "@/components/auth-page";
import { SignupForm } from "@/components/forms";
import { getSession } from "@/lib/auth";

const features = [
  {
    title: "Spreadsheet imports",
    body: "Bring in CSV or XLSX lists, map the columns quickly, and keep the audience structured from the start."
  },
  {
    title: "Template control",
    body: "Write plain text, HTML, or JSON templates and preview the output before anything goes live."
  },
  {
    title: "Sender setup",
    body: "Connect Gmail when you are ready and keep the sender relationship tied to the right workspace."
  }
] as const;

const checklist = [
  "Create the account with Google or your email and password.",
  "Land in the workspace ready to import a list or connect a sender.",
  "Move from setup into a first campaign without switching tools."
] as const;

export default async function SignupPage() {
  const session = await getSession();

  if (session) {
    redirect("/workspace");
  }

  return (
    <AuthPage
      checklist={checklist}
      description="Set up Sendloom with Google or email and password, then move straight into imports, sender connection, templates, and the first campaign run from the same calm surface."
      eyebrow="New workspace"
      features={features}
      panelDescription="Choose Google or create an email and password account to open your workspace and start building."
      panelEyebrow="Get started"
      panelTitle="Create your account"
      storyBody="This is the same workflow the frontpage promises: one account, one dashboard, and a clear path from audience prep to launch once you get inside."
      storyTitle="Start clean, but with the whole flow already in view."
      switchHref="/login"
      switchLabel="Sign in"
      switchText="Already have an account?"
      title="Create an account and start with the full picture."
    >
      <SignupForm />
    </AuthPage>
  );
}
