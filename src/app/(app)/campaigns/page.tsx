import Link from "next/link";

import { CampaignBuilder } from "@/components/campaign-builder";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function CampaignsPage() {
  const user = await requireUser();
  const [imports, mappings, templates, senders, campaigns] = await Promise.all([
    prisma.import.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.mapping.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.template.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    prisma.senderProfile.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" }
    }),
    prisma.campaign.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } }
    })
  ]);
  const latestMappings = new Map<string, (typeof mappings)[number]>();

  for (const mapping of mappings) {
    if (!latestMappings.has(mapping.importId)) {
      latestMappings.set(mapping.importId, mapping);
    }
  }

  return (
    <div className="stack">
      <section className="split">
        <article className="card">
          <h1 style={{ marginTop: 0 }}>Create a sending sequence</h1>
          <p className="muted">Choose an audience, template, sender, and delivery schedule.</p>
          <CampaignBuilder
            imports={imports.map((entry) => ({ id: entry.id, label: entry.fileName }))}
            mappings={imports.flatMap((entry) => {
              const mapping = latestMappings.get(entry.id);
              if (!mapping) {
                return [];
              }

              return [
                {
                  id: mapping.id,
                  importId: entry.id,
                  label: `${entry.fileName} field set`
                }
              ];
            })}
            templates={templates.map((entry) => ({ id: entry.id, label: entry.name }))}
            senders={senders.map((entry) => ({ id: entry.id, label: `${entry.name} <${entry.fromEmail}>` }))}
          />
        </article>

        <article className="card">
          <h2 style={{ marginTop: 0 }}>Connected mailbox</h2>
          <p className="muted">Sequences send from the Gmail accounts connected here.</p>
          <div className="stack">
            {senders.length ? (
              senders.map((sender) => (
                <div key={sender.id} className="mini-step">
                  <strong>{sender.name}</strong>
                  <div className="muted">{sender.fromEmail}</div>
                </div>
              ))
            ) : (
              <div className="surface-note">Connect a Gmail account to send emails.</div>
            )}
            <a className="button" href="/api/auth/google/connect">
              {senders.length ? "Connect another Gmail" : "Connect Gmail"}
            </a>
          </div>
        </article>
      </section>

      <section className="card">
        <h2>Sequences</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Delivery</th>
              <th>Last run</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>
                  <Link href={`/campaigns/${campaign.id}`} style={{ color: "var(--accent)", fontWeight: 700 }}>
                    {campaign.name}
                  </Link>
                </td>
                <td>
                  <span className="badge">{campaign.status}</span>
                </td>
                <td>{campaign.scheduleType === "immediate" ? "Send now" : campaign.scheduleType ?? "Send now"}</td>
                <td>{campaign.runs[0]?.status ?? "Waiting to launch"}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <Link className="button secondary" href={`/campaigns/${campaign.id}`}>
                      Open
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
