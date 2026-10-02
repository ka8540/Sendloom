import type { Route } from "next";
import Link from "next/link";
import { CheckCircle2, History, UserRound } from "lucide-react";
import { requireAdminUser } from "@/lib/auth";
import { getAdminOverview } from "@/services/admin-v2/overview";
import { AdminPulseBars } from "@/components/admin-v2/admin-charts";
import {
  formatAdminDate,
  formatAdminEventTitle,
  formatAdminInstant,
  formatAdminRelative,
} from "@/components/admin-v2/format";
import {
  AdminCompactPager,
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
  AdminShell,
  AdminStatusBadge,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ activityPage?: string; accountsPage?: string }>;
}) {
  await requireAdminUser();
  const params = await searchParams;
  const data = await getAdminOverview({
    activityPage: Number(params.activityPage) || 1,
    accountsPage: Number(params.accountsPage) || 1,
  });
  const pageHref = (feed: "activity" | "accounts", page: number) => {
    const query = new URLSearchParams();
    const activityPage =
      feed === "activity" ? page : data.recentAdminPagination.page;
    const accountsPage =
      feed === "accounts" ? page : data.recentAccountsPagination.page;
    if (activityPage > 1) query.set("activityPage", String(activityPage));
    if (accountsPage > 1) query.set("accountsPage", String(accountsPage));
    return `/admin${query.size ? `?${query}` : ""}#${feed === "activity" ? "recent-admin-activity" : "recent-accounts"}`;
  };
  const pulseTotals = data.pulse.reduce(
    (sum, day) => ({
      sends: sum.sends + day.sends,
      runs: sum.runs + day.runs,
      searches: sum.searches + day.searches,
      users: sum.users + day.users,
    }),
    { sends: 0, runs: 0, searches: 0, users: 0 },
  );
  const healthChecks = [
    ["Database", data.health.checks.database],
    ["Redis", data.health.checks.redis],
    ["Storage", data.health.checks.storage],
    ["Google", data.health.checks.googleOAuth],
    ["Mail", data.health.checks.mailProvider],
    ["Cron", data.health.checks.cron],
  ] as const;
  return (
    <AdminShell>
      <AdminPageHeader
        title="Overview"
        description="Your command center for platform health, product use, and work that needs attention."
        actions={
          <>
            <Link className="button secondary" href="/admin/users">
              Find user
            </Link>
            <Link
              className="button secondary"
              href="/admin/communications/system-notices"
            >
              Send notice
            </Link>
            <Link
              className="button"
              href="/admin/communications/product-updates"
            >
              Announce update
            </Link>
          </>
        }
      />
      <AdminMetricStrip
        items={[
          {
            label: "Total accounts",
            value: data.metrics.totalUsers,
            note: "Includes admins",
          },
          {
            label: "Product users active · 24h",
            value: data.metrics.activeUsers,
            note: "Latest activity",
          },
          {
            label: "Confirmed sends · 24h",
            value: data.metrics.confirmedSends,
          },
          {
            label: "Needs attention",
            value: data.metrics.needsAttention,
            tone: data.metrics.needsAttention ? "warning" : undefined,
          },
        ]}
      />
      <AdminSection
        title="Platform health"
        description={`Checked ${formatAdminInstant(data.health.timestamp)}`}
        action={<Link href="/admin/operations">Open operations →</Link>}
      >
        <div className={`${styles.panel} ${styles.healthGrid}`}>
          {healthChecks.map(([name, check]) => (
            <div className={styles.healthCell} key={name}>
              <strong>{name}</strong>
              <AdminStatusBadge
                status={check.status}
                tone={
                  check.status === "ok" || check.status === "configured"
                    ? "healthy"
                    : check.status === "down"
                      ? "danger"
                      : "warning"
                }
              />
            </div>
          ))}
        </div>
      </AdminSection>
      <div className={styles.twoColumn}>
        <AdminSection
          title="Needs attention"
          action={<Link href="/admin/operations">All operations →</Link>}
        >
          {data.attention.length ? (
            <ul className={`${styles.panel} ${styles.list}`}>
              {data.attention.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <Link href={item.href as Route}>
                    <AdminStatusBadge
                      status={item.tone === "danger" ? "Critical" : "Attention"}
                      tone={item.tone}
                    />{" "}
                    <strong>{item.label}</strong>
                  </Link>
                  <div className={styles.muted}>{item.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.successRow}>
              <CheckCircle2 size={17} aria-hidden="true" />
              No issues need attention
            </div>
          )}
        </AdminSection>
        <AdminSection
          title="Running now"
          description="Current operational states"
        >
          <div className={styles.panel}>
            <dl className={styles.dataList}>
              {data.running.map((item) => (
                <div className={styles.definitionRow} key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </div>
        </AdminSection>
      </div>
      <AdminSection
        title="Product pulse"
        description="A compact view of the last seven UTC days"
        action={
          <Link className={styles.sectionLink} href="/admin/analytics">
            Full analytics →
          </Link>
        }
      >
        <div className={`${styles.panel} ${styles.pulseLayout}`}>
          <div className={styles.pulsePrimary}>
            <div className={styles.pulseHeading}>
              <div>
                <span className={styles.pulseEyebrow}>
                  OUTREACH / LAST 7 DAYS
                </span>
                <div className={styles.pulseTotal}>
                  {pulseTotals.sends.toLocaleString()}
                </div>
                <p>Confirmed sends</p>
              </div>
              <span className={styles.pulsePeriod}>7D</span>
            </div>
            <AdminPulseBars data={data.pulse} />
          </div>
          <div
            className={styles.pulseAside}
            aria-label="Other product activity in the last 7 days"
          >
            <div className={styles.pulseStat} data-tone="blue">
              <span>Sequence launches</span>
              <strong>{pulseTotals.runs.toLocaleString()}</strong>
              <small>Last 7 days</small>
            </div>
            <div className={styles.pulseStat} data-tone="purple">
              <span>Discover searches</span>
              <strong>{pulseTotals.searches.toLocaleString()}</strong>
              <small>Last 7 days</small>
            </div>
            <div className={styles.pulseStat} data-tone="green">
              <span>New product users</span>
              <strong>{pulseTotals.users.toLocaleString()}</strong>
              <small>Last 7 days</small>
            </div>
          </div>
        </div>
      </AdminSection>
      <div className={`${styles.twoColumn} ${styles.overviewFeeds}`}>
        <AdminSection
          id="recent-admin-activity"
          title="Recent admin activity"
          action={
            <Link className={styles.sectionLink} href="/admin/audit">
              Audit & Security →
            </Link>
          }
        >
          {data.recentAdminEvents.length ? (
            <ul className={styles.overviewFeed}>
              {data.recentAdminEvents.map((event) => (
                <li key={event.id} className={styles.overviewFeedRow}>
                  <span className={styles.feedIcon} aria-hidden="true">
                    <History size={16} />
                  </span>
                  <span className={styles.feedCopy}>
                    <strong>
                      {formatAdminEventTitle(event.message, event.action)}
                    </strong>
                    <small>
                      {event.action.split(".")[0].replaceAll("_", " ")}
                    </small>
                  </span>
                  <time
                    dateTime={event.createdAt}
                    title={formatAdminInstant(event.createdAt)}
                  >
                    {formatAdminRelative(event.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.compactEmpty}>No admin events recorded yet.</p>
          )}
          <AdminCompactPager
            {...data.recentAdminPagination}
            href={(page) => pageHref("activity", page)}
            label="admin activity"
          />
        </AdminSection>
        <AdminSection
          id="recent-accounts"
          title="Recently joined accounts"
          action={
            <Link className={styles.sectionLink} href="/admin/users">
              All users →
            </Link>
          }
        >
          {data.recentAccounts.length ? (
            <ul className={styles.overviewFeed}>
              {data.recentAccounts.map((user) => (
                <li key={user.id} className={styles.overviewFeedRow}>
                  <span className={styles.feedIcon} aria-hidden="true">
                    <UserRound size={16} />
                  </span>
                  <span className={styles.feedCopy}>
                    <Link href={`/admin/users/${user.id}`} title={user.email}>
                      {user.email}
                    </Link>
                    <small>Joined {formatAdminDate(user.createdAt)}</small>
                  </span>
                  <time
                    dateTime={user.createdAt}
                    title={formatAdminInstant(user.createdAt)}
                  >
                    {formatAdminRelative(user.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.compactEmpty}>No accounts yet.</p>
          )}
          <AdminCompactPager
            {...data.recentAccountsPagination}
            href={(page) => pageHref("accounts", page)}
            label="recent accounts"
          />
        </AdminSection>
      </div>
    </AdminShell>
  );
}
