"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { KeyRound, Loader2, Mail, Plus, Trash2 } from "lucide-react";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { useErrorToast } from "@/components/error-toast-provider";
import { LocalDateTime } from "@/components/local-date-time";
import {
  type AccountOverview,
  type AccountSenderView,
  ACCOUNT_TYPE_LABELS,
  MIN_PASSWORD_LENGTH,
  PASSWORD_UPDATE_ERROR_MESSAGE,
  PASSWORD_UPDATE_SUCCESS_MESSAGE,
  describeSenderRemoval,
  validatePasswordChange
} from "@/lib/account";
import styles from "./account-dashboard.module.css";

const SENDER_REMOVE_GENERIC_ERROR = "We couldn't remove this sender. Please try again.";
const ACCOUNT_LOAD_ERROR = "We couldn't refresh your account details. Reload the page to try again.";

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
  const { showError, showSuccess } = useErrorToast();

  const [overview, setOverview] = useState<AccountOverview>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pendingRemoval, setPendingRemoval] = useState<AccountSenderView | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const hasPassword = overview.profile.hasPassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const currentPasswordId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const passwordErrorId = useId();

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
        const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;

        if (!res.ok) {
          const message = typeof data?.error === "string" ? data.error : PASSWORD_UPDATE_ERROR_MESSAGE;
          setPasswordError(message);
          showError(message);
          return;
        }

        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordError(null);
        showSuccess(typeof data?.message === "string" ? data.message : PASSWORD_UPDATE_SUCCESS_MESSAGE);
      } catch {
        setPasswordError(PASSWORD_UPDATE_ERROR_MESSAGE);
        showError(PASSWORD_UPDATE_ERROR_MESSAGE);
      } finally {
        setSavingPassword(false);
      }
    },
    [confirmPassword, currentPassword, hasPassword, newPassword, savingPassword, showError, showSuccess]
  );

  const { profile, senders, canRemoveSenders } = overview;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className="dashboard-page-title">Account</h1>
        <p className={`dashboard-page-subtitle ${styles.subtitle}`}>Manage your identity, connected Gmail senders, and security.</p>
      </header>

      {loadError ? (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      ) : null}

      {/* Identity card ------------------------------------------------------ */}
      <section className={`card ${styles.identityCard}`} aria-labelledby="account-profile-heading">
        <div className={styles.identityMain}>
          <span className={styles.avatar} aria-hidden="true">
            {accountInitial(profile)}
          </span>
          <div className={styles.identityText}>
            <h2 id="account-profile-heading" className={styles.identityName}>
              {profile.name ?? profile.email}
            </h2>
            {profile.name ? <p className={styles.identityEmail}>{profile.email}</p> : null}
            <p className={styles.identityType}>
              <span className={styles.typeDot} aria-hidden="true" />
              {ACCOUNT_TYPE_LABELS[profile.accountType]}
            </p>
          </div>
        </div>

        <dl className={styles.identityStats}>
          <div className={styles.identityStat}>
            <dt className={styles.statLabel}>Member since</dt>
            <dd className={styles.statValue}>
              <LocalDateTime value={profile.createdAt} emptyLabel="Not available" />
            </dd>
          </div>
          <div className={styles.identityStat}>
            <dt className={styles.statLabel}>Last sign-in</dt>
            <dd className={styles.statValue}>
              <LocalDateTime value={profile.lastLoginAt} emptyLabel="Not available" />
            </dd>
          </div>
        </dl>
      </section>

      <div className={styles.columns}>
        {/* Connected senders ------------------------------------------------ */}
        <section className={`card ${styles.panel}`} aria-labelledby="account-senders-heading" aria-busy={refreshing}>
          <div className={styles.panelHead}>
            <div className={styles.panelHeadCopy}>
              <h2 id="account-senders-heading" className={styles.panelTitle}>
                Connected Gmail senders
              </h2>
              <p className={styles.panelSubtitle}>Gmail accounts available for sending sequences.</p>
            </div>
            {refreshing ? (
              <span className={styles.updating}>
                <Loader2 aria-hidden="true" className={styles.spin} />
                Updating…
              </span>
            ) : null}
          </div>

          {senders.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <Mail />
              </span>
              <p className={styles.emptyTitle}>No senders connected yet</p>
              <p className={styles.emptyBody}>Connect a Gmail account to start sending sequences.</p>
              <a className={`button ${styles.connectButton}`} href={connectGmailHref}>
                <Plus aria-hidden="true" />
                Connect Gmail
              </a>
            </div>
          ) : (
            <>
              <ul className={styles.senderList}>
                {senders.map((sender) => {
                  const connected = sender.status === "connected";
                  return (
                    <li key={sender.id} className={styles.senderRow}>
                      <span className={styles.senderTile} aria-hidden="true">
                        <Mail />
                      </span>
                      <div className={styles.senderMain}>
                        <p className={styles.senderName}>{sender.name}</p>
                        <p className={styles.senderEmail}>{sender.fromEmail}</p>
                        <p className={styles.senderMeta}>
                          {sender.providerLabel} · connected{" "}
                          <LocalDateTime value={sender.connectedAt} emptyLabel="recently" />
                        </p>
                      </div>
                      <div className={styles.senderSide}>
                        <span className={`${styles.senderStatus} ${connected ? styles.statusOk : styles.statusWarn}`}>
                          <span className={styles.statusDot} aria-hidden="true" />
                          {connected ? "Connected" : "Reconnect required"}
                        </span>
                        {connected ? null : (
                          <a className={styles.reconnectLink} href={reconnectHref(sender.fromEmail)}>
                            Reconnect
                          </a>
                        )}
                        {canRemoveSenders ? (
                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={() => {
                              setRemoveError(null);
                              setPendingRemoval(sender);
                            }}
                            aria-label={`Remove sender ${sender.fromEmail}`}
                            title="Remove"
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {!canRemoveSenders ? (
                <p className={styles.helperText}>
                  Connect another Gmail account before removing this sender.
                </p>
              ) : null}

              <a className={styles.addSenderRow} href={connectGmailHref}>
                <span className={styles.addSenderIcon} aria-hidden="true">
                  <Plus />
                </span>
                Connect another Gmail
              </a>
            </>
          )}
        </section>

        {/* Password ----------------------------------------------------------- */}
        <section className={`card ${styles.panel}`} aria-labelledby="account-password-heading">
          <div className={styles.panelHead}>
            <div className={styles.panelHeadCopy}>
              <h2 id="account-password-heading" className={styles.panelTitle}>
                <span className={styles.titleIcon} aria-hidden="true">
                  <KeyRound />
                </span>
                {hasPassword ? "Password" : "Set a password"}
              </h2>
              <p className={styles.panelSubtitle}>
                {hasPassword
                  ? "Update the password used for email sign-in."
                  : "This account signs in with Google. Add a password to also sign in with email."}
              </p>
            </div>
          </div>

          <form className={`form ${styles.passwordForm}`} onSubmit={submitPassword} noValidate>
            {hasPassword ? (
              <div className="field">
                <label htmlFor={currentPasswordId}>Current password</label>
                <input
                  id={currentPasswordId}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={passwordError ? passwordErrorId : undefined}
                  disabled={savingPassword}
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor={newPasswordId}>New password</label>
              <input
                id={newPasswordId}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? passwordErrorId : undefined}
                disabled={savingPassword}
                minLength={MIN_PASSWORD_LENGTH}
              />
              <p className={styles.fieldHint}>At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>

            <div className="field">
              <label htmlFor={confirmPasswordId}>Confirm new password</label>
              <input
                id={confirmPasswordId}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? passwordErrorId : undefined}
                disabled={savingPassword}
                minLength={MIN_PASSWORD_LENGTH}
              />
            </div>

            {passwordError ? (
              <p id={passwordErrorId} className={styles.formError} role="alert">
                {passwordError}
              </p>
            ) : null}

            <div className={styles.formActions}>
              <button type="submit" className="button" disabled={savingPassword}>
                {savingPassword ? <Loader2 aria-hidden="true" className={styles.spin} /> : null}
                {savingPassword ? "Saving…" : hasPassword ? "Update password" : "Set password"}
              </button>
            </div>
          </form>
        </section>
      </div>

      <AppConfirmDialog
        open={pendingRemoval !== null}
        title="Remove sender?"
        description={pendingRemoval ? describeSenderRemoval(pendingRemoval.fromEmail) : ""}
        confirmLabel="Remove sender"
        loadingLabel="Removing…"
        destructive
        loading={removing}
        error={removeError}
        onConfirm={confirmRemoval}
        onCancel={() => {
          if (!removing) {
            setPendingRemoval(null);
            setRemoveError(null);
          }
        }}
      />
    </div>
  );
}
