import test from "node:test";
import assert from "node:assert/strict";
import { replaceStoryText, storyTextFromParagraphs } from "./storyService.js";

function sentence(id, croatian, withAnalysis = false) {
  return {
    id,
    croatian,
    ...(withAnalysis ? { analysis: { english: croatian, notes: [], suggestedCards: [] } } : {})
  };
}

function story(paragraphs) {
  return {
    id: "story",
    title: "Story",
    level: "A2",
    folderId: "folder",
    audioFile: "story.mp3",
    paragraphs
  };
}

test("serializes natural story text and keeps legacy sentence boundaries on a no-op", () => {
  const source = story([
    {
      id: "p007",
      sentences: [
        sentence("s010", "Priča H. C. Andersena.", true),
        sentence("s011", "Još jedna rečenica.", true)
      ]
    },
    { id: "p009", sentences: [sentence("s012", "Novi odlomak.", true)] }
  ]);

  const text = storyTextFromParagraphs(source.paragraphs);
  assert.equal(text, "Priča H. C. Andersena. Još jedna rečenica.\n\nNovi odlomak.");

  const replaced = replaceStoryText(source, text);
  assert.deepEqual(replaced, source);
});

test("retains an isolated edited sentence id and clears context-dependent analysis", () => {
  const source = story([
    {
      id: "p001",
      sentences: [
        sentence("s001", "Prva rečenica.", true),
        sentence("s002", "Druga rečenica.", true),
        sentence("s003", "Treća rečenica.", true)
      ]
    }
  ]);

  const replaced = replaceStoryText(source, "Prva rečenica. Uređena druga rečenica. Treća rečenica.");
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map(({ id, croatian }) => ({ id, croatian })),
    [
      { id: "s001", croatian: "Prva rečenica." },
      { id: "s002", croatian: "Uređena druga rečenica." },
      { id: "s003", croatian: "Treća rečenica." }
    ]
  );
  assert.ok(replaced.paragraphs[0].sentences.every((item) => !item.analysis));
});

test("allocates inserted sentence ids above old and orphan-card ids", () => {
  const source = story([
    {
      id: "p001",
      sentences: [sentence("s001", "Prva rečenica."), sentence("s002", "Druga rečenica.")]
    }
  ]);

  const replaced = replaceStoryText(source, "Nova rečenica. Prva rečenica. Druga rečenica.", ["s009"]);
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map((item) => item.id),
    ["s010", "s001", "s002"]
  );
});

test("does not attach a split sentence to the removed sentence id", () => {
  const source = story([
    {
      id: "p001",
      sentences: [
        sentence("s001", "Prva rečenica."),
        sentence("s002", "Druga rečenica."),
        sentence("s003", "Treća rečenica.")
      ]
    }
  ]);

  const replaced = replaceStoryText(
    source,
    "Prva rečenica. Druga je podijeljena. Ovo je nastavak. Treća rečenica."
  );
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map((item) => item.id),
    ["s001", "s004", "s005", "s003"]
  );
});

test("does not guess identities for an ambiguous block of edits", () => {
  const source = story([
    {
      id: "p001",
      sentences: [
        sentence("s001", "Prva rečenica."),
        sentence("s002", "Druga rečenica."),
        sentence("s003", "Treća rečenica."),
        sentence("s004", "Četvrta rečenica.")
      ]
    }
  ]);

  const replaced = replaceStoryText(
    source,
    "Prva rečenica. Uređena druga rečenica. Uređena treća rečenica. Četvrta rečenica."
  );
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map((item) => item.id),
    ["s001", "s005", "s006", "s004"]
  );
});

test("keeps the surviving duplicate attached to the correct sentence id", () => {
  const source = story([
    {
      id: "p001",
      sentences: [sentence("s001", "A."), sentence("s002", "X."), sentence("s003", "A.")]
    }
  ]);

  const replaced = replaceStoryText(source, "X. A.");
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map(({ id, croatian }) => ({ id, croatian })),
    [
      { id: "s002", croatian: "X." },
      { id: "s003", croatian: "A." }
    ]
  );
});

