import type { MinedCard } from "../types";

export type WordToken = {
  text: string;
  start: number;
  end: number;
  normalized: string;
};

export type WordCoverageMatch = {
  card: MinedCard;
  isClozeTarget: boolean;
};

export type WordCoverageIndex = ReadonlyMap<string, readonly WordCoverageMatch[]>;

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[-\u2010\u2011'\u2018\u2019][\p{L}\p{M}\p{N}]+)*/gu;
const LETTER_PATTERN = /\p{L}/u;

export function normalizeWord(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("hr-HR");
}

/**
 * Tokenizes text while keeping offsets in the original string's UTF-16 code units,
 * matching the offsets used by String#slice and browser selection APIs.
 */
export function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const tokenText = match[0];
    if (!LETTER_PATTERN.test(tokenText)) continue;

    const start = match.index;
    tokens.push({
      text: tokenText,
      start,
      end: start + tokenText.length,
      normalized: normalizeWord(tokenText)
    });
  }

  return tokens;
}

function tokenIsClozeTarget(token: WordToken, card: MinedCard) {
  if (card.type !== "cloze" || !Number.isInteger(card.targetStart) || !Number.isInteger(card.targetEnd)) {
    return false;
  }

  const targetStart = card.targetStart as number;
  const targetEnd = card.targetEnd as number;
  if (targetStart < 0 || targetEnd <= targetStart || targetEnd > card.croatianSentence.length) {
    return false;
  }

  return targetStart <= token.start && targetEnd >= token.end;
}

export function buildWordCoverageIndex(cards: readonly MinedCard[]): WordCoverageIndex {
  const index = new Map<string, WordCoverageMatch[]>();

  for (const card of cards) {
    const matchesForCard = new Map<string, boolean>();

    for (const token of tokenizeWords(card.croatianSentence)) {
      const isClozeTarget = tokenIsClozeTarget(token, card);
      matchesForCard.set(token.normalized, matchesForCard.get(token.normalized) === true || isClozeTarget);
    }

    for (const [normalized, isClozeTarget] of matchesForCard) {
      const matches = index.get(normalized);
      const match = { card, isClozeTarget };

      if (matches) {
        matches.push(match);
      } else {
        index.set(normalized, [match]);
      }
    }
  }

  return index;
}

export function lookupWordCoverage(index: WordCoverageIndex, word: string): readonly WordCoverageMatch[] {
  return index.get(normalizeWord(word)) ?? [];
}
