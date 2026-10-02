"use client";

import type { Route } from "next";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { adminUsersSearchHref } from "./users-search-url";
import styles from "./admin-ui.module.css";

export function AdminUsersSearch({
  query,
  status,
}: {
  query: string;
  status: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);

  const apply = useCallback(
    (value: string) => {
      const href = adminUsersSearchHref(window.location.search, value);
      if (href !== `${window.location.pathname}${window.location.search}`) {
        router.replace(href as Route, { scroll: false });
      }
    },
    [router],
  );

  useEffect(() => {
    const onPopState = () => {
      cancelDebounce();
      setDraft(new URLSearchParams(window.location.search).get("q") ?? "");
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      cancelDebounce();
      window.removeEventListener("popstate", onPopState);
    };
  }, [cancelDebounce]);

  const onChange = (value: string) => {
    setDraft(value);
    cancelDebounce();
    debounceRef.current = setTimeout(() => apply(value), 350);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    cancelDebounce();
    apply(draft);
  };

  const clear = () => {
    cancelDebounce();
    setDraft("");
    apply("");
    inputRef.current?.focus();
  };

  return (
    <form
      className={styles.usersSearchForm}
      action="/admin/users"
      method="get"
      role="search"
      onSubmit={onSubmit}
    >
      {status !== "all" && <input type="hidden" name="status" value={status} />}
      <label className="saved-templates__search">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={draft}
          maxLength={120}
          placeholder="Search email or exact user ID"
          aria-label="Search users"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && draft) {
              event.preventDefault();
              clear();
            }
          }}
        />
        {draft && (
          <button
            className="saved-templates__search-clear"
            type="button"
            aria-label="Clear user search"
            title="Clear search"
            onClick={clear}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </label>
    </form>
  );
}
