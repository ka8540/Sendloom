"use client";

import { useMemo, useState } from "react";
import type { HunterResultRow } from "@/lib/hunter";
import { AlertCircle, Check, Copy, Globe, KeyRound, LoaderCircle, Mail, Search, Settings2, UserRound } from "lucide-react";
import styles from "@/components/hunter-dashboard.module.css";

type HunterKeyStatus = {
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
};

type SearchTab = "finder" | "domain";

type Props = {
  initialKeyStatus: HunterKeyStatus;
};

function splitFullName(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function formatUpdatedAt(updatedAt: string | null) {
  if (!updatedAt) {
    return null;
  }

  return new Date(updatedAt).toLocaleString();
}

export function HunterDashboard({ initialKeyStatus }: Props) {
  const [activeTab, setActiveTab] = useState<SearchTab>("finder");
  const [keyStatus, setKeyStatus] = useState(initialKeyStatus);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [settingsPending, setSettingsPending] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [finderDomain, setFinderDomain] = useState("");
  const [searchDomain, setSearchDomain] = useState("");

  const [results, setResults] = useState<HunterResultRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const statusCopy = useMemo(() => {
    if (!keyStatus.configured) {
      return "No Hunter API key saved yet.";
    }

    const updated = formatUpdatedAt(keyStatus.updatedAt);
    return updated ? `Saved key ••••${keyStatus.last4 ?? "----"} updated ${updated}` : `Saved key ••••${keyStatus.last4 ?? "----"}`;
  }, [keyStatus]);

  async function handleSaveApiKey() {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setSettingsError("Enter your Hunter API key first.");
      return;
    }

    setSettingsPending(true);
    setSettingsError(null);

    try {
      const response = await fetch("/api/save-api-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ apiKey: trimmedKey })
      });

      const payload = (await response.json().catch(() => null)) as HunterKeyStatus & { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not save your Hunter API key.");
      }

      setKeyStatus({
        configured: payload?.configured ?? true,
        last4: payload?.last4 ?? null,
        updatedAt: payload?.updatedAt ?? null
      });
      setApiKey("");
      setIsSettingsOpen(false);
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Could not save your Hunter API key.");
    } finally {
      setSettingsPending(false);
    }
  }

  async function runSearch(endpoint: "/api/email-finder" | "/api/domain-search", payload: Record<string, string>) {
    setPending(true);
    setError(null);
    setHasSearched(true);
    setResults([]);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => null)) as { error?: string; results?: HunterResultRow[] } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Hunter search failed.");
      }

      setResults(data?.results ?? []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Hunter search failed.");
    } finally {
      setPending(false);
    }
  }

  async function handleFindEmail() {
    const parsedName = splitFullName(fullName);
    if (!parsedName) {
      setHasSearched(false);
      setError("Enter a full name with both first and last name.");
      return;
    }

    if (!finderDomain.trim()) {
      setHasSearched(false);
      setError("Enter a company domain like stripe.com.");
      return;
    }

    await runSearch("/api/email-finder", {
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
      domain: finderDomain.trim()
    });
  }

  async function handleDomainSearch() {
    if (!searchDomain.trim()) {
      setHasSearched(false);
      setError("Enter a company domain like stripe.com.");
      return;
    }

    await runSearch("/api/domain-search", {
      domain: searchDomain.trim()
    });
  }

  async function handleCopy(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      window.setTimeout(() => {
        setCopiedEmail((current) => (current === email ? null : current));
      }, 1400);
    } catch {
      setError("Could not copy that email. Try again.");
    }
  }

  const searchDisabled = pending || !keyStatus.configured;

  return (
    <>
      <div className={styles.page}>
        <section className={`hero ${styles.hero}`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Prospecting workspace</p>
            <h1>Email Finder</h1>
            <p className="muted">
              Use Hunter through a secure backend proxy to find one contact by name or search an entire company domain without
              exposing your API key in the browser.
            </p>
          </div>
          <div className={styles.heroActions}>
            <div className={styles.keyStatus}>
              <span className={`${styles.keyDot} ${keyStatus.configured ? styles.keyDotReady : styles.keyDotMissing}`} aria-hidden="true" />
              <span>{statusCopy}</span>
            </div>
            <button className="button secondary" type="button" onClick={() => setIsSettingsOpen(true)}>
              <Settings2 aria-hidden="true" />
              Hunter settings
            </button>
          </div>
        </section>

        <section className={`card ${styles.workspace}`}>
          <div className={styles.tabRow} role="tablist" aria-label="Hunter search modes">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "finder"}
              className={`${styles.tabButton} ${activeTab === "finder" ? styles.tabButtonActive : ""}`}
              onClick={() => {
                setActiveTab("finder");
                setError(null);
              }}
            >
              <UserRound aria-hidden="true" />
              Find Email
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "domain"}
              className={`${styles.tabButton} ${activeTab === "domain" ? styles.tabButtonActive : ""}`}
              onClick={() => {
                setActiveTab("domain");
                setError(null);
              }}
            >
              <Globe aria-hidden="true" />
              Domain Search
            </button>
          </div>

          {!keyStatus.configured ? (
            <div className={styles.callout}>
              <div>
                <strong>Add your Hunter API key to get started.</strong>
                <p className="muted">The key is stored server-side in encrypted form and never exposed to the frontend.</p>
              </div>
              <button className="button" type="button" onClick={() => setIsSettingsOpen(true)}>
                <KeyRound aria-hidden="true" />
                Add API key
              </button>
            </div>
          ) : null}

          <div className={styles.panelGrid}>
            <article className={styles.formPanel}>
              {activeTab === "finder" ? (
                <>
                  <div className={styles.panelHeader}>
                    <div>
                      <h2>Find a specific email</h2>
                      <p className="muted">Match one person against a company domain using full name plus domain.</p>
                    </div>
                  </div>
                  <div className="form">
                    <div className="field">
                      <label htmlFor="finder-full-name">Full name</label>
                      <input
                        id="finder-full-name"
                        placeholder="Alexis Ohanian"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="finder-domain">Domain</label>
                      <input
                        id="finder-domain"
                        placeholder="reddit.com"
                        value={finderDomain}
                        onChange={(event) => setFinderDomain(event.target.value)}
                      />
                    </div>
                    <button className="button" type="button" onClick={handleFindEmail} disabled={searchDisabled}>
                      {pending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Mail aria-hidden="true" />}
                      Find Email
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.panelHeader}>
                    <div>
                      <h2>Search a company domain</h2>
                      <p className="muted">Return all Hunter matches found for a domain with confidence and role data.</p>
                    </div>
                  </div>
                  <div className="form">
                    <div className="field">
                      <label htmlFor="domain-search-domain">Domain</label>
                      <input
                        id="domain-search-domain"
                        placeholder="stripe.com"
                        value={searchDomain}
                        onChange={(event) => setSearchDomain(event.target.value)}
                      />
                    </div>
                    <button className="button" type="button" onClick={handleDomainSearch} disabled={searchDisabled}>
                      {pending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Search aria-hidden="true" />}
                      Search
                    </button>
                  </div>
                </>
              )}
            </article>

            <article className={styles.resultsPanel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Results</h2>
                  <p className="muted">Emails, roles, and source domains returned by Hunter through the backend proxy.</p>
                </div>
              </div>

              {error ? (
                <div className={styles.feedbackError}>
                  <AlertCircle aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              {pending ? (
                <div className={styles.feedbackEmpty}>
                  <LoaderCircle className={styles.spinner} aria-hidden="true" />
                  <span>Searching Hunter…</span>
                </div>
              ) : null}

              {!pending && !error && !hasSearched ? (
                <div className={styles.feedbackEmpty}>
                  <Search aria-hidden="true" />
                  <span>Run a search to see clean Hunter results here.</span>
                </div>
              ) : null}

              {!pending && !error && hasSearched && results.length === 0 ? (
                <div className={styles.feedbackEmpty}>
                  <AlertCircle aria-hidden="true" />
                  <span>No results found for that query.</span>
                </div>
              ) : null}

              {!pending && !error && results.length > 0 ? (
                <section className={styles.resultsShell} aria-label="Hunter results">
                  <div className={styles.resultsSummary}>
                    <div>
                      <p className={styles.resultsEyebrow}>Returned matches</p>
                      <strong>{results.length} result{results.length === 1 ? "" : "s"}</strong>
                    </div>
                    <p className="muted">
                      {activeTab === "finder"
                        ? "One verified profile view with full deliverability context."
                        : "A scrollable roster of domain matches with stable alignment."}
                    </p>
                  </div>

                  <div className={styles.resultsViewport}>
                    <div className={styles.resultsList}>
                      {results.map((row) => (
                        <article key={`${row.email}-${row.source}`} className={styles.resultCard}>
                          <div className={styles.resultPrimary}>
                            <strong className={styles.resultEmail}>{row.email}</strong>
                            <span className={styles.resultName}>{row.name || "Unknown contact"}</span>
                          </div>

                          <dl className={styles.resultMeta}>
                            <div>
                              <dt>Position</dt>
                              <dd>{row.position ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>Confidence</dt>
                              <dd>{typeof row.confidence === "number" ? `${row.confidence}%` : "—"}</dd>
                            </div>
                            <div>
                              <dt>Source</dt>
                              <dd>{row.source}</dd>
                            </div>
                          </dl>

                          <button
                            type="button"
                            className={styles.copyButtonSecondary}
                            onClick={() => handleCopy(row.email)}
                            aria-label={`Copy ${row.email}`}
                          >
                            {copiedEmail === row.email ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                            {copiedEmail === row.email ? "Copied" : "Copy"}
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}
            </article>
          </div>
        </section>
      </div>

      {isSettingsOpen ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => !settingsPending && setIsSettingsOpen(false)}>
          <div
            className={styles.modalCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hunter-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Secure settings</p>
                <h2 id="hunter-settings-title">Hunter API key</h2>
                <p className="muted">
                  Save your own Hunter key once. It is encrypted on the server and only attached inside backend requests.
                </p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => !settingsPending && setIsSettingsOpen(false)} aria-label="Close settings">
                ×
              </button>
            </div>

            <div className="form">
              <div className="field">
                <label htmlFor="hunter-api-key">API key</label>
                <input
                  id="hunter-api-key"
                  type="password"
                  placeholder="Paste your Hunter API key"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                />
                <p className="field-inline-note">
                  {keyStatus.configured
                    ? `Current key ••••${keyStatus.last4 ?? "----"}${keyStatus.updatedAt ? ` saved ${formatUpdatedAt(keyStatus.updatedAt)}` : ""}`
                    : "No Hunter key saved yet for this account."}
                </p>
              </div>

              {settingsError ? <p className={styles.modalError}>{settingsError}</p> : null}

              <div className={styles.modalActions}>
                <button type="button" className="button secondary" onClick={() => setIsSettingsOpen(false)} disabled={settingsPending}>
                  Cancel
                </button>
                <button type="button" className="button" onClick={handleSaveApiKey} disabled={settingsPending}>
                  {settingsPending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                  Save API key
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
