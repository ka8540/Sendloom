"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, KeyRound, Loader2, Mail, Plus, Trash2, UserRound, UserRoundX } from "lucide-react";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { AccountDeletionSection } from "@/components/account/account-deletion-section";
import { AccountSettingsSection } from "@/components/account/account-settings-section";
import { useErrorToast } from "@/components/error-toast-provider";
import { LocalDateTime } from "@/components/local-date-time";
import {
  OtpVerificationForm,
  type OtpChallengeMetadata
} from "@/components/otp-verification-form";
import { WorkspacePageHeader } from "@/components/workspace-page-header";
import {
  type AccountOverview,
  type AccountSenderView,
  ACCOUNT_TYPE_LABELS,
  MIN_PASSWORD_LENGTH,
  PASSWORD_UPDATE_ERROR_MESSAGE,
  PASSWORD_UPDATE_SUCCESS_MESSAGE,
  PROFILE_PHOTO_INVALID_TYPE_MESSAGE,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_REMOVE_ERROR_MESSAGE,
  PROFILE_PHOTO_TOO_LARGE_MESSAGE,
  PROFILE_PHOTO_UPDATE_ERROR_MESSAGE,
  describeSenderRemoval,
  validatePasswordChange
} from "@/lib/account";
import styles from "./account-dashboard.module.css";

const SENDER_REMOVE_GENERIC_ERROR = "We couldn't remove this sender. Please try again.";
const ACCOUNT_LOAD_ERROR = "We couldn't refresh your account details. Reload the page to try again.";
const PROFILE_PHOTO_SUCCESS_MESSAGE = "Profile photo updated.";

function reconnectHref(fromEmail: string) {
  return `/api/auth/google/connect?email=${encodeURIComponent(fromEmail)}&next=${encodeURIComponent("/account")}`;
}

function accountInitial(profile: { name: string | null; email: string }) {
  const source = profile.name?.trim() || profile.email;
  return source.charAt(0).toUpperCase();
}

