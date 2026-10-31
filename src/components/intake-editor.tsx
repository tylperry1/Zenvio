"use client";
import { useEffect, useState } from "react";
import type { Question } from "@/lib/intake";
import { Icon } from "./icons";
import { EmptyState, Field } from "./ui";
import { contractorIndustry, contractorIntakeTemplate } from "@/lib/contractor";

const types: [Question["type"], string][] = [
  ["short_text", "Short answer"],
  ["long_text", "Paragraph"],
  ["single_choice", "Choose one"],
  ["dropdown", "Dropdown (services, categories)"],
  ["multiple_choice", "Choose several"],
  ["checkbox", "Confirmation checkbox"],
  ["phone", "Phone number"],
  ["address", "Address"],
  ["file", "File or photo upload"],
  ["consent", "Consent statement"],
];

export function IntakeEditor({
  event,
  onSave,
  onCancel,
  busy = false,
  industry: initialIndustry,
}: {
  event: { id: string; intake_questions: Question[] };
  industry?: string;
  onSave: (questions: Question[]) => Promise<unknown> | void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [questions, setQuestions] = useState<Question[]>(event.intake_questions);
  const [industry, setIndustry] = useState(initialIndustry);
  useEffect(() => {
    if (initialIndustry) return;
    // Trade businesses get a ready-made job intake template.
    fetch("/api/profile/details", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.industry && setIndustry(d.industry))
      .catch(() => {});
  }, [initialIndustry]);
  const edit = (id: string, v: Partial<Question>) =>
    setQuestions(questions.map((q) => (q.id === id ? { ...q, ...v } : q)));
  const move = (index: number, by: number) => {
    const next = [...questions];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setQuestions(next);
  };
  const add = () =>
    setQuestions([
      ...questions,
      { id: crypto.randomUUID(), label: "", type: "short_text", required: false, options: [] },
    ]);
  return (
    <form
      className="intake-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(
          questions.map((q) => ({ ...q, options: q.options.map((o) => o.trim()).filter(Boolean) })),
        );
      }}
    >
      {!questions.length ? (
        <EmptyState icon="file" title="No intake questions yet">
          Ask guests for the details you need before you meet — they answer while booking.
        </EmptyState>
      ) : (
        <ol className="intake-list">
          {questions.map((q, i) => (
            <li key={q.id}>
              <div className="intake-row-head">
                <span className="intake-index">{i + 1}</span>
                <div className="intake-row-tools">
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-icon"
                    aria-label="Move question up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <Icon name="chevron" size={15} style={{ transform: "rotate(-90deg)" }} />
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-icon"
                    aria-label="Move question down"
                    disabled={i === questions.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <Icon name="chevron" size={15} style={{ transform: "rotate(90deg)" }} />
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-icon"
                    aria-label="Remove question"
                    onClick={() => setQuestions(questions.filter((x) => x.id !== q.id))}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              </div>
              <div className="ui-form-grid">
                <Field label="Question" wide>
                  <input
                    required
                    maxLength={200}
                    value={q.label}
                    placeholder="e.g. What would you like to discuss?"
                    onChange={(e) => edit(q.id, { label: e.target.value })}
                  />
                </Field>
                <Field label="Answer type">
                  <select
                    value={q.type}
                    onChange={(e) => edit(q.id, { type: e.target.value as Question["type"] })}
                  >
                    {types.map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="intake-required">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => edit(q.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                {q.type === "file" && (
                  <p className="ui-hint intake-type-note">
                    Guests can attach up to 5 photos or PDFs (5 MB each). Not available on paid appointment types.
                  </p>
                )}
                {q.type === "consent" && (
                  <p className="ui-hint intake-type-note">Write the full statement as the question; guests tick a box to agree.</p>
                )}
                {["single_choice", "multiple_choice", "dropdown"].includes(q.type) && (
                  <Field label="Options" hint="One per line" wide>
                    <textarea
                      rows={3}
                      value={q.options.join("\n")}
                      onChange={(e) => edit(q.id, { options: e.target.value.split("\n") })}
                    />
                  </Field>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="intake-footer">
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-sm"
          disabled={questions.length >= 15}
          onClick={add}
        >
          <Icon name="plus" size={14} /> Add question
        </button>
        {industry && contractorIndustry(industry) && (
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            onClick={() => {
              const template = contractorIntakeTemplate(industry);
              const existing = new Set(questions.map((q) => q.id));
              setQuestions([...questions, ...template.filter((q) => !existing.has(q.id))].slice(0, 15));
            }}
          >
            <Icon name="briefcase" size={14} /> Add job intake template
          </button>
        )}
        <span className="ui-hint">{questions.length} of 15</span>
        <div className="intake-footer-actions">
          {onCancel && (
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="ui-btn ui-btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save questions"}
          </button>
        </div>
      </div>
    </form>
  );
}
