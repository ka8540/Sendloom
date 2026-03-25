import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { launchCampaign, validateCampaign } from "@/services/campaigns";

type CampaignTemplateSnapshot = {
  attachments?: Array<{
    fileName: string;
  }>;
};

async function launch(campaignId: string) {
  "use server";

  const user = await requireUser();
  await launchCampaign(campaignId, user.id);
}

async function validate(campaignId: string) {
  "use server";

  const user = await requireUser();
  await validateCampaign(campaignId, user.id);
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: {
      id,
      userId: user.id
    },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        include: {
          recipientJobs: {
            take: 50,
            orderBy: { updatedAt: "desc" }
          }
        }
      }
    }
  });

  const latestRun = campaign.runs[0];
  const attachments = ((campaign.templateSnapshot as CampaignTemplateSnapshot).attachments ?? []).filter(
    (attachment) => attachment.fileName
  );

  return (
    <div className="stack">
      <section className="hero">
        <h1 style={{ marginTop: 0 }}>{campaign.name}</h1>
        <p className="muted">Status, delivery results, and recent recipient jobs.</p>
        <div>
          <span className="badge">{campaign.status}</span>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <form action={validate.bind(null, campaign.id)}>
            <button className="button secondary" type="submit">
              Validate sequence
            </button>
          </form>
          <form action={launch.bind(null, campaign.id)}>
            <button className="button" type="submit">
              Launch sequence
            </button>
          </form>
        </div>
      </section>

      <section className="grid cols-3">
        <article className="card metric-card">
          <p className="muted">Total recipients</p>
          <p className="kpi">{latestRun?.totalRecipients ?? 0}</p>
        </article>
        <article className="card metric-card">
          <p className="muted">Sent</p>
          <p className="kpi">{latestRun?.sentCount ?? 0}</p>
        </article>
        <article className="card metric-card">
          <p className="muted">Failed</p>
          <p className="kpi">{latestRun?.failedCount ?? 0}</p>
        </article>
      </section>

      {attachments.length ? (
        <section className="card">
          <h2>Attached file</h2>
          <div className="pill-row">
            {attachments.map((attachment) => (
              <span key={attachment.fileName} className="pill">
                {attachment.fileName}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Recent recipient jobs</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {latestRun?.recipientJobs.map((job) => (
              <tr key={job.id}>
                <td>{job.recipientEmail}</td>
                <td>
                  <span className="badge">{job.status}</span>
                </td>
                <td>{job.lastError ?? "None"}</td>
              </tr>
            )) ?? null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
