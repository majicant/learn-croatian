import { READING_LEVELS } from "../constants";
import type { ImportPreview, Paragraph, Sentence, Story, StoryFolder, StorySummary } from "../types";

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

const PAGE_TARGET_SENTENCES = 18;
const PAGE_MAX_SENTENCES = 22;
const PAGE_TARGET_CHARACTERS = 2200;
const PAGE_MAX_CHARACTERS = 2600;
const PAGE_TARGET_LINES = 30;
const PAGE_MAX_LINES = 36;
const PAGE_MIN_LINES = 16;
const PAGE_MIN_CHARACTERS = 1200;
const ESTIMATED_CHARACTERS_PER_LINE = 76;
const PARAGRAPH_BREAK_LINES = 0.5;

type PageDraft = {
  paragraphs: Paragraph[];
  sentenceCount: number;
  characterCount: number;
  lineCount: number;
  openParagraphId: string;
};

type PageCost = {
  characters: number;
  lines: number;
};

function emptyPageDraft(): PageDraft {
  return {
    paragraphs: [],
    sentenceCount: 0,
    characterCount: 0,
    lineCount: 0,
    openParagraphId: ""
  };
}

function sentenceCharacters(sentence: Sentence) {
  return sentence.croatian.trim().length;
}

function sentenceLineCount(sentence: Sentence) {
  return Math.max(1, Math.ceil(sentenceCharacters(sentence) / ESTIMATED_CHARACTERS_PER_LINE));
}

function pageCost(page: PageDraft, paragraph: Paragraph, sentence: Sentence): PageCost {
  const startsNewParagraph = page.sentenceCount > 0 && page.openParagraphId !== paragraph.id;
  return {
    characters: sentenceCharacters(sentence),
    lines: sentenceLineCount(sentence) + (startsNewParagraph ? PARAGRAPH_BREAK_LINES : 0)
  };
}

function shouldStartNewPage(page: PageDraft, cost: PageCost) {
  if (page.sentenceCount === 0) return false;

  const nextSentenceCount = page.sentenceCount + 1;
  const nextCharacterCount = page.characterCount + cost.characters;
  const nextLineCount = page.lineCount + cost.lines;
  const pageHasUsefulSize =
    page.lineCount >= PAGE_MIN_LINES ||
    page.characterCount >= PAGE_MIN_CHARACTERS ||
    page.sentenceCount >= PAGE_TARGET_SENTENCES;

  return (
    nextSentenceCount > PAGE_MAX_SENTENCES ||
    nextCharacterCount > PAGE_MAX_CHARACTERS ||
    nextLineCount > PAGE_MAX_LINES ||
    (pageHasUsefulSize &&
      (nextSentenceCount > PAGE_TARGET_SENTENCES ||
        nextCharacterCount > PAGE_TARGET_CHARACTERS ||
        nextLineCount > PAGE_TARGET_LINES))
  );
}

function appendSentence(page: PageDraft, paragraph: Paragraph, sentence: Sentence, cost: PageCost) {
  let currentParagraph = page.paragraphs[page.paragraphs.length - 1];
  if (!currentParagraph || page.openParagraphId !== paragraph.id) {
    currentParagraph = {
      id: `${paragraph.id}:${sentence.id}`,
      sentences: []
    };
    page.paragraphs.push(currentParagraph);
    page.openParagraphId = paragraph.id;
  }

  currentParagraph.sentences.push(sentence);
  page.sentenceCount += 1;
  page.characterCount += cost.characters;
  page.lineCount += cost.lines;
}

export function buildPages(paragraphs: Paragraph[]): Paragraph[][] {
  const pages: Paragraph[][] = [];
  let current = emptyPageDraft();

  for (const paragraph of paragraphs) {
    for (const sentence of paragraph.sentences) {
      let cost = pageCost(current, paragraph, sentence);
      if (shouldStartNewPage(current, cost)) {
        pages.push(current.paragraphs);
        current = emptyPageDraft();
        cost = pageCost(current, paragraph, sentence);
      }

      appendSentence(current, paragraph, sentence, cost);
    }
  }

  if (current.sentenceCount) pages.push(current.paragraphs);
  return pages.length ? pages : [[]];
}

export function groupStoriesByLevel(stories: StorySummary[]) {
  const grouped = new Map<string, StorySummary[]>();
  for (const level of READING_LEVELS) {
    grouped.set(level, []);
  }

  for (const story of stories) {
    const level = story.level || "Other";
    grouped.set(level, [...(grouped.get(level) || []), story]);
  }

  return Array.from(grouped.entries()).map(
    ([level, levelStories]) =>
      [level, [...levelStories].sort((a, b) => a.title.localeCompare(b.title, "hr"))] as [string, StorySummary[]]
  ).sort(([a], [b]) => {
    const aIndex = READING_LEVELS.indexOf(a);
    const bIndex = READING_LEVELS.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    }
    return a.localeCompare(b, "hr");
  });
}

export function groupStoriesByFolder(stories: StorySummary[], folders: StoryFolder[]) {
  const storiesByFolder = new Map<string, StorySummary[]>();
  for (const story of stories) {
    const folderId = story.folderId;
    storiesByFolder.set(folderId, [...(storiesByFolder.get(folderId) || []), story]);
  }

  const sortStories = (items: StorySummary[]) =>
    [...items].sort((a, b) => a.title.localeCompare(b.title, "hr"));

  const unfiledStories = sortStories(storiesByFolder.get("") || []);
  const groups: Array<[StoryFolder, StorySummary[]]> = [];

  groups.push([{ id: "", name: "Unfiled" }, unfiledStories]);

  for (const folder of folders) {
    groups.push([folder, sortStories(storiesByFolder.get(folder.id) || [])]);
  }

  return groups;
}

export function targetParts(sentence: string, target: string, targetStart?: number, targetEnd?: number) {
  if (!target || !Number.isInteger(targetStart) || !Number.isInteger(targetEnd)) {
    return { before: sentence, target: "", after: "" };
  }

  const start = targetStart as number;
  const end = targetEnd as number;
  if (start < 0 || end <= start || end > sentence.length || sentence.slice(start, end) !== target) {
    return { before: sentence, target: "", after: "" };
  }

  return {
    before: sentence.slice(0, start),
    target: sentence.slice(start, end),
    after: sentence.slice(end)
  };
}
