import { AuthPage } from "@/components/auth-page";
import { ForgotPasswordForm } from "@/components/forms";
import { redirectAuthenticatedToWorkspace } from "@/lib/auth";

export default async function ForgotPasswordPage() {
  await redirectAuthenticatedToWorkspace();

  return (
    <AuthPage
      minimal
      description="We'll verify your email before you can choose a new password."
      eyebrow="Account recovery"
      panelDescription="Enter your account email to receive a secure verification code."
      panelTitle="Reset your password"
      showProvider={false}
      switchHref="/login"
      switchLabel="Back to sign in"
      switchText="Remembered your password?"
      title="Reset your password"
    >
      <ForgotPasswordForm />
    </AuthPage>
  );
}