test("keeps legacy sentence boundaries when another sentence in the paragraph changes", () => {
  const source = story([
    {
      id: "p001",
      sentences: [
        sentence("s001", "Priča H. C. Andersena.", true),
        sentence("s002", "Stara druga rečenica.", true)
      ]
    }
  ]);

  const replaced = replaceStoryText(source, "Priča H. C. Andersena. Uređena druga rečenica.");
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map(({ id, croatian }) => ({ id, croatian })),
    [
      { id: "s001", croatian: "Priča H. C. Andersena." },
      { id: "s002", croatian: "Uređena druga rečenica." }
    ]
  );
  assert.ok(replaced.paragraphs[0].sentences.every((item) => !item.analysis));
});

test("preserves unique sentence ids when sentences are reordered", () => {
  const source = story([
    {
      id: "p001",
      sentences: [
        sentence("s001", "Prva rečenica.", true),
        sentence("s002", "Druga rečenica.", true),
        sentence("s003", "Treća rečenica.", true)
      ]
    }
  ]);

  const replaced = replaceStoryText(source, "Treća rečenica. Druga rečenica. Prva rečenica.");
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map((item) => item.id),
    ["s003", "s002", "s001"]
  );
  assert.ok(replaced.paragraphs[0].sentences.every((item) => !item.analysis));
});

test("does not guess duplicate identities around an edit without a unique anchor", () => {
  const source = story([
    {
      id: "p001",
      sentences: [sentence("s001", "A."), sentence("s002", "X."), sentence("s003", "A.")]
    }
  ]);

  const replaced = replaceStoryText(source, "A. Y. A.");
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map(({ id, croatian }) => ({ id, croatian })),
    [
      { id: "s004", croatian: "A." },
      { id: "s005", croatian: "Y." },
      { id: "s006", croatian: "A." }
    ]
  );
});

test("does not split an edited sentence around an old substring", () => {
  const source = story([
    {
      id: "p001",
      sentences: [sentence("s001", "Hello."), sentence("s002", "Next.")]
    }
  ]);

  const replaced = replaceStoryText(source, "Say Hello. Next.");
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map(({ id, croatian }) => ({ id, croatian })),
    [
      { id: "s001", croatian: "Say Hello." },
      { id: "s002", croatian: "Next." }
    ]
  );
});

test("does not assign reordered duplicate sentences by occurrence", () => {
  const source = story([
    {
      id: "p001",
      sentences: [sentence("s001", "A."), sentence("s002", "X."), sentence("s003", "A.")]
    }
  ]);

  const replaced = replaceStoryText(source, "X. A. A.");
  assert.deepEqual(
    replaced.paragraphs[0].sentences.map(({ id, croatian }) => ({ id, croatian })),
    [
      { id: "s002", croatian: "X." },
      { id: "s004", croatian: "A." },
      { id: "s005", croatian: "A." }
    ]
  );
});

test("matches multiple adjacent edited paragraphs through their unchanged sentences", () => {
  const source = story([
    {
      id: "p001",
      sentences: [sentence("s001", "Prvi trag."), sentence("s002", "Stari prvi završetak.")]
    },
    {
      id: "p002",
      sentences: [sentence("s003", "Drugi trag."), sentence("s004", "Stari drugi završetak.")]
    }
  ]);

  const replaced = replaceStoryText(
    source,
    "Prvi trag. Novi prvi završetak.\n\nDrugi trag. Novi drugi završetak."
  );
  assert.deepEqual(
    replaced.paragraphs.map((paragraph) => ({
      id: paragraph.id,
      sentenceIds: paragraph.sentences.map((item) => item.id)
    })),
    [
      { id: "p001", sentenceIds: ["s001", "s002"] },
      { id: "p002", sentenceIds: ["s003", "s004"] }
    ]
  );
});

test("does not move a removed paragraph id onto brand-new text after a merge", () => {
  const source = story([
    { id: "p001", sentences: [sentence("s001", "Short.")] },
    { id: "p002", sentences: [sentence("s002", "A much longer sentence.")] }
  ]);

  const replaced = replaceStoryText(
    source,
    "Short. A much longer sentence.\n\nBrand new."
  );
  assert.deepEqual(
    replaced.paragraphs.flatMap((paragraph) =>
      paragraph.sentences.map(({ id, croatian }) => ({ id, croatian }))
    ),
    [
      { id: "s001", croatian: "Short." },
      { id: "s002", croatian: "A much longer sentence." },
      { id: "s003", croatian: "Brand new." }
    ]
  );
});

