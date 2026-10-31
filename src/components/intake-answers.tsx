"use client";
import type { Question } from "@/lib/intake";

type Answer = Question & { answer: unknown };
// Intake answers as the host sees them. File answers link to the host-only download route.
export function IntakeAnswers({ answers, className = "client-answers" }: { answers?: Answer[] | null; className?: string }) {
  const shown = (answers || []).filter((q) => q.answer !== "" && !(Array.isArray(q.answer) && !q.answer.length));
  if (!shown.length) return null;
  return (
    <dl className={className}>
      {shown.map((q) => (
        <div key={q.id}>
          <dt>{q.label}</dt>
          <dd>
            {q.type === "file" && Array.isArray(q.answer)
              ? (q.answer as { id: string; filename: string }[]).map((f) =>
                  typeof f === "object" && f ? (
                    <a key={f.id} href={`/api/uploads?id=${f.id}`} className="intake-file-link">
                      {f.filename}
                    </a>
                  ) : null,
                )
              : typeof q.answer === "boolean"
                ? q.answer
                  ? "Yes"
                  : "No"
                : Array.isArray(q.answer)
                  ? q.answer.join(", ")
                  : String(q.answer)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
