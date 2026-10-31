import { ApiError, string } from "./server";
export const questionTypes = [
  "short_text",
  "long_text",
  "single_choice",
  "dropdown",
  "multiple_choice",
  "checkbox",
  "phone",
  "address",
  "file",
  "consent",
] as const;
export type Question = {
  id: string;
  label: string;
  type: (typeof questionTypes)[number];
  required: boolean;
  options: string[];
  includeInCalendar?: boolean;
};
const choice = (type: string) => ["single_choice", "multiple_choice", "dropdown"].includes(type);
export const MAX_UPLOADS_PER_QUESTION = 5;
export function intakeQuestions(value: unknown): Question[] {
  if (!Array.isArray(value) || value.length > 15)
    throw new ApiError("Use up to 15 intake questions.");
  const q = value.map((v) => {
    const type = v?.type;
    if (!questionTypes.includes(type)) throw new ApiError("Invalid question type.");
    const options = choice(type)
      ? Array.isArray(v.options)
        ? v.options.map((x: unknown) => string(x, "option", 100))
        : []
      : [];
    if (
      choice(type) &&
      (options.length < 2 ||
        options.length > (type === "dropdown" ? 30 : 15) ||
        new Set(options).size !== options.length)
    )
      throw new ApiError(
        type === "dropdown"
          ? "Dropdown questions need 2–30 distinct options."
          : "Choice questions need 2–15 distinct options.",
      );
    return {
      id: string(v.id, "question ID", 64),
      label: string(v.label, "question", 200),
      type,
      required: v.required === true,
      options,
      ...(v.includeInCalendar===true?{includeInCalendar:true}:{}),
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
    if (q.type === "checkbox" || q.type === "consent") {
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
    } else if (q.type === "file") {
      // Upload ids issued by /api/intake/upload; the booking route checks they belong to this visit.
      if (answer === undefined || answer === null || answer === "") answer = [];
      if (
        !Array.isArray(answer) ||
        answer.length > MAX_UPLOADS_PER_QUESTION ||
        answer.some((x) => typeof x !== "string" || !/^[a-f0-9-]{36}$/i.test(x)) ||
        (q.required && !answer.length)
      )
        throw new ApiError("Please add a file for: " + q.label);
    } else {
      answer = string(
        answer || "",
        q.label,
        q.type === "long_text" ? 2000 : q.type === "address" ? 300 : q.type === "phone" ? 40 : 200,
        q.required ? 1 : 0,
      );
      if (q.type === "phone" && answer && !/^\+?[\d\s().-]{7,25}$/.test(answer as string))
        throw new ApiError("Enter a valid phone number for " + q.label);
      if (
        (q.type === "single_choice" || q.type === "dropdown") &&
        answer &&
        !q.options.includes(answer as string)
      )
        throw new ApiError("Choose a valid option for " + q.label);
    }
    return { ...q, answer };
  });
}
