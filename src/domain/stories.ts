import { READING_LEVELS } from "../constants";
import type { ImportPreview, Paragraph, Sentence, Story, StorySummary } from "../types";

export function splitPreview(text: string): ImportPreview {
  const sentencePattern = /[^.!?\u2026]+(?:[.!?\u2026]+["'")\]]*)?|[^.!?\u2026]+$/gu;
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => (paragraph.match(sentencePattern)?.map((sentence) => sentence.trim()) || []).filter(Boolean));

  return {
    paragraphs,
    sentenceCount: paragraphs.reduce((total, paragraph) => total + paragraph.length, 0)
  };
}

export function sentenceList(story: Story | null): Sentence[] {
  return story?.paragraphs.flatMap((paragraph) => paragraph.sentences) || [];
}

export function buildPages(paragraphs: Paragraph[]): Paragraph[][] {
  const pages: Paragraph[][] = [];
  let current: Paragraph[] = [];
  let sentenceCount = 0;
  let characterCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphSentences = paragraph.sentences.length;
    const paragraphCharacters = paragraph.sentences.reduce((total, sentence) => total + sentence.croatian.length, 0);
    const wouldOverflow = current.length > 0 && (sentenceCount + paragraphSentences > 14 || characterCount + paragraphCharacters > 2200);

    if (wouldOverflow) {
      pages.push(current);
      current = [];
      sentenceCount = 0;
      characterCount = 0;
    }

    current.push(paragraph);
    sentenceCount += paragraphSentences;
    characterCount += paragraphCharacters;
  }

  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

export function groupStoriesByLevel(stories: StorySummary[]) {
  const grouped = new Map<string, StorySummary[]>();
  for (const story of stories) {
    const level = story.level || "Other";
    grouped.set(level, [...(grouped.get(level) || []), story]);
  }

  return Array.from(grouped.entries()).sort(([a], [b]) => {
    const aIndex = READING_LEVELS.indexOf(a);
    const bIndex = READING_LEVELS.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    }
    return a.localeCompare(b, "hr");
  });
}

export function targetParts(sentence: string, target: string) {
  if (!target) return { before: sentence, target: "", after: "" };
  const index = sentence.indexOf(target);
  if (index === -1) return { before: sentence, target: "", after: "" };
  return {
    before: sentence.slice(0, index),
    target,
    after: sentence.slice(index + target.length)
  };
}
