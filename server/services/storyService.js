export function splitParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function sentenceSegments(paragraph) {
  const segmenter = new Intl.Segmenter("hr", { granularity: "sentence" });
  return Array.from(segmenter.segment(paragraph), (segment) => {
    const croatian = segment.segment.trim();
    if (!croatian) return null;
    const leadingWhitespace = segment.segment.length - segment.segment.trimStart().length;
    return {
      croatian,
      start: segment.index + leadingWhitespace,
      end: segment.index + leadingWhitespace + croatian.length
    };
  }).filter(Boolean);
}

export function splitSentences(paragraph) {
  return sentenceSegments(paragraph).map((segment) => segment.croatian);
}

function paragraphText(paragraph) {
  return (paragraph?.sentences || [])
    .map((sentence) => String(sentence?.croatian || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function storyTextFromParagraphs(paragraphs) {
  return (paragraphs || []).map(paragraphText).filter(Boolean).join("\n\n");
}

function numericIdValue(id, prefix) {
  const match = new RegExp(`^${prefix}(\\d+)$`, "i").exec(String(id || ""));
  return match ? Number(match[1]) : 0;
}

function createIdAllocator(prefix, initialIds, minimumWidth = 3) {
  const usedIds = new Set(Array.from(initialIds || [], (id) => String(id || "")));
  let nextNumber = 1;
  for (const id of usedIds) {
    nextNumber = Math.max(nextNumber, numericIdValue(id, prefix) + 1);
  }

  return () => {
    while (true) {
      const id = `${prefix}${String(nextNumber).padStart(minimumWidth, "0")}`;
      nextNumber += 1;
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      return id;
    }
  };
}

function pushQueue(map, key, value) {
  const queue = map.get(key) || [];
  queue.push(value);
  map.set(key, queue);
}

function valueCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function deleteAnalysis(sentence) {
  const { analysis: _analysis, ...withoutAnalysis } = sentence;
  return withoutAnalysis;
}

function sameSentenceSignature(a, b) {
  if (!a || !b) return a === b;
  return a.id === b.id && a.croatian === b.croatian;
}

function anchorPairs(length, matchedAtIndex, idAtIndex) {
  const pairs = Array.from({ length }, () => ({ left: "", right: "" }));
  let left = "";
  for (let index = 0; index < length; index += 1) {
    if (matchedAtIndex(index)) {
      left = idAtIndex(index);
    } else {
      pairs[index].left = left;
    }
  }

  let right = "";
  for (let index = length - 1; index >= 0; index -= 1) {
    if (matchedAtIndex(index)) {
      right = idAtIndex(index);
    } else {
      pairs[index].right = right;
    }
  }
  return pairs;
}

function anchorKey(pair) {
  return `${pair.left}\u0000${pair.right}`;
}

function occurrenceStarts(source, value) {
  const starts = [];
  if (!value) return starts;
  let fromIndex = 0;
  while (fromIndex <= source.length - value.length) {
    const start = source.indexOf(value, fromIndex);
    if (start < 0) break;
    starts.push(start);
    fromIndex = start + Math.max(1, value.length);
  }
  return starts;
}

function sentenceBoundaryPositions(source) {
  const boundaries = new Set([0, source.length]);
  for (const segment of sentenceSegments(source)) {
    boundaries.add(segment.start);
    boundaries.add(segment.end);
  }
  return boundaries;
}

function completeSentenceOccurrences(source, value, boundaries = sentenceBoundaryPositions(source)) {
  return occurrenceStarts(source, value).filter(
    (start) => boundaries.has(start) && boundaries.has(start + value.length)
  );
}

function selectSentenceAnchors(candidates) {
  if (!candidates.length) return [];
  const orderedCandidates = [...candidates].sort(
    (a, b) => a.end - b.end || a.start - b.start || a.oldIndex - b.oldIndex
  );
  const states = orderedCandidates.map((candidate) => ({
    characters: candidate.end - candidate.start,
    count: 1,
    previous: -1
  }));

  function isBetter(characters, count, current) {
    return characters > current.characters || (characters === current.characters && count > current.count);
  }

  for (let index = 0; index < orderedCandidates.length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      if (orderedCandidates[previous].end > orderedCandidates[index].start) continue;
      const characters =
        states[previous].characters + orderedCandidates[index].end - orderedCandidates[index].start;
      const count = states[previous].count + 1;
      if (!isBetter(characters, count, states[index])) continue;
      states[index] = { characters, count, previous };
    }
  }

  let bestIndex = 0;
  for (let index = 1; index < states.length; index += 1) {
    if (isBetter(states[index].characters, states[index].count, states[bestIndex])) bestIndex = index;
  }

  const selected = [];
  for (let index = bestIndex; index >= 0; index = states[index].previous) {
    selected.push(orderedCandidates[index]);
    if (states[index].previous < 0) break;
  }
  return selected.reverse();
}

function parseEditedParagraph(
  sourceText,
  oldParagraph,
  oldSentenceIndexById,
  oldSentences,
  globallyPresentOldSentenceTexts
) {
  const oldParagraphSentences = oldParagraph.sentences.map((sentence) => ({
    sentence,
    oldIndex: oldSentenceIndexById.get(sentence.id)
  }));
  const oldIndicesByText = new Map();
  oldParagraphSentences.forEach(({ sentence, oldIndex }) => pushQueue(oldIndicesByText, sentence.croatian, oldIndex));
  const candidates = [];
  const sourceBoundaries = sentenceBoundaryPositions(sourceText);
  const globalOldTextCounts = valueCounts(oldSentences.map(({ sentence }) => sentence.croatian));
  const uniqueGlobalOldIndexByText = new Map();
  oldSentences.forEach(({ sentence }, oldIndex) => {
    if (globalOldTextCounts.get(sentence.croatian) === 1) {
      uniqueGlobalOldIndexByText.set(sentence.croatian, oldIndex);
    }
  });

  for (const [croatian, oldIndices] of oldIndicesByText) {
    if (!croatian || oldIndices.length !== 1) continue;
    const starts = completeSentenceOccurrences(sourceText, croatian, sourceBoundaries);
    if (starts.length !== 1) continue;
    candidates.push({
      oldIndex: oldIndices[0],
      start: starts[0],
      end: starts[0] + croatian.length
    });
  }

  const selectedAnchors = selectSentenceAnchors(candidates);
  const items = [];
  let sourceOffset = 0;
  for (const anchor of selectedAnchors) {
    const gap = sourceText.slice(sourceOffset, anchor.start).trim();
    if (gap) {
      items.push(...splitSentences(gap).map((croatian) => ({ croatian, oldIndex: null, exact: false })));
    }
    items.push({
      croatian: oldSentences[anchor.oldIndex].sentence.croatian,
      oldIndex: anchor.oldIndex,
      exact: true
    });
    sourceOffset = anchor.end;
  }
  const tail = sourceText.slice(sourceOffset).trim();
  if (tail) items.push(...splitSentences(tail).map((croatian) => ({ croatian, oldIndex: null, exact: false })));

  const exactOldIndices = new Set(items.filter((item) => item.oldIndex !== null).map((item) => item.oldIndex));
  const oldAnchors = anchorPairs(
    oldParagraphSentences.length,
    (index) => exactOldIndices.has(oldParagraphSentences[index].oldIndex),
    (index) => oldParagraphSentences[index].sentence.id
  );
  const newAnchors = anchorPairs(
    items.length,
    (index) => items[index].oldIndex !== null,
    (index) => oldSentences[items[index].oldIndex].sentence.id
  );
  const unmatchedOldByAnchors = new Map();
  const unmatchedNewByAnchors = new Map();

  oldParagraphSentences.forEach(({ oldIndex }, index) => {
    if (!exactOldIndices.has(oldIndex)) pushQueue(unmatchedOldByAnchors, anchorKey(oldAnchors[index]), oldIndex);
  });
  items.forEach((item, index) => {
    if (item.oldIndex === null) pushQueue(unmatchedNewByAnchors, anchorKey(newAnchors[index]), index);
  });

  for (const [key, newIndices] of unmatchedNewByAnchors) {
    const oldIndices = unmatchedOldByAnchors.get(key) || [];
    if (oldIndices.length !== 1 || newIndices.length !== 1) continue;
    const oldIndex = oldIndices[0];
    const newItem = items[newIndices[0]];
    const oldSentence = oldSentences[oldIndex].sentence;
    if (globallyPresentOldSentenceTexts.has(oldSentence.croatian) && newItem.croatian !== oldSentence.croatian) {
      continue;
    }
    const globallyExactOldIndex = uniqueGlobalOldIndexByText.get(newItem.croatian);
    if (globallyExactOldIndex !== undefined && globallyExactOldIndex !== oldIndex) continue;
    newItem.oldIndex = oldIndex;
    newItem.exact = newItem.croatian === oldSentence.croatian;
  }

  return items;
}

function paragraphMatchScore(paragraph, sourceText) {
  const textCounts = valueCounts(paragraph.sentences.map((sentence) => sentence.croatian));
  const sourceBoundaries = sentenceBoundaryPositions(sourceText);
  let score = 0;
  for (const sentence of paragraph.sentences) {
    if (!sentence.croatian || textCounts.get(sentence.croatian) !== 1) continue;
    const starts = completeSentenceOccurrences(sourceText, sentence.croatian, sourceBoundaries);
    if (starts.length === 1) score += sentence.croatian.length;
  }
  return score;
}

function assignParagraphGroup(assignments, oldParagraphs, sourceParagraphs, oldIndices, newIndices) {
  if (oldIndices.length === 1 && newIndices.length === 1) {
    const oldIndex = oldIndices[0];
    const newIndex = newIndices[0];
    assignments[newIndex] = {
      oldIndex,
      exact: sourceParagraphs[newIndex] === paragraphText(oldParagraphs[oldIndex])
    };
    return;
  }

  const remainingOld = new Set(oldIndices);
  const remainingNew = new Set(newIndices);

  const oldIndicesByText = new Map();
  const newIndicesByText = new Map();
  oldIndices.forEach((oldIndex) => pushQueue(oldIndicesByText, paragraphText(oldParagraphs[oldIndex]), oldIndex));
  newIndices.forEach((newIndex) => pushQueue(newIndicesByText, sourceParagraphs[newIndex], newIndex));
  for (const [text, exactOldIndices] of oldIndicesByText) {
    const exactNewIndices = newIndicesByText.get(text) || [];
    if (!exactOldIndices.length || exactOldIndices.length !== exactNewIndices.length) continue;
    exactOldIndices.forEach((oldIndex, occurrenceIndex) => {
      const newIndex = exactNewIndices[occurrenceIndex];
      assignments[newIndex] = { oldIndex, exact: true };
      remainingOld.delete(oldIndex);
      remainingNew.delete(newIndex);
    });
  }
  if (remainingOld.size === 1 && remainingNew.size === 1) {
    const oldIndex = remainingOld.values().next().value;
    const newIndex = remainingNew.values().next().value;
    assignments[newIndex] = { oldIndex, exact: false };
    return;
  }

  while (remainingOld.size && remainingNew.size) {
    const oldBest = new Map();
    for (const oldIndex of remainingOld) {
      let bestScore = 0;
      let bestNewIndex = null;
      let tied = false;
      for (const newIndex of remainingNew) {
        const score = paragraphMatchScore(oldParagraphs[oldIndex], sourceParagraphs[newIndex]);
        if (score > bestScore) {
          bestScore = score;
          bestNewIndex = newIndex;
          tied = false;
        } else if (score > 0 && score === bestScore) {
          tied = true;
        }
      }
      if (bestNewIndex !== null && !tied) oldBest.set(oldIndex, { newIndex: bestNewIndex, score: bestScore });
    }

    const newBest = new Map();
    for (const newIndex of remainingNew) {
      let bestScore = 0;
      let bestOldIndex = null;
      let tied = false;
      for (const oldIndex of remainingOld) {
        const score = paragraphMatchScore(oldParagraphs[oldIndex], sourceParagraphs[newIndex]);
        if (score > bestScore) {
          bestScore = score;
          bestOldIndex = oldIndex;
          tied = false;
        } else if (score > 0 && score === bestScore) {
          tied = true;
        }
      }
      if (bestOldIndex !== null && !tied) newBest.set(newIndex, { oldIndex: bestOldIndex, score: bestScore });
    }

    const mutualMatches = [];
    for (const [oldIndex, oldMatch] of oldBest) {
      const newMatch = newBest.get(oldMatch.newIndex);
      if (newMatch?.oldIndex === oldIndex && newMatch.score === oldMatch.score) {
        mutualMatches.push({ oldIndex, newIndex: oldMatch.newIndex });
      }
    }
    if (!mutualMatches.length) break;

    for (const { oldIndex, newIndex } of mutualMatches) {
      assignments[newIndex] = { oldIndex, exact: false };
      remainingOld.delete(oldIndex);
      remainingNew.delete(newIndex);
    }
  }

}

function assignParagraphs(oldParagraphs, sourceParagraphs) {
  const oldTexts = oldParagraphs.map(paragraphText);
  const oldTextCounts = valueCounts(oldTexts);
  const newTextCounts = valueCounts(sourceParagraphs);
  const uniqueOldIndexByText = new Map();
  oldTexts.forEach((text, index) => {
    if (oldTextCounts.get(text) === 1) uniqueOldIndexByText.set(text, index);
  });

  const assignments = sourceParagraphs.map(() => ({ oldIndex: null, exact: false }));
  const exactOldIndices = new Set();
  sourceParagraphs.forEach((text, index) => {
    if (newTextCounts.get(text) !== 1) return;
    const oldIndex = uniqueOldIndexByText.get(text);
    if (oldIndex === undefined) return;
    assignments[index] = { oldIndex, exact: true };
    exactOldIndices.add(oldIndex);
  });

  const oldAnchors = anchorPairs(
    oldParagraphs.length,
    (index) => exactOldIndices.has(index),
    (index) => oldParagraphs[index].id
  );
  const newAnchors = anchorPairs(
    sourceParagraphs.length,
    (index) => assignments[index].oldIndex !== null,
    (index) => oldParagraphs[assignments[index].oldIndex].id
  );
  const unmatchedOldByAnchors = new Map();
  const unmatchedNewByAnchors = new Map();

  oldParagraphs.forEach((_paragraph, index) => {
    if (!exactOldIndices.has(index)) pushQueue(unmatchedOldByAnchors, anchorKey(oldAnchors[index]), index);
  });
  sourceParagraphs.forEach((_text, index) => {
    if (assignments[index].oldIndex === null) {
      pushQueue(unmatchedNewByAnchors, anchorKey(newAnchors[index]), index);
    }
  });

  for (const [key, newIndices] of unmatchedNewByAnchors) {
    const oldIndices = unmatchedOldByAnchors.get(key) || [];
    if (!oldIndices.length) continue;
    assignParagraphGroup(assignments, oldParagraphs, sourceParagraphs, oldIndices, newIndices);
  }

  return assignments;
}

export function replaceStoryText(story, text, reservedSentenceIds = []) {
  const oldParagraphs = story?.paragraphs || [];
  const oldSentences = [];
  const oldSentenceIndexById = new Map();
  oldParagraphs.forEach((paragraph) => {
    (paragraph.sentences || []).forEach((sentence) => {
      const oldIndex = oldSentences.length;
      oldSentences.push({ sentence });
      oldSentenceIndexById.set(sentence.id, oldIndex);
    });
  });

  const sourceParagraphs = splitParagraphs(text);
  if (
    sourceParagraphs.length === oldParagraphs.length &&
    sourceParagraphs.every((sourceText, index) => sourceText === paragraphText(oldParagraphs[index]))
  ) {
    return story;
  }
  const sourceParagraphBoundaries = sourceParagraphs.map((sourceText) => sentenceBoundaryPositions(sourceText));
  const globallyPresentOldSentenceTexts = new Set();
  const distinctOldSentenceTexts = new Set(oldSentences.map(({ sentence }) => sentence.croatian));
  for (const croatian of distinctOldSentenceTexts) {
    if (
      croatian &&
      sourceParagraphs.some(
        (sourceText, paragraphIndex) =>
          completeSentenceOccurrences(sourceText, croatian, sourceParagraphBoundaries[paragraphIndex]).length > 0
      )
    ) {
      globallyPresentOldSentenceTexts.add(croatian);
    }
  }
  const paragraphAssignments = assignParagraphs(oldParagraphs, sourceParagraphs);
  const parsedParagraphs = sourceParagraphs.map((sourceText, paragraphIndex) => {
    const assignment = paragraphAssignments[paragraphIndex];
    if (assignment.oldIndex === null) {
      return {
        oldParagraph: null,
        items: splitSentences(sourceText).map((croatian) => ({ croatian, oldIndex: null, exact: false }))
      };
    }

    const oldParagraph = oldParagraphs[assignment.oldIndex];
    if (assignment.exact || sourceText === paragraphText(oldParagraph)) {
      return {
        oldParagraph,
        items: oldParagraph.sentences.map((sentence) => ({
          croatian: sentence.croatian,
          oldIndex: oldSentenceIndexById.get(sentence.id),
          exact: true
        }))
      };
    }

    return {
      oldParagraph,
      items: parseEditedParagraph(
        sourceText,
        oldParagraph,
        oldSentenceIndexById,
        oldSentences,
        globallyPresentOldSentenceTexts
      )
    };
  });

  const newItems = parsedParagraphs.flatMap((paragraph) => paragraph.items);
  const claimedOldIndices = new Set(
    newItems.filter((item) => item.oldIndex !== null).map((item) => item.oldIndex)
  );
  const oldSentenceTextCounts = valueCounts(oldSentences.map(({ sentence }) => sentence.croatian));
  const newSentenceTextCounts = valueCounts(newItems.map((item) => item.croatian));
  const uniqueOldSentenceIndexByText = new Map();
  oldSentences.forEach(({ sentence }, oldIndex) => {
    if (oldSentenceTextCounts.get(sentence.croatian) === 1) {
      uniqueOldSentenceIndexByText.set(sentence.croatian, oldIndex);
    }
  });
  for (const item of newItems) {
    if (item.oldIndex !== null || newSentenceTextCounts.get(item.croatian) !== 1) continue;
    const oldIndex = uniqueOldSentenceIndexByText.get(item.croatian);
    if (oldIndex === undefined || claimedOldIndices.has(oldIndex)) continue;
    item.oldIndex = oldIndex;
    item.exact = true;
    claimedOldIndices.add(oldIndex);
  }

  const nextSentenceId = createIdAllocator("s", [
    ...oldSentences.map(({ sentence }) => sentence.id),
    ...Array.from(reservedSentenceIds || [])
  ]);
  const newSentenceRecords = newItems.map((item) => {
    if (item.oldIndex === null) {
      return { item, sentence: { id: nextSentenceId(), croatian: item.croatian } };
    }

    const oldSentence = oldSentences[item.oldIndex].sentence;
    const sentence = item.exact
      ? { ...oldSentence, croatian: item.croatian }
      : { ...deleteAnalysis(oldSentence), croatian: item.croatian };
    return { item, sentence };
  });

  newSentenceRecords.forEach((record, newIndex) => {
    const oldIndex = record.item.oldIndex;
    if (oldIndex === null || !record.item.exact || !record.sentence.analysis) return;

    const oldPrevious = oldSentences[oldIndex - 1]?.sentence || null;
    const oldNext = oldSentences[oldIndex + 1]?.sentence || null;
    const newPrevious = newSentenceRecords[newIndex - 1]?.sentence || null;
    const newNext = newSentenceRecords[newIndex + 1]?.sentence || null;
    if (!sameSentenceSignature(oldPrevious, newPrevious) || !sameSentenceSignature(oldNext, newNext)) {
      record.sentence = deleteAnalysis(record.sentence);
    }
  });

  const nextParagraphId = createIdAllocator("p", oldParagraphs.map((paragraph) => paragraph.id));
  let sentenceOffset = 0;
  const paragraphs = parsedParagraphs
    .map((paragraph) => {
      const sentences = newSentenceRecords
        .slice(sentenceOffset, sentenceOffset + paragraph.items.length)
        .map((record) => record.sentence);
      sentenceOffset += paragraph.items.length;
      return {
        id: paragraph.oldParagraph?.id || nextParagraphId(),
        sentences
      };
    })
    .filter((paragraph) => paragraph.sentences.length);

  return {
    ...story,
    paragraphs
  };
}

export function buildStory({ title, level, text, folderId }) {
  const paragraphs = splitParagraphs(text);
  let sentenceNumber = 1;

  return {
    id: "",
    title: String(title || "").trim(),
    level: String(level || "").trim() || "A1",
    folderId: String(folderId || "").trim(),
    audioFile: null,
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
