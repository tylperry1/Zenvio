"use client";
import { useEffect, useState } from "react";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Pagination, Panel, Skeleton, formatDate, relativeTime, type Tone } from "./ds";

type Signup = { id: string; name: string; email: string; plan: string; seats: number; created_at: string; confirmation_status: string | null };
type Stats = { total: number; individual: number; team: number; team_seats: number; claimed: number; last_7d: number; sent: number; failed: number };

function confirmation(status: string | null): [Tone, string] {
  if (status === "sent") return ["success", "Sent"];
  if (status === "failed" || status === "uncertain") return ["danger", status === "failed" ? "Failed" : "Needs review"];
  if (status) return ["neutral", status[0].toUpperCase() + status.slice(1)];
  return ["neutral", "Before confirmations"];
}

export function EarlyAccessAdmin() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ signups: Signup[]; total: number; stats: Stats } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    fetch("/api/admin/early-access?page=" + page, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setData(d);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [page]);
  const s = data?.stats;
  return (
    <div className="ds-root ea">
      <PageHeader
        title="Early-access signups"
        description="Reservations for 50% off the first three monthly payments at launch. No payment is collected; each new reservation gets a confirmation email. Launch announcements are sent separately."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="ds-kpis">
        <Kpi label="Reservations" icon="users" loading={!s} value={s?.total.toLocaleString()} detail={s ? `${s.last_7d} in the last 7 days` : undefined} />
        <Kpi label="Individual interest" icon="contact" loading={!s} value={s?.individual.toLocaleString()} detail="Single-host workspaces" />
        <Kpi label="Teams interest" icon="team" loading={!s} value={s?.team.toLocaleString()} detail={s ? `${s.team_seats.toLocaleString()} seats expected` : undefined} />
        <Kpi
          label="Confirmation emails"
          icon="mail"
          loading={!s}
          tone={s?.failed ? "warning" : undefined}
          value={s?.sent.toLocaleString()}
          detail={s ? (s.failed ? `${s.failed} need attention` : `${s.claimed} reservations claimed at signup`) : undefined}
        />
      </div>
      <Panel flush title="Reservations" description="Newest first. The same email must be used at launch to claim the offer.">
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Interest</th>
                <th className="num">Seats</th>
                <th>Joined</th>
                <th>Confirmation</th>
              </tr>
            </thead>
            <tbody>
              {!data && !error
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={i}>
                      {[0, 1, 2, 3, 4].map((c) => (
                        <td key={c}><Skeleton width="70%" /></td>
                      ))}
                    </tr>
                  ))
                : data?.signups.map((r) => {
                    const [tone, text] = confirmation(r.confirmation_status);
                    return (
                      <tr key={r.id}>
                        <td>
                          <div className="ds-person">
                            <span className="ds-avatar">{r.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()}</span>
                            <span>
                              <b>{r.name}</b>
                              <small>{r.email}</small>
                            </span>
                          </div>
                        </td>
                        <td><Badge tone={r.plan === "team" ? "info" : "neutral"}>{r.plan === "team" ? "Teams" : r.plan === "individual" ? "Individual" : r.plan}</Badge></td>
                        <td className="num">{r.seats}</td>
                        <td title={formatDate(r.created_at, { dateStyle: "medium", timeStyle: "short" })}>{relativeTime(r.created_at)}</td>
                        <td><Badge tone={tone} dot>{text}</Badge></td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {data && !data.total && (
            <EmptyState icon="users" title="No signups yet">
              People who reserve the launch offer on the early-access page appear here.
            </EmptyState>
          )}
        </div>
        {data && data.total > 0 && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
      </Panel>
    </div>
  );
}
