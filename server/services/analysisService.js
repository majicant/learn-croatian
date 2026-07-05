export function cleanAnalysis(raw) {
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((note) => String(note).trim()).filter(Boolean).slice(0, 3)
    : [];

  return {
    english: String(raw.english || "").trim(),
    notes
  };
}

export async function generateAnalysis({ croatian, level }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is not configured on the backend.");
    error.status = 503;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a concise Croatian reading assistant. Return only strict JSON with keys english and notes. Use 1-3 short notes. Keep explanations useful for a language learner."
        },
        {
          role: "user",
          content: `Level: ${level || "unknown"}\nCroatian sentence: ${croatian}`
        }
      ]
    })
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`OpenAI request failed: ${details}`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("OpenAI response did not include JSON content.");
    error.status = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const error = new Error("OpenAI response was not valid JSON.");
    error.status = 502;
    throw error;
  }

  const analysis = cleanAnalysis(parsed);
  if (!analysis.english) {
    const error = new Error("OpenAI response did not include an English translation.");
    error.status = 502;
    throw error;
  }
  return analysis;
}
