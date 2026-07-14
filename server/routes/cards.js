import { Router } from "express";
import { cardForClient, readCards, writeCards } from "../repositories/cardsRepository.js";
import { findSentence, readStory } from "../repositories/storiesRepository.js";
import {
  buildAudioOnlyAnkiNote,
  buildAnkiNote,
  deleteQueuedAnkiNotes,
  ensureAnkiSetup,
  isCardFullySynced,
  markMissingAnkiNotesForResync,
  recoverExistingAnkiNotes,
  invokeAnki,
  shouldCreateAudioOnlyCard,
  uploadCardAudioForUpdate
} from "../services/ankiService.js";
import { cropStoryAudio, deleteCardAudioFile, generateAudio } from "../services/audioService.js";
import {
  cleanCardType,
  createCard,
  isDuplicateCard,
  queueCardAnkiNoteDeletions,
  updateCardFields
} from "../services/cardsService.js";
import { readSettings } from "../repositories/settingsRepository.js";

export const cardsRouter = Router();

const createAudioModes = new Set(["none", "generate", "story-crop"]);
const editAudioModes = new Set([...createAudioModes, "keep"]);

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanAudioMode(value, allowedModes) {
  if (allowedModes.has(value)) return value;
  throw httpError(`Audio mode must be ${Array.from(allowedModes).join(", ")}.`, 400);
}

function clearCardAudio(card) {
  card.audioFile = null;
  card.audioSource = null;
  card.storyAudioStart = null;
  card.storyAudioEnd = null;
  card.createAudioOnlyCard = false;
}

function setCardAudio(card, audio) {
  card.audioFile = audio.audioFile;
  card.audioSource = audio.audioSource;
  card.storyAudioStart = audio.storyAudioStart ?? null;
  card.storyAudioEnd = audio.storyAudioEnd ?? null;
}

function assertAudioModeAllowed({ story, current, audioMode }) {
  if (audioMode === "generate" && story.audioFile) {
    throw httpError("Generated audio is only available for stories without story audio.", 400);
  }
  if (audioMode === "keep" && !current?.audioFile) {
    throw httpError("There is no saved audio to keep.", 400);
  }
}

cardsRouter.get("/", async (_request, response, next) => {
  try {
    const cardsState = await readCards();
    response.json({ cards: cardsState.cards.map(cardForClient) });
  } catch (error) {
    next(error);
  }
});

cardsRouter.post("/", async (request, response, next) => {
  try {
    const story = await readStory(request.body.storyId);
    if (!story) return response.status(404).json({ error: "Story not found." });
    const sentence = findSentence(story, request.body.sentenceId);
    if (!sentence) return response.status(404).json({ error: "Sentence not found." });

    const cardsState = await readCards();
    const type = cleanCardType(request.body.type);
    const draft = createCard({ type, story, sentence, body: request.body });
    const audioMode = cleanAudioMode(request.body.audioMode, createAudioModes);
    assertAudioModeAllowed({ story, audioMode });

    if (isDuplicateCard(cardsState.cards, draft)) {
      return response.status(409).json({ error: "A matching card already exists." });
    }

    if (audioMode === "generate") {
      setCardAudio(draft, {
        audioFile: await generateAudio({ text: draft.croatianSentence, cardId: draft.id }),
        audioSource: "generated"
      });
    } else if (audioMode === "story-crop") {
      setCardAudio(
        draft,
        await cropStoryAudio({
          story,
          cardId: draft.id,
          start: request.body.storyAudioStart,
          end: request.body.storyAudioEnd
        })
      );
    }
    if (!draft.audioFile) draft.createAudioOnlyCard = false;
    cardsState.cards.push(draft);
    await writeCards(cardsState);
    response.status(201).end();
  } catch (error) {
    next(error);
  }
});

