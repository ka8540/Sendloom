import { env } from "@/lib/env";

const GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_LOGIN_SCOPES = [
  "openid",
  "email",
  "profile"
];

export const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_GMAIL_REPLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GOOGLE_CONNECT_SCOPES = [
  ...GOOGLE_LOGIN_SCOPES,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_GMAIL_REPLY_SCOPE
];

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
};

type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export function getGoogleRedirectUri(baseUrl = env.APP_BASE_URL) {
  return `${baseUrl}/api/auth/google/callback`;
}

export function getGoogleLoginRedirectUri(baseUrl = env.APP_BASE_URL) {
  return `${baseUrl}/api/auth/google/login/callback`;
}

export function assertGoogleOAuthConfigured() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
}

function buildGoogleUrl(args: {
  state: string;
  scopes: string[];
  redirectUri: string;
  loginHint?: string;
  accessType?: "online" | "offline";
  prompt?: string;
}) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    assertGoogleOAuthConfigured();
    throw new Error("Missing Google OAuth client ID.");
  }

  const url = new URL(GOOGLE_AUTH_BASE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", args.accessType ?? "online");
  if (args.prompt) {
    url.searchParams.set("prompt", args.prompt);
  }
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", args.scopes.join(" "));
  url.searchParams.set("state", args.state);

  if (args.loginHint) {
    url.searchParams.set("login_hint", args.loginHint);
  }

  return url;
}

export function buildGoogleConnectUrl(args: { state: string; loginHint?: string; redirectUri?: string }) {
  return buildGoogleUrl({
    state: args.state,
    loginHint: args.loginHint,
    scopes: GOOGLE_CONNECT_SCOPES,
    redirectUri: args.redirectUri ?? getGoogleRedirectUri(),
    accessType: "offline",
    prompt: "consent"
  });
}

export function buildGoogleLoginUrl(args: { state: string; loginHint?: string; redirectUri?: string }) {
  return buildGoogleUrl({
    state: args.state,
    loginHint: args.loginHint,
    scopes: GOOGLE_LOGIN_SCOPES,
    redirectUri: args.redirectUri ?? getGoogleLoginRedirectUri(),
    accessType: "online",
    prompt: "select_account"
  });
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    assertGoogleOAuthConfigured();
    throw new Error("Missing Google OAuth credentials.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const payload = (await response.json()) as GoogleTokenResponse & { error?: string; error_description?: string };

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Could not exchange Google authorization code.");
  }

  return payload;
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    assertGoogleOAuthConfigured();
    throw new Error("Missing Google OAuth credentials.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  const payload = (await response.json()) as GoogleTokenResponse & { error?: string; error_description?: string };

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Could not refresh Google access token.");
  }

  return payload;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = (await response.json()) as GoogleUserInfo & { error?: string; error_description?: string };

  if (!response.ok || !payload.email) {
    throw new Error(payload.error_description || payload.error || "Could not read Google profile.");
  }

  return payload;
}
