import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function WorkspaceOverviewPage() {
  const user = await requireUser();
  const [importCount, campaignCount, templateCount, suppressionCount, recentCampaigns] = await Promise.all([
    prisma.import.count({ where: { userId: user.id } }),
    prisma.campaign.count({ where: { userId: user.id } }),
    prisma.template.count({ where: { userId: user.id } }),
    prisma.suppression.count({ where: { userId: user.id } }),
    prisma.campaign.findMany({
      where: { userId: user.id },
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } }
    })
  ]);

  return (
    <>
      <section className="hero">
        <h1 style={{ marginTop: 0 }}>Overview</h1>
        <p className="muted">Track imports, templates, sequences, and recent sending activity.</p>
      </section>

      <section className="grid cols-4">
        {[
          ["Imports", importCount],
          ["Sequences", campaignCount],
          ["Templates", templateCount],
          ["Suppressions", suppressionCount]
        ].map(([label, value]) => (
          <article className="card metric-card" key={label}>
            <p className="muted">{label}</p>
            <p className="kpi">{value}</p>
          </article>
        ))}
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Recent sequences</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {recentCampaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>{campaign.name}</td>
                <td>
                  <span className="badge">{campaign.status}</span>
                </td>
                <td>{campaign.runs[0]?.status ?? "No runs yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
