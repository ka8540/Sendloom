import { AuthPage } from "@/components/auth-page";
import { LoginForm } from "@/components/forms";
import { redirectAuthenticatedToWorkspace } from "@/lib/auth";

export default async function LoginPage(props: { searchParams?: Promise<{ error?: string }> }) {
  await redirectAuthenticatedToWorkspace();
  const searchParams = await props.searchParams;

  return (
    <AuthPage
      minimal
      description="Jump back into your workspace."
      eyebrow="Welcome back"
      panelDescription="Use Google or your email and password."
      panelTitle="Sign in to Sendloom"
      providerError={searchParams?.error}
      switchHref="/signup"
      switchLabel="Create an account"
      switchText="New to Sendloom?"
      title="Sign in"
    >
      <LoginForm />
    </AuthPage>
  );
}
