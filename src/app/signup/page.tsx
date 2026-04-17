import { redirect } from "next/navigation";

import { AuthPage } from "@/components/auth-page";
import { SignupForm } from "@/components/forms";
import { getSession } from "@/lib/auth";

export default async function SignupPage() {
  const session = await getSession();

  if (session) {
    redirect("/workspace");
  }

  return (
    <AuthPage
      description="Create your account and start fast."
      eyebrow="Get started"
      panelDescription="Choose Google or create an email and password account."
      panelTitle="Create your account"
      switchHref="/login"
      switchLabel="Sign in"
      switchText="Already have an account?"
      title="Create account"
    >
      <SignupForm />
    </AuthPage>
  );
}