export function AccountDashboard({
  initialData,
  connectGmailHref
}: {
  initialData: AccountOverview;
  connectGmailHref: string;
}) {
  const router = useRouter();
  const { showError, showSuccess } = useErrorToast();

  const [overview, setOverview] = useState<AccountOverview>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pendingRemoval, setPendingRemoval] = useState<AccountSenderView | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [pendingPhotoRemoval, setPendingPhotoRemoval] = useState(false);
  const [photoRemoving, setPhotoRemoving] = useState(false);

  const hasPassword = overview.profile.hasPassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordChallenge, setPasswordChallenge] = useState<OtpChallengeMetadata | null>(null);
  const [activeSection, setActiveSection] = useState<"information" | "senders" | "password" | "deletion" | null>("information");

  const currentPasswordId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const passwordErrorId = useId();
  const photoInputId = useId();
  const photoErrorId = useId();

  // Surface the Gmail-connect outcome once we return from the OAuth kickoff,
  // then strip the query params so a reload doesn't re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("gmail");
    const gmailError = params.get("gmail_error");

    if (connected === "connected") {
      showSuccess("Gmail account connected.");
    } else if (gmailError) {
      showError(gmailError);
    }

    if (connected || gmailError) {
      params.delete("gmail");
      params.delete("gmail_error");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, [showError, showSuccess]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/account", { headers: { Accept: "application/json" } });
      if (!res.ok) {
        setLoadError(ACCOUNT_LOAD_ERROR);
        return;
      }
      const data = (await res.json()) as AccountOverview;
      setOverview(data);
      setLoadError(null);
    } catch {
      setLoadError(ACCOUNT_LOAD_ERROR);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const confirmRemoval = useCallback(async () => {
    if (!pendingRemoval || removing) {
      return;
    }

    setRemoving(true);
    setRemoveError(null);

    const target = pendingRemoval;
    try {
      const res = await fetch(`/api/account/senders/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setRemoveError(typeof data?.error === "string" ? data.error : SENDER_REMOVE_GENERIC_ERROR);
        return;
      }

      setPendingRemoval(null);
      showSuccess(`${target.fromEmail} was removed.`);
      await refresh();
    } catch {
      setRemoveError(SENDER_REMOVE_GENERIC_ERROR);
    } finally {
      setRemoving(false);
    }
  }, [pendingRemoval, removing, refresh, showSuccess]);

  const submitPassword = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (savingPassword) {
        return;
      }

      const validation = validatePasswordChange({ hasPassword, currentPassword, newPassword, confirmPassword });
      if (!validation.ok) {
        setPasswordError(validation.message);
        return;
      }

      setSavingPassword(true);
      setPasswordError(null);
      try {
        const res = await fetch("/api/account/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: hasPassword ? currentPassword : undefined,
            newPassword,
            confirmPassword
          })
        });
        const data = (await res.json().catch(() => null)) as
          | (Partial<OtpChallengeMetadata> & {
              error?: string;
              requiresVerification?: boolean;
            })
          | null;

        if (!res.ok) {
          const message = typeof data?.error === "string" ? data.error : PASSWORD_UPDATE_ERROR_MESSAGE;
          setPasswordError(message);
          showError(message);
          return;
        }

        if (
          !data?.requiresVerification ||
          typeof data.challengeId !== "string" ||
          typeof data.maskedEmail !== "string" ||
          typeof data.expiresInSeconds !== "number" ||
          typeof data.resendAvailableInSeconds !== "number"
        ) {
          setPasswordError(PASSWORD_UPDATE_ERROR_MESSAGE);
          showError(PASSWORD_UPDATE_ERROR_MESSAGE);
          return;
        }

        // Once the server holds only the pending hash, discard every plaintext
        // password from client state before showing the OTP step.
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordError(null);
        setPasswordChallenge({
          challengeId: data.challengeId,
          maskedEmail: data.maskedEmail,
          expiresInSeconds: data.expiresInSeconds,
          resendAvailableInSeconds: data.resendAvailableInSeconds
        });
      } catch {
        setPasswordError(PASSWORD_UPDATE_ERROR_MESSAGE);
        showError(PASSWORD_UPDATE_ERROR_MESSAGE);
      } finally {
        setSavingPassword(false);
      }
    },
    [confirmPassword, currentPassword, hasPassword, newPassword, savingPassword, showError]
  );

  const applyProfilePhotoUrl = useCallback((profilePhotoUrl: string | null) => {
    setPhotoFailed(false);
    setOverview((current) => ({
      ...current,
      profile: { ...current.profile, profilePhotoUrl }
    }));
    // Refresh the server layout so the navigation avatar updates too.
    router.refresh();
  }, [router]);

  const uploadPhoto = useCallback(
    async (file: File) => {
      // Client-side checks are a convenience only — the server re-validates
      // the actual bytes before anything is stored.
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setPhotoError(PROFILE_PHOTO_INVALID_TYPE_MESSAGE);
        return;
      }
      if (file.size > PROFILE_PHOTO_MAX_BYTES) {
        setPhotoError(PROFILE_PHOTO_TOO_LARGE_MESSAGE);
        return;
      }

      setPhotoUploading(true);
      setPhotoError(null);
      try {
        const formData = new FormData();
        formData.append("photo", file);
        const res = await fetch("/api/account/profile-photo", { method: "POST", body: formData });
        const data = (await res.json().catch(() => null)) as { profilePhotoUrl?: string; error?: string } | null;

        if (!res.ok || typeof data?.profilePhotoUrl !== "string") {
          const message = typeof data?.error === "string" ? data.error : PROFILE_PHOTO_UPDATE_ERROR_MESSAGE;
          setPhotoError(message);
          showError(message);
          return;
        }

        applyProfilePhotoUrl(data.profilePhotoUrl);
        showSuccess(PROFILE_PHOTO_SUCCESS_MESSAGE);
      } catch {
        setPhotoError(PROFILE_PHOTO_UPDATE_ERROR_MESSAGE);
        showError(PROFILE_PHOTO_UPDATE_ERROR_MESSAGE);
      } finally {
        setPhotoUploading(false);
      }
    },
    [applyProfilePhotoUrl, showError, showSuccess]
  );

  const onPhotoSelected = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset so picking the same file twice still fires onChange.
      event.target.value = "";
      if (file) {
        void uploadPhoto(file);
      }
    },
    [uploadPhoto]
  );

  const confirmPhotoRemoval = useCallback(async () => {
    if (photoRemoving) {
      return;
    }

    setPhotoRemoving(true);
    setPhotoError(null);
    try {
      const res = await fetch("/api/account/profile-photo", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        const message = typeof data?.error === "string" ? data.error : PROFILE_PHOTO_REMOVE_ERROR_MESSAGE;
        setPhotoError(message);
        showError(message);
        return;
      }

      setPendingPhotoRemoval(false);
      applyProfilePhotoUrl(null);
      showSuccess("Profile photo removed.");
    } catch {
      setPhotoError(PROFILE_PHOTO_REMOVE_ERROR_MESSAGE);
      showError(PROFILE_PHOTO_REMOVE_ERROR_MESSAGE);
    } finally {
      setPhotoRemoving(false);
    }
  }, [applyProfilePhotoUrl, photoRemoving, showError, showSuccess]);

  const { profile, senders, canRemoveSenders } = overview;
  const connectedSenderCount = senders.filter((sender) => sender.status === "connected").length;
  const toggleSection = (section: typeof activeSection) => setActiveSection((current) => current === section ? null : section);

  return (
    <div className={styles.page}>
      <WorkspacePageHeader
        title="Account settings"
        subtitle={profile.name ? `${profile.name} · ${profile.email}` : profile.email}
      />

      {loadError ? <p className={styles.loadError} role="alert">{loadError}</p> : null}

      <div className={styles.settings}>
        <AccountSettingsSection id="information" title="Account information" description="Manage your profile and account details." icon={UserRound} expanded={activeSection === "information"} onToggle={() => toggleSection("information")}>
          <div className={styles.profileRow}>
            {profile.profilePhotoUrl && !photoFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.profilePhotoUrl} alt="Profile photo" className={styles.avatarImage} referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} />
            ) : <span className={styles.avatar} aria-hidden="true">{accountInitial(profile)}</span>}
            <div className={styles.profileCopy}>
              <strong>{profile.name ?? profile.email}</strong>
              <span>{ACCOUNT_TYPE_LABELS[profile.accountType]}</span>
              <div className={styles.photoControls}>
                <input ref={photoInputRef} id={photoInputId} type="file" accept="image/jpeg,image/png,image/webp" className={styles.photoInput} onChange={onPhotoSelected} disabled={photoUploading || photoRemoving} aria-label="Choose a profile photo" />
                <button type="button" className={styles.photoButton} onClick={() => photoInputRef.current?.click()} disabled={photoUploading || photoRemoving} aria-describedby={photoError ? photoErrorId : undefined}>
                  {photoUploading ? <Loader2 aria-hidden="true" className={styles.spin} /> : <Camera aria-hidden="true" />}
                  {photoUploading ? "Uploading…" : profile.profilePhotoUrl ? "Change photo" : "Upload photo"}
                </button>
                {profile.profilePhotoUrl ? <button type="button" className={styles.photoRemoveButton} onClick={() => { setPhotoError(null); setPendingPhotoRemoval(true); }} disabled={photoUploading || photoRemoving}>Remove</button> : null}
              </div>
              {photoError ? <p id={photoErrorId} className={styles.formError} role="alert">{photoError}</p> : null}
            </div>
          </div>
          <dl className={styles.details}>
            <div><dt>Email</dt><dd>{profile.email}</dd></div>
            <div><dt>Member since</dt><dd><LocalDateTime value={profile.createdAt} emptyLabel="Not available" /></dd></div>
            <div><dt>Last sign-in</dt><dd><LocalDateTime value={profile.lastLoginAt} emptyLabel="Not available" /></dd></div>
          </dl>
        </AccountSettingsSection>

        <AccountSettingsSection id="senders" title="Connected Gmail senders" description="Manage Gmail accounts available for sending sequences." icon={Mail} meta={`${connectedSenderCount} connected`} expanded={activeSection === "senders"} onToggle={() => toggleSection("senders")}>
          <div aria-busy={refreshing}>
            {refreshing ? <span className={styles.updating}><Loader2 aria-hidden="true" className={styles.spin} />Updating…</span> : null}
            {senders.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No senders connected yet</strong>
                <p>Connect a Gmail account to start sending sequences.</p>
                <a className="button" href={connectGmailHref}><Plus aria-hidden="true" />Connect Gmail</a>
              </div>
            ) : (
              <>
                <ul className={styles.senderList}>
                  {senders.map((sender) => {
                    const connected = sender.status === "connected";
                    return <li key={sender.id} className={styles.senderRow}>
                      <span className={styles.senderTile} aria-hidden="true"><Mail /></span>
                      <div className={styles.senderMain}>
                        <strong className={styles.senderName}>{sender.name}</strong>
                        <span className={styles.senderEmail}>{sender.fromEmail}</span>
                        <span className={styles.senderMeta}>{sender.providerLabel} · Added <LocalDateTime value={sender.connectedAt} emptyLabel="recently" /></span>
                      </div>
                      <div className={styles.senderSide}>
                        <span className={`${styles.senderStatus} ${connected ? styles.statusOk : styles.statusWarn}`}><span className={styles.statusDot} aria-hidden="true" />{connected ? "Connected" : "Reconnect required"}</span>
                        {connected ? null : <a className={styles.reconnectLink} href={reconnectHref(sender.fromEmail)}>Reconnect</a>}
                        {canRemoveSenders ? <button type="button" className={styles.removeButton} onClick={() => { setRemoveError(null); setPendingRemoval(sender); }} aria-label={`Remove sender ${sender.fromEmail}`} title="Remove"><Trash2 aria-hidden="true" /></button> : null}
                      </div>
                    </li>;
                  })}
                </ul>
                {!canRemoveSenders ? <p className={styles.helperText}>Connect another Gmail account before removing this sender.</p> : null}
                <a className={styles.addSenderRow} href={connectGmailHref}><Plus aria-hidden="true" />Connect another Gmail</a>
              </>
            )}
          </div>
        </AccountSettingsSection>

        <AccountSettingsSection id="password" title="Password" description="Manage the password used to sign in to Sendloom." icon={KeyRound} expanded={activeSection === "password"} onToggle={() => toggleSection("password")}>
          <div className={styles.passwordInner}>
            {!hasPassword ? <p className={styles.passwordIntro}>This account signs in with Google. Set a password to also sign in with email.</p> : null}
            {passwordChallenge ? (
              <OtpVerificationForm challenge={passwordChallenge} verifyEndpoint="/api/account/password/verify" resendEndpoint="/api/account/password/resend" submitLabel="Verify & update password" cancelLabel="Cancel" onCancel={() => { setPasswordChallenge(null); setPasswordError(null); }} onSuccess={async ({ message }) => { setPasswordChallenge(null); setPasswordError(null); await refresh(); showSuccess(message ?? PASSWORD_UPDATE_SUCCESS_MESSAGE); }} />
            ) : (
              <form className={`form ${styles.passwordForm}`} onSubmit={submitPassword} noValidate>
                {hasPassword ? <div className="field"><label htmlFor={currentPasswordId}>Current password</label><input id={currentPasswordId} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} aria-invalid={passwordError ? true : undefined} aria-describedby={passwordError ? passwordErrorId : undefined} disabled={savingPassword} /></div> : null}
                <div className="field"><label htmlFor={newPasswordId}>New password</label><input id={newPasswordId} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-invalid={passwordError ? true : undefined} aria-describedby={passwordError ? passwordErrorId : undefined} disabled={savingPassword} minLength={MIN_PASSWORD_LENGTH} /><p className={styles.fieldHint}>At least {MIN_PASSWORD_LENGTH} characters.</p></div>
                <div className="field"><label htmlFor={confirmPasswordId}>Confirm new password</label><input id={confirmPasswordId} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={passwordError ? true : undefined} aria-describedby={passwordError ? passwordErrorId : undefined} disabled={savingPassword} minLength={MIN_PASSWORD_LENGTH} /></div>
                {passwordError ? <p id={passwordErrorId} className={styles.formError} role="alert">{passwordError}</p> : null}
                <div className={styles.formActions}><button type="submit" className="button" disabled={savingPassword}>{savingPassword ? <Loader2 aria-hidden="true" className={styles.spin} /> : null}{savingPassword ? "Saving…" : hasPassword ? "Update password" : "Set password"}</button></div>
              </form>
            )}
          </div>
        </AccountSettingsSection>

        <AccountSettingsSection id="deletion" title="Delete account" description="Delete your Sendloom account or request permanent removal of your outreach data." icon={UserRoundX} danger expanded={activeSection === "deletion"} onToggle={() => toggleSection("deletion")}>
          <AccountDeletionSection />
        </AccountSettingsSection>
      </div>

      <AppConfirmDialog open={pendingRemoval !== null} title="Remove sender?" description={pendingRemoval ? describeSenderRemoval(pendingRemoval.fromEmail) : ""} confirmLabel="Remove sender" loadingLabel="Removing…" destructive loading={removing} error={removeError} onConfirm={confirmRemoval} onCancel={() => { if (!removing) { setPendingRemoval(null); setRemoveError(null); } }} />
      <AppConfirmDialog open={pendingPhotoRemoval} title="Remove profile photo?" description="Your account goes back to showing your initial. You can upload a new photo anytime." confirmLabel="Remove photo" loadingLabel="Removing…" destructive loading={photoRemoving} onConfirm={confirmPhotoRemoval} onCancel={() => { if (!photoRemoving) setPendingPhotoRemoval(false); }} />
    </div>
  );
}
