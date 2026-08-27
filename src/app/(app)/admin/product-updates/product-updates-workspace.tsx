"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  SendHorizontal,
  Sparkles
} from "lucide-react";
import type { ProductUpdateIcon, ProductUpdateStatus } from "@prisma/client";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CircularCloseButton } from "@/components/circular-close-button";
import { formatProductUpdateDate, ProductUpdateCard } from "@/components/product-updates/product-update-card";

import styles from "./product-updates.module.css";

type AdminProductUpdate = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  icon: ProductUpdateIcon;
  status: ProductUpdateStatus;
  ctaLabel: string | null;
  ctaHref: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  viewsCount: number;
  createdBy: { id: string; email: string };
};

type ListResponse = {
  items: AdminProductUpdate[];
  nextCursor: string | null;
  summary: { drafts: number; published: number; archived: number; totalViews: number };
};

type ComposerState = {
  title: string;
  summary: string;
  description: string;
  icon: ProductUpdateIcon;
  ctaLabel: string;
  ctaHref: string;
};

const STATUS_LABELS: Record<ProductUpdateStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived"
};

const ICON_OPTIONS: Array<{ value: ProductUpdateIcon; label: string }> = [
  { value: "SPARKLES", label: "Sparkles" },
  { value: "BELL", label: "Bell" },
  { value: "USER", label: "User" },
  { value: "SEARCH", label: "Search" },
  { value: "SEND", label: "Send" },
  { value: "MAIL", label: "Mail" },
  { value: "SHIELD", label: "Shield" },
  { value: "SETTINGS", label: "Settings" }
];

function blankComposer(): ComposerState {
  return { title: "", summary: "", description: "", icon: "SPARKLES", ctaLabel: "", ctaHref: "" };
}

function fromUpdate(update: AdminProductUpdate): ComposerState {
  return {
    title: update.title,
    summary: update.summary,
    description: update.description,
    icon: update.icon,
    ctaLabel: update.ctaLabel ?? "",
    ctaHref: update.ctaHref ?? ""
  };
}

