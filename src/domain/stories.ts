import { READING_LEVELS } from "../constants";
import type { ImportPreview, Paragraph, Sentence, Story, StoryFolder, StorySummary } from "../types";

const croatianNaturalCollator = new Intl.Collator("hr", { numeric: true });

function compareStoryTitles(a: StorySummary, b: StorySummary) {
  return croatianNaturalCollator.compare(a.title, b.title);
}

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
      [level, [...levelStories].sort(compareStoryTitles)] as [string, StorySummary[]]
  ).sort(([a], [b]) => {
    const aIndex = READING_LEVELS.indexOf(a);
    const bIndex = READING_LEVELS.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    }
    return a.localeCompare(b, "hr");
  });
}

export type FolderTreeNode = {
  folder: StoryFolder;
  stories: StorySummary[];
  children: FolderTreeNode[];
  depth: number;
  storyCount: number;
  pathLabel: string;
};

function cleanFolderId(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function parentFolderId(folderId: string) {
  const cleanId = cleanFolderId(folderId);
  if (!cleanId.includes("/")) return "";
  return cleanId.slice(0, cleanId.lastIndexOf("/"));
}

export function isSameOrDescendantFolder(folderId: string, ancestorId: string) {
  const cleanId = cleanFolderId(folderId);
  const cleanAncestorId = cleanFolderId(ancestorId);
  return Boolean(cleanAncestorId && (cleanId === cleanAncestorId || cleanId.startsWith(`${cleanAncestorId}/`)));
}

function normalizeFolders(folders: StoryFolder[]) {
  return folders.map((folder) => {
    const id = cleanFolderId(folder.id);
    return {
      ...folder,
      id,
      parentId: cleanFolderId(folder.parentId || parentFolderId(id))
    };
  });
}

export function buildFolderTree(stories: StorySummary[], folders: StoryFolder[]) {
  const normalizedFolders = normalizeFolders(folders);
  const folderById = new Map(normalizedFolders.map((folder) => [folder.id, folder]));
  const storiesByFolder = new Map<string, StorySummary[]>();

  for (const story of stories) {
    const folderId = cleanFolderId(story.folderId);
    const visibleFolderId = folderId && folderById.has(folderId) ? folderId : "";
    storiesByFolder.set(visibleFolderId, [...(storiesByFolder.get(visibleFolderId) || []), story]);
  }

  const sortStories = (items: StorySummary[]) =>
    [...items].sort(compareStoryTitles);
  const sortFolders = (items: StoryFolder[]) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name, "hr") || a.id.localeCompare(b.id, "hr"));

  const childrenByParent = new Map<string, StoryFolder[]>();
  for (const folder of normalizedFolders) {
    const parentId = folder.parentId && folderById.has(folder.parentId) ? folder.parentId : "";
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), folder]);
  }

  function makeNode(folder: StoryFolder, depth: number, ancestorNames: string[]): FolderTreeNode {
    const pathNames = [...ancestorNames, folder.name];
    const children = sortFolders(childrenByParent.get(folder.id) || []).map((child) =>
      makeNode(child, depth + 1, pathNames)
    );
    const directStories = sortStories(storiesByFolder.get(folder.id) || []);

    return {
      folder,
      stories: directStories,
      children,
      depth,
      storyCount: directStories.length + children.reduce((total, child) => total + child.storyCount, 0),
      pathLabel: pathNames.join(" / ")
    };
  }

  return {
    unfiledStories: sortStories(storiesByFolder.get("") || []),
    nodes: sortFolders(childrenByParent.get("") || []).map((folder) => makeNode(folder, 0, []))
  };
}

export function folderPickerOptions(folders: StoryFolder[]) {
  const tree = buildFolderTree([], folders);
  const options: Array<{ folder: StoryFolder; label: string }> = [];

  function appendNode(node: FolderTreeNode) {
    options.push({ folder: node.folder, label: node.pathLabel });
    for (const child of node.children) appendNode(child);
  }

  for (const node of tree.nodes) appendNode(node);
  return options;
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
