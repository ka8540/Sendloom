"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { SequenceRowData } from "@/components/dashboard/types";
import { SequenceRow } from "./sequence-row";
import styles from "./overview-command-center.module.css";

export function SequencePanel({ rows }: { rows: SequenceRowData[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [focus, setFocus] = useState("recent");
  const [sort, setSort] = useState("activity");

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const nextRows = rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.summary.toLowerCase().includes(normalizedQuery);
      const matchesStatus = status === "all" || row.statusTone === status;
      const matchesFocus =
        focus === "recent" ||
        (focus === "attention" && row.needsAttention) ||
        (focus === "validated" && row.isValidated) ||
        (focus === "running" && row.statusTone === "running");

      return matchesQuery && matchesStatus && matchesFocus;
    });

    nextRows.sort((left, right) => {
      if (sort === "name") {
        return left.name.localeCompare(right.name);
      }

      if (sort === "progress") {
        return right.progressPercent - left.progressPercent;
      }

      return right.updatedAtValue - left.updatedAtValue;
    });

    return nextRows;
  }, [focus, query, rows, sort, status]);

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Search</span>
          <div className={styles.toolbarSearch}>
            <Search aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search recent sequences"
              placeholder="Search sequence, template, import, or sender"
            />
          </div>
        </label>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Status</span>
          <select aria-label="Filter recent sequences by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All states</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Needs attention</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
          </select>
        </label>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Focus</span>
          <select aria-label="Filter recent sequences by focus" value={focus} onChange={(event) => setFocus(event.target.value)}>
            <option value="recent">All recent</option>
            <option value="running">Running now</option>
            <option value="validated">Validated</option>
            <option value="attention">Needs attention</option>
          </select>
        </label>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Sort</span>
          <select aria-label="Sort recent sequences" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="activity">Latest activity</option>
            <option value="progress">Progress</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {filteredRows.length ? (
        <div className={styles.sequenceList}>
          {filteredRows.map((sequence) => (
            <SequenceRow key={sequence.id} sequence={sequence} />
          ))}
        </div>
      ) : (
        <div className={styles.sequenceEmpty}>
          <Search aria-hidden="true" />
          <div>
            <strong>No sequences match this view</strong>
            <p>Adjust the search or filters, or create a fresh sequence to give the command center something new to work with.</p>
          </div>
          <Link href="/campaigns" className="button">
            Create Sequence
          </Link>
        </div>
      )}
    </>
  );
}
