// Minimal Gemini REST client (free tier via Google AI Studio key). Returns parsed JSON
// that follows the given response schema, or throws.
const API = "https://generativelanguage.googleapis.com/v1beta/models";

export const geminiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

const models = () =>
  [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest"].filter(
    (m, i, a): m is string => Boolean(m) && a.indexOf(m) === i,
  );

let workingModel: string | undefined;

export async function geminiJson<T>(opts: {
  system: string;
  prompt: string;
  schema: object;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ data: T; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const order = workingModel ? [workingModel, ...models().filter((m) => m !== workingModel)] : models();
  const errors: string[] = [];
  for (const model of order) {
    try {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25000),
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          generationConfig: {
            temperature: opts.temperature ?? 0.2,
            responseMimeType: "application/json",
            responseSchema: opts.schema,
          },
        }),
      });
      if (res.status === 404 || res.status === 400) {
        errors.push(`${model}: ${res.status} ${(await res.text()).slice(0, 160)}`);
        continue;
      }
      if (!res.ok) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      workingModel = model;
      return { data: JSON.parse(text) as T, model };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      // rate limits and timeouts: try the next (often lighter) model
    }
  }
  throw new Error(errors.join(" | "));
}
