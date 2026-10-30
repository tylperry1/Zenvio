"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Card, EmptyState, Skeleton } from "./ui";
type Signup = { id: string; name: string; email: string; plan: string; seats: number; created_at: string; confirmation_status: string | null };
export function EarlyAccessAdmin() {
  const [page, setPage] = useState(0),
    [data, setData] = useState<{ signups: Signup[]; total: number } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    fetch("/api/admin/early-access?page=" + page, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [page]);
  return (
    <main className="ea-admin">
      <header className="page-header">
        <div>
          <h1>Early-access signups</h1>
          <p>
            Reservations for 50% off the first three monthly payments at launch. No payment is collected. New
            reservations get a confirmation email; launch announcements are sent separately.
          </p>
        </div>
        {data && <Badge tone="info">{data.total} reservations</Badge>}
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card flush>
        {!data && !error && <Skeleton rows={4} />}
        {data && !data.total && (
          <EmptyState icon="users" title="No signups yet">
            People who reserve the launch offer on the early-access page appear here.
          </EmptyState>
        )}
        {data && data.total > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Interest</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Confirmation</th>
                </tr>
              </thead>
              <tbody>
                {data.signups.map((s) => (
                  <tr key={s.id}>
                    <td className="ui-cell-strong">{s.name}</td>
                    <td>{s.email}</td>
                    <td>
                      <Badge tone="info">{s.plan === "team" ? "Teams" : s.plan === "individual" ? "Individual" : s.plan}</Badge>
                    </td>
                    <td>{s.seats}</td>
                    <td>{new Date(s.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td>
                      <Badge tone={s.confirmation_status === "sent" ? "success" : s.confirmation_status === "failed" ? "danger" : "neutral"}>
                        {s.confirmation_status === "sent"
                          ? "Sent"
                          : s.confirmation_status
                            ? s.confirmation_status[0].toUpperCase() + s.confirmation_status.slice(1)
                            : "Before confirmations"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 50 && (
          <div className="client-pagination">
            <span>
              Page {page + 1} of {Math.ceil(data.total / 50)}
            </span>
            <button className="ui-btn ui-btn-secondary ui-btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button
              className="ui-btn ui-btn-secondary ui-btn-sm"
              disabled={(page + 1) * 50 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </main>
  );
}
