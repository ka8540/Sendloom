"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  BadgeCheck,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert
} from "lucide-react";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { useErrorToast } from "@/components/error-toast-provider";
import { LocalDateTime } from "@/components/local-date-time";
import {
  type AccountOverview,
  type AccountSenderView,
  ACCOUNT_TYPE_LABELS,
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
  const removeHelperId = useId();

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
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>Account details</h1>
          <p className={styles.subtitle}>Manage your profile, connected senders, and password settings.</p>
        </div>
        <span className={styles.signedInBadge}>
          <BadgeCheck aria-hidden="true" />
          Signed in
        </span>
      </header>

      {loadError ? (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      ) : null}

      {/* Card 1: Profile ---------------------------------------------------- */}
      <section className={`card ${styles.card}`} aria-labelledby="account-profile-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="account-profile-heading" className={styles.cardTitle}>
              Profile
            </h2>
            <p className={styles.cardSubtitle}>Your login identity and account status.</p>
          </div>
          <span className={`${styles.pill} ${styles.pillNeutral}`}>{ACCOUNT_TYPE_LABELS[profile.accountType]}</span>
        </div>

        <dl className={styles.detailGrid}>
          {profile.name ? (
            <div className={styles.detailItem}>
              <dt className={styles.detailLabel}>Name</dt>
              <dd className={styles.detailValue}>{profile.name}</dd>
            </div>
          ) : null}
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Login email</dt>
            <dd className={styles.detailValue}>{profile.email}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Account type</dt>
            <dd className={styles.detailValue}>{ACCOUNT_TYPE_LABELS[profile.accountType]}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Created</dt>
            <dd className={styles.detailValue}>
              <LocalDateTime value={profile.createdAt} emptyLabel="Not available" />
            </dd>
          </div>
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Last sign-in</dt>
            <dd className={styles.detailValue}>
              <LocalDateTime value={profile.lastLoginAt} emptyLabel="Not available" />
            </dd>
          </div>
        </dl>
      </section>

      <div className={styles.columns}>
        {/* Card 2: Connected senders --------------------------------------- */}
        <section className={`card ${styles.card}`} aria-labelledby="account-senders-heading" aria-busy={refreshing}>
          <div className={styles.cardHead}>
            <div>
              <h2 id="account-senders-heading" className={styles.cardTitle}>
                Connected sender emails
              </h2>
              <p className={styles.cardSubtitle}>Gmail accounts you can send sequences from.</p>
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
                      <span className={styles.senderAvatar} aria-hidden="true">
                        <Mail />
                      </span>
                      <div className={styles.senderMain}>
                        <p className={styles.senderName}>{sender.name}</p>
                        <p className={styles.senderEmail}>{sender.fromEmail}</p>
                        <p className={styles.senderMeta}>
                          {sender.providerLabel} · Connected{" "}
                          <LocalDateTime value={sender.connectedAt} emptyLabel="recently" />
                        </p>
                      </div>
                      <div className={styles.senderSide}>
                        <span
                          className={`${styles.statusPill} ${connected ? styles.statusConnected : styles.statusReconnect}`}
                        >
                          {connected ? <ShieldCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
                          {connected ? "Connected" : "Reconnect required"}
                        </span>
                        <div className={styles.senderActions}>
                          {connected ? null : (
                            <a className={`button secondary ${styles.smallButton}`} href={reconnectHref(sender.fromEmail)}>
                              Reconnect
                            </a>
                          )}
                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={() => {
                              setRemoveError(null);
                              setPendingRemoval(sender);
                            }}
                            disabled={!canRemoveSenders}
                            aria-label={`Remove sender ${sender.fromEmail}`}
                            aria-describedby={canRemoveSenders ? undefined : removeHelperId}
                            title={canRemoveSenders ? undefined : "Add another sender before removing this one."}
                          >
                            <Trash2 aria-hidden="true" />
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {!canRemoveSenders ? (
                <p id={removeHelperId} className={styles.helperText}>
                  Add another sender before removing this one.
                </p>
              ) : null}

              <div className={styles.connectRow}>
                <a className={`button secondary ${styles.connectButton}`} href={connectGmailHref}>
                  <Plus aria-hidden="true" />
                  Connect another Gmail
                </a>
              </div>
            </>
          )}
        </section>

        {/* Card 3: Password ------------------------------------------------ */}
        <section className={`card ${styles.card}`} aria-labelledby="account-password-heading">
          <div className={styles.cardHead}>
            <div>
              <h2 id="account-password-heading" className={styles.cardTitle}>
                {hasPassword ? "Change password" : "Set a password"}
              </h2>
              <p className={styles.cardSubtitle}>
                {hasPassword
                  ? "Update the password you use to sign in with email."
                  : "This account signs in with Google. Add a password to also sign in with email."}
              </p>
            </div>
            <span className={styles.passwordIcon} aria-hidden="true">
              <KeyRound />
            </span>
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
                minLength={8}
              />
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
                minLength={8}
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
