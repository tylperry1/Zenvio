import { ApiError, string } from "./server";
export type Question = {
  id: string;
  label: string;
  type:
    | "short_text"
    | "long_text"
    | "single_choice"
    | "multiple_choice"
    | "checkbox";
  required: boolean;
  options: string[];
};
export function intakeQuestions(value: unknown): Question[] {
  if (!Array.isArray(value) || value.length > 15)
    throw new ApiError("Use up to 15 intake questions.");
  const q = value.map((v) => {
    const type = v?.type;
    if (
      ![
        "short_text",
        "long_text",
        "single_choice",
        "multiple_choice",
        "checkbox",
      ].includes(type)
    )
      throw new ApiError("Invalid question type.");
    const options = ["single_choice", "multiple_choice"].includes(type)
      ? Array.isArray(v.options)
        ? v.options.map((x: unknown) => string(x, "option", 100))
        : []
      : [];
    if (
      ["single_choice", "multiple_choice"].includes(type) &&
      (options.length < 2 ||
        options.length > 15 ||
        new Set(options).size !== options.length)
    )
      throw new ApiError("Choice questions need 2–15 distinct options.");
    return {
      id: string(v.id, "question ID", 64),
      label: string(v.label, "question", 200),
      type,
      required: v.required === true,
      options,
    } as Question;
  });
  if (new Set(q.map((v) => v.id)).size !== q.length)
    throw new ApiError("Question IDs must be unique.");
  return q;
}
export function intakeAnswers(questions: Question[], value: unknown) {
  const answers =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return questions.map((q) => {
    let answer: unknown = answers[q.id];
    if (q.type === "checkbox") {
      if (typeof answer !== "boolean") answer = false;
      if (q.required && answer !== true)
        throw new ApiError("Please confirm: " + q.label);
    } else if (q.type === "multiple_choice") {
      if (answer === undefined) answer = [];
      if (
        !Array.isArray(answer) ||
        answer.some((x) => !q.options.includes(x)) ||
        new Set(answer).size !== answer.length ||
        (q.required && !answer.length)
      )
        throw new ApiError("Please answer: " + q.label);
    } else {
      answer = string(
        answer || "",
        q.label,
        q.type === "long_text" ? 2000 : 200,
        q.required ? 1 : 0,
      );
      if (
        q.type === "single_choice" &&
        answer &&
        !q.options.includes(answer as string)
      )
        throw new ApiError("Choose a valid option for " + q.label);
    }
    return { ...q, answer };
  });
}