test("preserves a globally unique sentence instead of assigning a local id after a merge", () => {
  const source = story([
    { id: "p001", sentences: [sentence("s001", "Short.")] },
    {
      id: "p002",
      sentences: [sentence("s002", "Discarded."), sentence("s003", "A much longer sentence.")]
    }
  ]);

  const replaced = replaceStoryText(source, "Short. A much longer sentence.\n\nBrand new.");
  assert.deepEqual(
    replaced.paragraphs.flatMap((paragraph) =>
      paragraph.sentences.map(({ id, croatian }) => ({ id, croatian }))
    ),
    [
      { id: "s001", croatian: "Short." },
      { id: "s003", croatian: "A much longer sentence." },
      { id: "s004", croatian: "Brand new." }
    ]
  );
});

test("does not consume an id locally when its exact sentence survives in another paragraph", () => {
  const source = story([
    { id: "p001", sentences: [sentence("s001", "Short.")] },
    {
      id: "p002",
      sentences: [sentence("s002", "A much longer sentence."), sentence("s003", "Keep.")]
    }
  ]);

  const replaced = replaceStoryText(
    source,
    "Short. A much longer sentence. Brand new.\n\nKeep."
  );
  assert.deepEqual(
    replaced.paragraphs.flatMap((paragraph) =>
      paragraph.sentences.map(({ id, croatian }) => ({ id, croatian }))
    ),
    [
      { id: "s001", croatian: "Short." },
      { id: "s002", croatian: "A much longer sentence." },
      { id: "s004", croatian: "Brand new." },
      { id: "s003", croatian: "Keep." }
    ]
  );
});

test("preserves repeated unchanged paragraphs when another paragraph changes", () => {
  const source = story([
    { id: "p001", sentences: [sentence("s001", "Isti odlomak.")] },
    { id: "p002", sentences: [sentence("s002", "Isti odlomak.")] },
    { id: "p003", sentences: [sentence("s003", "Stari završetak.")] }
  ]);

  const replaced = replaceStoryText(
    source,
    "Isti odlomak.\n\nIsti odlomak.\n\nNovi završetak."
  );
  assert.deepEqual(
    replaced.paragraphs.map((paragraph) => ({
      id: paragraph.id,
      sentenceIds: paragraph.sentences.map((item) => item.id)
    })),
    [
      { id: "p001", sentenceIds: ["s001"] },
      { id: "p002", sentenceIds: ["s002"] },
      { id: "p003", sentenceIds: ["s003"] }
    ]
  );
});

test("keeps identical paragraph occurrences stable on a no-op", () => {
  const source = story([
    { id: "p001", sentences: [sentence("s001", "Isti odlomak.")] },
    { id: "p002", sentences: [sentence("s002", "Isti odlomak.")] }
  ]);

  assert.deepEqual(replaceStoryText(source, storyTextFromParagraphs(source.paragraphs)), source);
});

test("reorders exact paragraphs without changing their sentence identities", () => {
  const source = story([
    { id: "p001", sentences: [sentence("s001", "Prvi odlomak.", true)] },
    { id: "p002", sentences: [sentence("s002", "Drugi odlomak.", true)] }
  ]);

  const replaced = replaceStoryText(source, "Drugi odlomak.\n\nPrvi odlomak.");
  assert.deepEqual(
    replaced.paragraphs.map((paragraph) => ({ id: paragraph.id, sentenceId: paragraph.sentences[0].id })),
    [
      { id: "p002", sentenceId: "s002" },
      { id: "p001", sentenceId: "s001" }
    ]
  );
  assert.ok(replaced.paragraphs.every((paragraph) => !paragraph.sentences[0].analysis));
});

test("an empty replacement produces no paragraphs without changing story metadata", () => {
  const source = story([{ id: "p001", sentences: [sentence("s001", "Tekst.")] }]);
  const replaced = replaceStoryText(source, "   \n\n  ");
  assert.equal(replaced.paragraphs.length, 0);
  assert.equal(replaced.title, source.title);
  assert.equal(replaced.audioFile, source.audioFile);
});
