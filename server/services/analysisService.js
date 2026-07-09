function cleanSuggestionText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

const SYSTEM_PROMPT = [
  "You are a concise Croatian reading assistant for sentence mining.",
  "Return only strict JSON with this exact shape: {\"english\": string, \"notes\": string[], \"suggestedCards\": [{\"croatian\": string, \"english\": string}]}. Do not include markdown, comments, extra text, or extra keys.",
  "Translate only the selected Croatian sentence into natural English, capturing the same meaning instead of translating word for word.",
  "Use the story title and neighboring sentences only to resolve context such as pronouns, dropped subjects, referents, and idioms. Do not add details that are not clearly supported; translate ambiguous referents neutrally.",
  "notes should contain 1-3 short, useful learner notes about grammar, vocabulary, or phrasing in the selected sentence.",
  "suggestedCards should split the selected sentence into as many or as few ordered card chunks as needed. Use one chunk for a short sentence or when splitting would make the chunks awkward.",
  "The Croatian chunks should work together as a clean breakdown of the whole selected sentence: keep them in sentence order, do not overlap them, and do not skip any words. Boundary punctuation may be omitted.",
  "Each suggestedCards.croatian value must be one contiguous fragment copied exactly from the selected sentence, and each suggestedCards.english value must be a natural translation of that fragment in context.",
  "Choose chunks that express one usable piece of meaning and break at natural phrase or clause boundaries. Prefer medium-length chunks over single words or tiny fragments.",
  "Each chunk must be grammatically coherent in Croatian. Do not split inside one predicate: keep auxiliary forms such as sam, si, je, smo, ste, su, bih, bi, bismo, and biste with their main verb or participle, even when other words, appositives, adverbs, or commas appear between them.",
  "Keep subjects with predicates when needed, verbs with their complements, clitics and reflexives with their hosts, negation with the verb or phrase it negates, and prepositions with their objects.",
  "Do not split just because there is a comma if the words on both sides still belong to the same grammatical unit.",
  "Prefer a larger coherent chunk over a smaller fragment that is trivial, misleading, ungrammatical, or dependent on missing words."
].join(" ");

function promptLine(value) {
  return String(value || "").trim().replace(/\s+/g, " ") || "none";
}

function buildAnalysisPrompt({ croatian, level, storyTitle, previousCroatian, nextCroatian }) {
  return [
    `Story title: ${promptLine(storyTitle)}`,
    `Level: ${promptLine(level || "unknown")}`,
    `Previous sentence: ${promptLine(previousCroatian)}`,
    `Selected Croatian sentence: ${promptLine(croatian)}`,
    `Next sentence: ${promptLine(nextCroatian)}`
  ].join("\n");
}

function cleanAnalysis(raw, sourceCroatian) {
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((note) => String(note).trim()).filter(Boolean).slice(0, 3)
    : [];
  const source = String(sourceCroatian);
  const seenSuggestions = new Set();
  const suggestedCards = Array.isArray(raw.suggestedCards)
    ? raw.suggestedCards
        .map((item) => ({
          croatian: cleanSuggestionText(item?.croatian),
          english: cleanSuggestionText(item?.english)
        }))
        .filter((item) => {
          if (!item.croatian || !item.english) return false;
          if (source && !source.includes(item.croatian)) return false;
          const key = item.croatian.toLocaleLowerCase("hr");
          if (seenSuggestions.has(key)) return false;
          seenSuggestions.add(key);
          return true;
        })
    : [];

  return {
    english: String(raw.english || "").trim(),
    notes,
    suggestedCards
  };
}

export async function generateAnalysis({ croatian, level, storyTitle, previousCroatian, nextCroatian }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

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
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: buildAnalysisPrompt({ croatian, level, storyTitle, previousCroatian, nextCroatian })
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

  const analysis = cleanAnalysis(parsed, croatian);
  if (!analysis.english) {
    const error = new Error("OpenAI response did not include an English translation.");
    error.status = 502;
    throw error;
  }
  return analysis;
}