cardsRouter.patch("/:id", async (request, response, next) => {
  try {
    const cardsState = await readCards();
    const index = cardsState.cards.findIndex((card) => card.id === request.params.id);
    if (index === -1) {
      return response.status(404).json({ error: "Card not found." });
    }

    const current = cardsState.cards[index];
    const body = request.body || {};
    const story = await readStory(current.storyId);
    if (!story) return response.status(404).json({ error: "Story not found." });
    const audioMode = cleanAudioMode(body.audioMode, editAudioModes);
    assertAudioModeAllowed({ story, current, audioMode });
    const updated = updateCardFields(current, body);
    if (isDuplicateCard(cardsState.cards, updated, current.id)) {
      return response.status(409).json({ error: "A matching card already exists." });
    }

    const generatedAudioTextChanged = Boolean(
      current.audioSource === "generated" && updated.croatianSentence !== current.croatianSentence
    );
    const shouldDeleteAudio = Boolean(current.audioFile && audioMode === "none");
    const shouldReplaceAudio = audioMode === "generate" || audioMode === "story-crop";

    if (audioMode === "keep" && generatedAudioTextChanged) {
      return response.status(409).json({
        error: "Croatian text changed. Regenerate the existing audio or cancel this edit."
      });
    }

    if (shouldDeleteAudio) {
      await deleteCardAudioFile(current);
      clearCardAudio(updated);
    } else if (shouldReplaceAudio) {
      if (audioMode === "generate") {
        setCardAudio(updated, {
          audioFile: await generateAudio({ text: updated.croatianSentence, cardId: updated.id }),
          audioSource: "generated"
        });
      } else {
        setCardAudio(
          updated,
          await cropStoryAudio({
            story,
            cardId: updated.id,
            start: body.storyAudioStart,
            end: body.storyAudioEnd
          })
        );
      }
      if (current.audioFile !== updated.audioFile) await deleteCardAudioFile(current);
    }

    updated.createAudioOnlyCard = Boolean(
      updated.audioFile && (body.createAudioOnlyCard ?? current.createAudioOnlyCard)
    );

    if (current.ankiNoteId || current.audioOnlyAnkiNoteId) {
      queueCardAnkiNoteDeletions(cardsState, current);
      updated.ankiNoteId = null;
      updated.audioOnlyAnkiNoteId = null;
    }

    updated.syncStatus = "pending";
    updated.syncError = null;
    cardsState.cards[index] = updated;
    await writeCards(cardsState);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

cardsRouter.delete("/:id", async (request, response, next) => {
  try {
    const cardsState = await readCards();
    const card = cardsState.cards.find((item) => item.id === request.params.id);
    if (!card) {
      return response.status(404).json({ error: "Card not found." });
    }
    queueCardAnkiNoteDeletions(cardsState, card);
    await deleteCardAudioFile(card);

    const nextCards = cardsState.cards.filter((item) => item.id !== request.params.id);
    cardsState.cards = nextCards;
    await writeCards(cardsState);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

cardsRouter.post("/sync", async (_request, response, next) => {
  try {
    const settings = await readSettings();
    const cardsState = await readCards();

    await ensureAnkiSetup(settings);
    const deleted = await deleteQueuedAnkiNotes(cardsState, settings);
    const missing = await markMissingAnkiNotesForResync(cardsState, settings);
    const recovered = await recoverExistingAnkiNotes(cardsState, settings);
    const failedMessages = new Map();
    const touchedCards = new Set();
    let synced = 0;
    let failed = 0;

    function recordFailure(job, message) {
      const prefix = job.kind === "audioOnly" ? "Audio-only card" : "Card";
      const messages = failedMessages.get(job.card.id) || [];
      messages.push(`${prefix}: ${message}`);
      failedMessages.set(job.card.id, messages);
    }

    async function addSyncJobs(syncJobs) {
      if (!syncJobs.length) return;

      for (const job of syncJobs) {
        touchedCards.add(job.card);
      }

      const notes = syncJobs.map((job) => job.note);
      const canAdd = await invokeAnki("canAddNotesWithErrorDetail", { notes }, settings.ankiUrl);
      const addableNotes = [];
      const addableJobs = [];

      for (let index = 0; index < syncJobs.length; index += 1) {
        const check = canAdd[index];
        const job = syncJobs[index];
        if (check?.canAdd) {
          addableNotes.push(notes[index]);
          addableJobs.push(job);
        } else {
          failed += 1;
          recordFailure(job, check?.error || "Anki rejected this card.");
        }
      }

      if (!addableNotes.length) return;

      const noteIds = await invokeAnki("addNotes", { notes: addableNotes }, settings.ankiUrl);
      for (let index = 0; index < addableJobs.length; index += 1) {
        const noteId = noteIds[index];
        const job = addableJobs[index];
        if (noteId) {
          synced += 1;
          if (job.kind === "audioOnly") {
            job.card.audioOnlyAnkiNoteId = noteId;
          } else {
            job.card.ankiNoteId = noteId;
          }
        } else {
          failed += 1;
          recordFailure(job, "Anki did not return a note id.");
        }
      }
    }

    const mainJobs = cardsState.cards
      .filter((card) => !card.ankiNoteId)
      .map((card) => ({ card, kind: "main", note: buildAnkiNote(card, settings) }));

    await addSyncJobs(mainJobs);

    const audioOnlyJobs = [];
    for (const card of cardsState.cards) {
      if (!card.ankiNoteId || !shouldCreateAudioOnlyCard(card) || card.audioOnlyAnkiNoteId) continue;
      await uploadCardAudioForUpdate(card, settings);
      audioOnlyJobs.push({ card, kind: "audioOnly", note: buildAudioOnlyAnkiNote(card, settings) });
    }

    await addSyncJobs(audioOnlyJobs);

    if (!touchedCards.size) {
      await writeCards(cardsState);
      return response.json({ synced: 0, failed: 0, recreated: missing, recovered, deleted });
    }

    for (const card of touchedCards) {
      const messages = failedMessages.get(card.id) || [];
      if (messages.length) {
        card.syncStatus = "error";
        card.syncError = messages.join(" ");
      } else {
        card.syncStatus = isCardFullySynced(card) ? "synced" : "pending";
        card.syncError = null;
      }
    }

    await writeCards(cardsState);
    response.json({ synced, failed, recreated: missing, recovered, deleted });
  } catch (error) {
    next(error);
  }
});
