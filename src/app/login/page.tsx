import { redirect } from "next/navigation";

import { AuthPage } from "@/components/auth-page";
import { LoginForm } from "@/components/forms";
import { getSession } from "@/lib/auth";

export default async function LoginPage(props: { searchParams?: Promise<{ error?: string }> }) {
  const session = await getSession();
  const searchParams = await props.searchParams;

  if (session) {
    redirect("/workspace");
  }

  return (
    <AuthPage
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