function payloadFromComposer(composer: ComposerState) {
  return {
    title: composer.title.trim(),
    summary: composer.summary.trim(),
    description: composer.description.trim(),
    icon: composer.icon,
    ctaLabel: composer.ctaLabel.trim() || null,
    ctaHref: composer.ctaHref.trim() || null
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(body?.error ?? "The request failed. Please try again.");
  return body as T;
}

function jsonRequest(method: "POST" | "PATCH", body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

export function ProductUpdatesWorkspace() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState>(() => blankComposer());
  const [composerError, setComposerError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<AdminProductUpdate | null>(null);
  const [publishTarget, setPublishTarget] = useState<AdminProductUpdate | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setPageError(null);
    try {
      setData(await fetchJson<ListResponse>("/api/admin/product-updates"));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load product updates.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!data?.nextCursor) {
      return;
    }

    setRefreshing(true);
    setPageError(null);
    try {
      const next = await fetchJson<ListResponse>(
        `/api/admin/product-updates?cursor=${encodeURIComponent(data.nextCursor)}`
      );
      setData((current) =>
        current
          ? { items: [...current.items, ...next.items], nextCursor: next.nextCursor, summary: next.summary }
          : next
      );
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load more product updates.");
    } finally {
      setRefreshing(false);
    }
  }, [data?.nextCursor]);

  function updateComposer<Key extends keyof ComposerState>(key: Key, value: ComposerState[Key]) {
    setComposer((current) => ({ ...current, [key]: value }));
    setComposerError(null);
  }

  function openNew() {
    setEditingId(null);
    setComposer(blankComposer());
    setComposerError(null);
    setComposerOpen(true);
  }

  function openEdit(update: AdminProductUpdate) {
    setEditingId(update.id);
    setComposer(fromUpdate(update));
    setComposerError(null);
    setComposerOpen(true);
  }

  async function persistUpdate() {
    const payload = payloadFromComposer(composer);
    return editingId
      ? fetchJson<AdminProductUpdate>(`/api/admin/product-updates/${editingId}`, jsonRequest("PATCH", payload))
      : fetchJson<AdminProductUpdate>("/api/admin/product-updates", jsonRequest("POST", payload));
  }

  async function saveDraft() {
    setWorking(true);
    setComposerError(null);
    try {
      await persistUpdate();
      setComposerOpen(false);
      await load(true);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not save the product update.");
    } finally {
      setWorking(false);
    }
  }

  async function saveThenPublish() {
    setWorking(true);
    setComposerError(null);
    try {
      const saved = await persistUpdate();
      setComposerOpen(false);
      setPublishError(null);
      setPublishTarget(saved);
      await load(true);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not save the product update.");
    } finally {
      setWorking(false);
    }
  }

  async function publishUpdate() {
    if (!publishTarget) return;
    setWorking(true);
    setPublishError(null);
    try {
      await fetchJson(`/api/admin/product-updates/${publishTarget.id}/publish`, jsonRequest("POST"));
      setPublishTarget(null);
      await load(true);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Could not publish the product update.");
    } finally {
      setWorking(false);
    }
  }

  async function archiveUpdate(update: AdminProductUpdate) {
    setArchivingId(update.id);
    setPageError(null);
    try {
      await fetchJson(`/api/admin/product-updates/${update.id}/archive`, jsonRequest("POST"));
      await load(true);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not archive the product update.");
    } finally {
      setArchivingId(null);
    }
  }

  const composerPreview = {
    title: composer.title || "Product update title",
    summary: composer.summary || "A short summary shown on the What's New card.",
    description: composer.description || "The longer plain-text description users can read.",
    icon: composer.icon,
    ctaLabel: composer.ctaLabel.trim() || null,
    ctaHref: composer.ctaHref.trim() || null,
    publishedAt: null
  };
  const editingIsDraft = editingId
    ? (data?.items.find((update) => update.id === editingId)?.status ?? "DRAFT") === "DRAFT"
    : true;

  return (
    <>
      <section className={`${styles.hero} card`}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Product communications</p>
          <h1>Product Updates</h1>
          <p className="muted">Publish new features and improvements for Sendloom users.</p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={openNew}>
          <Plus aria-hidden="true" /> New update
        </button>
      </section>

      <section className={styles.metrics} aria-label="Product update metrics">
        {[
          { label: "Drafts", value: data?.summary.drafts ?? 0, icon: Pencil, tone: styles.metricNeutral },
          { label: "Published", value: data?.summary.published ?? 0, icon: CheckCircle2, tone: styles.metricGreen },
          { label: "Archived", value: data?.summary.archived ?? 0, icon: Archive, tone: styles.metricNeutral },
          { label: "Total views", value: data?.summary.totalViews ?? 0, icon: Eye, tone: styles.metricBlue }
        ].map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className={`${styles.metricCard} card`}>
            <span className={`${styles.metricIcon} ${tone}`}>
              <Icon aria-hidden="true" />
            </span>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          </article>
        ))}
      </section>

      {pageError ? (
        <div className={styles.errorBanner}>
          <CircleAlert aria-hidden="true" />
          {pageError}
        </div>
      ) : null}

      <section className={`${styles.sectionCard} card`}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>Announcements</p>
            <h2>All product updates</h2>
          </div>
          <button type="button" className={styles.refreshButton} onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw aria-hidden="true" className={refreshing ? styles.spin : undefined} /> Refresh
          </button>
        </div>
        {loading ? (
          <LoadingRows />
        ) : data && data.items.length > 0 ? (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Update</th>
                    <th>Status</th>
                    <th>Published</th>
                    <th>Views</th>
                    <th>Created by</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((update) => (
                    <tr key={update.id}>
                      <td>
                        <strong>{update.title}</strong>
                        <span>{update.summary}</span>
                      </td>
                      <td>
                        <span className={`${styles.statusBadge} ${styles[`status${update.status}`]}`}>
                          {STATUS_LABELS[update.status]}
                        </span>
                      </td>
                      <td>
                        <strong>{update.publishedAt ? formatProductUpdateDate(update.publishedAt) : "—"}</strong>
                      </td>
                      <td>
                        <strong>{update.viewsCount}</strong>
                      </td>
                      <td>
                        <strong>{update.createdBy.email}</strong>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          {update.status !== "ARCHIVED" ? (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => openEdit(update)}
                              aria-label={`Edit ${update.title}`}
                            >
                              <Pencil aria-hidden="true" /> Edit
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => setPreviewTarget(update)}
                            aria-label={`Preview ${update.title}`}
                          >
                            <Eye aria-hidden="true" /> Preview
                          </button>
                          {update.status === "DRAFT" ? (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => {
                                setPublishError(null);
                                setPublishTarget(update);
                              }}
                              aria-label={`Publish ${update.title}`}
                            >
                              <SendHorizontal aria-hidden="true" /> Publish
                            </button>
                          ) : null}
                          {update.status !== "ARCHIVED" ? (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => void archiveUpdate(update)}
                              disabled={archivingId === update.id}
                              aria-label={`Archive ${update.title}`}
                            >
                              {archivingId === update.id ? (
                                <LoaderCircle className={styles.spin} aria-hidden="true" />
                              ) : (
                                <Archive aria-hidden="true" />
                              )}
                              Archive
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.nextCursor ? (
              <div className={styles.loadMoreRow}>
                <button type="button" className={styles.refreshButton} onClick={() => void loadMore()} disabled={refreshing}>
                  {refreshing ? "Loading…" : "Load more updates"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.empty}>
            <span>
              <Sparkles aria-hidden="true" />
            </span>
            <h3>No product updates yet</h3>
            <p>Publish feature announcements so users can discover what&apos;s new.</p>
          </div>
        )}
      </section>

      {composerOpen ? (
        <div className={styles.overlay} role="presentation">
          <section className={styles.composer} role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <header className={styles.composerHeader}>
              <div>
                <p className={styles.kicker}>What&apos;s New</p>
                <h2 id="composer-title">{editingId ? "Edit product update" : "Create product update"}</h2>
              </div>
              <CircularCloseButton
                label="Close composer"
                onClick={() => !working && setComposerOpen(false)}
                disabled={working}
              />
            </header>

            <div className={styles.composerBody}>
              <div className={styles.formPane}>
                <section className={styles.formSection} aria-labelledby="update-content-heading">
                  <header className={styles.formSectionHeader}>
                    <h3 id="update-content-heading">Update content</h3>
                    <p>Plain text only — Sendloom renders it escaped, exactly as users will read it.</p>
                  </header>
                  <div className={styles.fields}>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}>
                        <span>Title</span>
                        <span className={styles.fieldMeta}>{composer.title.length} / 100</span>
                      </span>
                      <input
                        value={composer.title}
                        maxLength={100}
                        placeholder="Stay updated with in-app notifications"
                        onChange={(event) => updateComposer("title", event.target.value)}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}>
                        <span>Summary</span>
                        <span className={styles.fieldMeta}>{composer.summary.length} / 220</span>
                      </span>
                      <input
                        value={composer.summary}
                        maxLength={220}
                        placeholder="Important Sendloom updates now arrive directly in your workspace."
                        onChange={(event) => updateComposer("summary", event.target.value)}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}>
                        <span>Description</span>
                        <span className={styles.fieldMeta}>{composer.description.length} / 5000</span>
                      </span>
                      <textarea
                        rows={7}
                        value={composer.description}
                        maxLength={5000}
                        onChange={(event) => updateComposer("description", event.target.value)}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}>
                        <span>Icon</span>
                      </span>
                      <div className={styles.selectWrap}>
                        <select
                          className={styles.iconSelect}
                          value={composer.icon}
                          onChange={(event) => updateComposer("icon", event.target.value as ProductUpdateIcon)}
                        >
                          {ICON_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className={styles.selectChevron} aria-hidden="true" />
                      </div>
                    </label>
                  </div>
                </section>

                <section className={styles.formSection} aria-labelledby="update-cta-heading">
                  <header className={styles.formSectionHeader}>
                    <h3 id="update-cta-heading">Call to action</h3>
                    <p>Optional — link users into the feature. Internal Sendloom paths only, e.g. /account.</p>
                  </header>
                  <div className={styles.ctaGrid}>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}>
                        <span>CTA label</span>
                        <span className={styles.fieldMeta}>{composer.ctaLabel.length} / 40</span>
                      </span>
                      <input
                        value={composer.ctaLabel}
                        maxLength={40}
                        placeholder="Add profile photo"
                        onChange={(event) => updateComposer("ctaLabel", event.target.value)}
                      />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}>
                        <span>CTA destination</span>
                        <span className={styles.fieldMeta}>Optional</span>
                      </span>
                      <input
                        value={composer.ctaHref}
                        maxLength={200}
                        placeholder="/account"
                        onChange={(event) => updateComposer("ctaHref", event.target.value)}
                      />
                    </label>
                  </div>
                </section>

                {composerError ? (
                  <div className={styles.formError}>
                    <CircleAlert aria-hidden="true" />
                    {composerError}
                  </div>
                ) : null}
              </div>

              <aside className={styles.previewPane}>
                <div className={styles.previewHeader}>
                  <div>
                    <p className={styles.kicker}>Live preview</p>
                    <h3>What users will see</h3>
                  </div>
                </div>
                <ProductUpdateCard update={composerPreview} />
                <p className={styles.previewNote}>
                  This is the exact card rendered on What&apos;s New. Previewing never publishes and never counts views.
                </p>
              </aside>
            </div>

            <footer className={styles.composerFooter}>
              <div className={styles.composerActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void saveDraft()} disabled={working}>
                  {working ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
                  {editingId ? "Save changes" : "Save draft"}
                </button>
                {editingIsDraft ? (
                  <button type="button" className={styles.primaryButton} onClick={() => void saveThenPublish()} disabled={working}>
                    <SendHorizontal aria-hidden="true" />
                    {editingId ? "Save & publish…" : "Create & publish…"}
                  </button>
                ) : null}
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {previewTarget ? (
        <div className={`${styles.overlay} ${styles.centerOverlay}`} role="presentation">
          <section className={styles.previewModal} role="dialog" aria-modal="true" aria-labelledby="preview-title">
            <header className={styles.composerHeader}>
              <div>
                <p className={styles.kicker}>{STATUS_LABELS[previewTarget.status]}</p>
                <h2 id="preview-title">Update preview</h2>
              </div>
              <CircularCloseButton label="Close preview" onClick={() => setPreviewTarget(null)} />
            </header>
            <div className={styles.previewModalBody}>
              <ProductUpdateCard update={previewTarget} />
            </div>
          </section>
        </div>
      ) : null}

      <AppConfirmDialog
        open={Boolean(publishTarget)}
        title="Publish product update?"
        description={
          <>
            “{publishTarget?.title}” will appear in every user&apos;s What&apos;s New section with a NEW marker until they
            view it.
          </>
        }
        confirmLabel="Publish update"
        loadingLabel="Publishing…"
        confirmIcon={<SendHorizontal aria-hidden="true" />}
        loading={working}
        error={publishError}
        onConfirm={publishUpdate}
        onCancel={() => {
          if (!working) {
            setPublishTarget(null);
            setPublishError(null);
          }
        }}
      />
    </>
  );
}

function LoadingRows() {
  return (
    <div className={styles.loadingRows} aria-label="Loading product updates">
      {Array.from({ length: 3 }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
