'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import styles from './verify.module.css';

export default function VerifyEligibilityPage() {
  const router = useRouter();
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptAntiAbuse, setAcceptAntiAbuse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const allChecked = confirmAdult && acceptTerms && acceptAntiAbuse;

  useEffect(() => {
    let cancelled = false;

    async function syncEligibilityState() {
      const res = await fetch('/api/auth/eligibility-status', { cache: 'no-store' });
      if (cancelled) return;

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        return;
      }

      const status = (await res.json().catch(() => null)) as { blocked?: boolean; verified?: boolean } | null;
      if (cancelled || !status) return;

      if (status.blocked) {
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
        if (!cancelled) {
          setBlocked(true);
        }
        return;
      }

      if (status.verified) {
        router.replace('/workspace');
      }
    }

    void syncEligibilityState();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleContinue() {
    if (!allChecked) return;
    setLoading(true);
    setError(null);
    try {
      const csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('sendloom_csrf='))
        ?.split('=')[1] ?? '';

      const res = await fetch('/api/auth/verify-eligibility', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          confirmAdult: true,
          acceptTerms: true,
          acceptPrivacy: true,
          acceptAntiAbuse: true
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Something went wrong.' }));
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }
      router.push('/workspace');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  async function handleIneligible() {
    setLoading(true);
    try {
      const csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('sendloom_csrf='))
        ?.split('=')[1] ?? '';

      const res = await fetch('/api/auth/report-ineligible', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ reason: 'self_reported_underage' })
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Something went wrong.' }));
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
      return;
    }
    setBlocked(true);
    setLoading(false);
  }

  if (blocked) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.blockedIcon} aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
          <h1 className={styles.title}>Access unavailable</h1>
          <p className={styles.blockedMessage}>
            Sendloom is not available to users under 18. This is a business outreach tool intended for adult professionals.
          </p>
          <div className={styles.blockedActions}>
            <Link href="/" className={styles.backLink}>Return to homepage</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.headerIcon} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
        </div>
        <h1 className={styles.title}>Confirm business use</h1>
        <p className={styles.subtitle}>
          Sendloom is intended for adults using the product for lawful business outreach. Please confirm before continuing.
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.checkboxGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={confirmAdult}
              onChange={(e) => setConfirmAdult(e.target.checked)}
              className={styles.checkbox}
            />
            <span>I confirm I am 18 years or older.</span>
          </label>

          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className={styles.checkbox}
            />
            <span>
              I agree to Sendloom&apos;s{' '}
              <Link href="/terms" target="_blank" className={styles.inlineLink}>Terms of Service</Link>
              {' '}and{' '}
              <Link href="/privacy" target="_blank" className={styles.inlineLink}>Privacy Policy</Link>.
            </span>
          </label>

          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={acceptAntiAbuse}
              onChange={(e) => setAcceptAntiAbuse(e.target.checked)}
              className={styles.checkbox}
            />
            <span>
              I agree not to use Sendloom for spam, harassment, unlawful outreach, or contacting minors, per the{' '}
              <Link href="/abuse" target="_blank" className={styles.inlineLink}>Anti-Abuse Policy</Link>.
            </span>
          </label>
        </div>

        <button
          className={styles.continueButton}
          disabled={!allChecked || loading}
          onClick={handleContinue}
        >
          {loading ? 'Confirming\u2026' : 'Continue to Sendloom'}
        </button>

        <div className={styles.ineligibleSection}>
          <button
            className={styles.ineligibleButton}
            onClick={handleIneligible}
            disabled={loading}
          >
            I am not eligible
          </button>
        </div>
      </div>
    </div>
  );
}
