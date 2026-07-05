function splitParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitSentences(paragraph) {
  const segmenter = new Intl.Segmenter("hr", { granularity: "sentence" });
  return Array.from(segmenter.segment(paragraph), (segment) => segment.segment.trim()).filter(Boolean);
}

export function buildStory({ title, level, text, folderId }) {
  const paragraphs = splitParagraphs(text);
  let sentenceNumber = 1;

  return {
    id: "",
    title: String(title || "").trim(),
    level: String(level || "").trim() || "A1",
    folderId: String(folderId || "").trim(),
    paragraphs: paragraphs.map((paragraph, paragraphIndex) => ({
      id: `p${String(paragraphIndex + 1).padStart(3, "0")}`,
      sentences: splitSentences(paragraph).map((sentence) => {
        const sentenceId = `s${String(sentenceNumber).padStart(3, "0")}`;
        sentenceNumber += 1;
        return {
          id: sentenceId,
          croatian: sentence
        };
      })
    }))
  };
}
