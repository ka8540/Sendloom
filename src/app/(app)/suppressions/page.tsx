import { SuppressionForm } from "@/components/forms";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function SuppressionsPage() {
  const user = await requireOperatorUser();
  const suppressions = await prisma.suppression.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" }
  });

  return (
    <div className="split">
      <section className="card">
        <h1 style={{ marginTop: 0 }}>Suppressions</h1>
        <p className="muted">Blocked addresses will be skipped in future sends.</p>
        <SuppressionForm />
      </section>

      <section className="card">
        <h2>Suppressed recipients</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Reason</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {suppressions.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.email}</td>
                <td>
                  <span className="badge warning">{entry.reason}</span>
                </td>
                <td>{entry.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
