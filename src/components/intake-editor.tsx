"use client";
import { useState } from "react";
import type { Question } from "@/lib/intake";
export function IntakeEditor({
  event,
  onSave,
}: {
  event: { id: string; intake_questions: Question[] };
  onSave: (questions: Question[]) => Promise<void>;
}) {
  const [questions, setQuestions] = useState<Question[]>(
    event.intake_questions,
  );
  const edit = (id: string, v: Partial<Question>) =>
    setQuestions(questions.map((q) => (q.id === id ? { ...q, ...v } : q)));
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(questions);
      }}
    >
      {questions.map((q, i) => (
        <fieldset key={q.id}>
          <legend>Question {i + 1}</legend>
          <label>
            Question
            <input
              required
              maxLength={200}
              value={q.label}
              onChange={(e) => edit(q.id, { label: e.target.value })}
            />
          </label>
          <label>
            Answer type
            <select
              value={q.type}
              onChange={(e) =>
                edit(q.id, { type: e.target.value as Question["type"] })
              }
            >
              {[
                ["short_text", "Short answer"],
                ["long_text", "Paragraph"],
                ["single_choice", "Choose one"],
                ["multiple_choice", "Choose several"],
                ["checkbox", "Confirmation checkbox"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {["single_choice", "multiple_choice"].includes(q.type) && (
            <label>
              Options · one per line
              <textarea
                value={q.options.join("\n")}
                onChange={(e) =>
                  edit(q.id, { options: e.target.value.split("\n") })
                }
              />
            </label>
          )}
          <label className="document-checkbox">
            <input
              type="checkbox"
              checked={q.required}
              onChange={(e) => edit(q.id, { required: e.target.checked })}
            />
            Required
          </label>
          <button
            type="button"
            className="billing-secondary"
            onClick={() => setQuestions(questions.filter((x) => x.id !== q.id))}
          >
            Remove question
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="billing-secondary"
        disabled={questions.length >= 15}
        onClick={() =>
          setQuestions([
            ...questions,
            {
              id: crypto.randomUUID(),
              label: "",
              type: "short_text",
              required: false,
              options: [],
            },
          ])
        }
      >
        + Add question
      </button>
      <button>Save intake form</button>
    </form>
  );
}
