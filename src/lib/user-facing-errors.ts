export const GOOGLE_LOGIN_USER_ERROR = "Couldn't sign you in with Google. Please try again.";
export const GOOGLE_LOGIN_CANCELED_ERROR = "Google sign-in was canceled. Please try again.";
export const GMAIL_CONNECT_USER_ERROR = "Couldn't connect Gmail right now. Please try again.";
export const GMAIL_CONNECT_CANCELED_ERROR = "Gmail connection was canceled. Please try again.";

function wasGoogleAuthCanceled(error?: string | null) {
  return String(error ?? "").trim().toLowerCase() === "access_denied";
}

export function getGoogleLoginUserError(error?: string | null) {
  return wasGoogleAuthCanceled(error) ? GOOGLE_LOGIN_CANCELED_ERROR : GOOGLE_LOGIN_USER_ERROR;
}

export function getGmailConnectUserError(error?: string | null) {
  return wasGoogleAuthCanceled(error) ? GMAIL_CONNECT_CANCELED_ERROR : GMAIL_CONNECT_USER_ERROR;
}
