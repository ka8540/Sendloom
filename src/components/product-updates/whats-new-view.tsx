"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Sparkles } from "lucide-react";
import type { ProductUpdateIcon } from "@prisma/client";

import { ProductUpdateCard } from "./product-update-card";
import styles from "./whats-new-view.module.css";

export const PRODUCT_UPDATES_SEEN_EVENT = "sendloom:product-updates-seen";

type WhatsNewItem = {
  id: string;
  title: string;
  summary: string;
  description: string;
  icon: ProductUpdateIcon;
  ctaLabel: string | null;
  ctaHref: string | null;
  publishedAt: string | null;
  seen: boolean;
};

type ListResponse = { items: WhatsNewItem[]; nextCursor: string | null };

export function WhatsNewView({
  initialItems,
  initialNextCursor
}: {
  initialItems: WhatsNewItem[];
  initialNextCursor: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [seenIds, setSeenIds] = useState<Set<string>>(
    () => new Set(initialItems.filter((item) => item.seen).map((item) => item.id))
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ids already written (or known) as seen — posting is idempotent, but this
  // avoids redundant requests when paging appends more items.
  const postedSeenRef = useRef<Set<string>>(
    new Set(initialItems.filter((item) => item.seen).map((item) => item.id))
  );

  // Viewing the page marks the currently loaded published updates as seen.
  useEffect(() => {
    const ids = items.map((item) => item.id).filter((id) => !postedSeenRef.current.has(id));
    if (ids.length === 0) {
      return;
    }

    ids.forEach((id) => postedSeenRef.current.add(id));
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/product-updates/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids })
        });
        const body = (await response.json().catch(() => null)) as { unseenCount?: number } | null;
        if (!response.ok || cancelled) {
          return;
        }

        // Refresh the sidebar badge without a full page reload.
        window.dispatchEvent(
          new CustomEvent(PRODUCT_UPDATES_SEEN_EVENT, { detail: { unseenCount: body?.unseenCount ?? 0 } })
        );
        setSeenIds((current) => new Set([...current, ...ids]));
      } catch {
        // Seen state is best-effort; the badge simply stays until a later view.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) {
      return;
    }

    setLoadingMore(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/product-updates?cursor=${encodeURIComponent(nextCursor)}`, {
        cache: "no-store"
      });
      const body = (await response.json().catch(() => null)) as (ListResponse & { error?: string }) | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? "Could not load more updates.");
      }
      setItems((current) => [...current, ...body.items]);
      setNextCursor(body.nextCursor);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load more updates.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  return (
    <>
      <section className={`${styles.hero} card`}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>What&apos;s New</p>
          <h1>New in Sendloom</h1>
          <p className="muted">Discover the latest features and improvements.</p>
        </div>
      </section>

      {items.length === 0 ? (
        <section className={`${styles.empty} card`}>
          <span>
            <Sparkles aria-hidden="true" />
          </span>
          <h2>Nothing new right now</h2>
          <p>New Sendloom features and improvements will appear here.</p>
        </section>
      ) : (
        <section className={styles.list} aria-label="Product updates">
          {items.map((item) => (
            <ProductUpdateCard key={item.id} update={item} isNew={!seenIds.has(item.id)} />
          ))}
        </section>
      )}

      {loadError ? (
        <div className={styles.errorBanner}>
          <CircleAlert aria-hidden="true" />
          {loadError}
        </div>
      ) : null}

      {nextCursor ? (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.loadMoreButton} onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
            {loadingMore ? "Loading…" : "Load earlier updates"}
          </button>
        </div>
      ) : null}
    </>
  );
}
