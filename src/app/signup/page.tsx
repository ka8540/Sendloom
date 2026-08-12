import { AuthPage } from "@/components/auth-page";
import { SignupForm } from "@/components/forms";
import { redirectAuthenticatedToWorkspace } from "@/lib/auth";

export default async function SignupPage() {
  await redirectAuthenticatedToWorkspace();

  return (
    <AuthPage
      minimal
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
