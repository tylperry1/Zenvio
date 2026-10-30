"use client";
import { useState } from "react";
import type { Question } from "@/lib/intake";
import { Icon } from "./icons";
import { EmptyState, Field } from "./ui";

const types: [Question["type"], string][] = [
  ["short_text", "Short answer"],
  ["long_text", "Paragraph"],
  ["single_choice", "Choose one"],
  ["multiple_choice", "Choose several"],
  ["checkbox", "Confirmation checkbox"],
];

export function IntakeEditor({
  event,
  onSave,
  onCancel,
  busy = false,
}: {
  event: { id: string; intake_questions: Question[] };
  onSave: (questions: Question[]) => Promise<unknown> | void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [questions, setQuestions] = useState<Question[]>(event.intake_questions);
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
                {["single_choice", "multiple_choice"].includes(q.type) && (
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
