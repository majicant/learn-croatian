import { Router } from "express";
import { cardForClient, readCards, writeCards } from "../repositories/cardsRepository.js";
import { findSentence, readStory } from "../repositories/storiesRepository.js";
import {
  buildAnkiNote,
  deleteQueuedAnkiNotes,
  ensureAnkiSetup,
  markMissingAnkiNotesForResync,
  recoverExistingAnkiNotes,
  invokeAnki
} from "../services/ankiService.js";
import { addAudioIfRequested } from "../services/audioService.js";
import {
  cleanCardType,
  createCard,
  isDuplicateCard,
  queueAnkiNoteDeletion,
  updateCardFields
} from "../services/cardsService.js";
import { readSettings } from "../repositories/settingsRepository.js";

export const cardsRouter = Router();

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

    if (isDuplicateCard(cardsState.cards, draft)) {
      return response.status(409).json({ error: "A matching card already exists." });
    }

    await addAudioIfRequested(draft, Boolean(request.body.generateAudio));
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
    const updated = updateCardFields(current, request.body || {});
    if (isDuplicateCard(cardsState.cards, updated, current.id)) {
      return response.status(409).json({ error: "A matching card already exists." });
    }

    if (current.ankiNoteId) {
      queueAnkiNoteDeletion(cardsState, current.ankiNoteId);
      updated.ankiNoteId = null;
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
    if (card.ankiNoteId) queueAnkiNoteDeletion(cardsState, card.ankiNoteId);

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
    const cardsToSync = cardsState.cards.filter((card) => !card.ankiNoteId);

    if (!cardsToSync.length) {
      await writeCards(cardsState);
      return response.json({ synced: 0, failed: 0, recreated: missing, recovered, deleted });
    }

    const notes = cardsToSync.map((card) => buildAnkiNote(card, settings));
    const canAdd = await invokeAnki("canAddNotesWithErrorDetail", { notes }, settings.ankiUrl);
    const addableNotes = [];
    const addableCards = [];
    let failed = 0;

    for (let index = 0; index < cardsToSync.length; index += 1) {
      const check = canAdd[index];
      if (check?.canAdd) {
        addableNotes.push(notes[index]);
        addableCards.push(cardsToSync[index]);
      } else {
        failed += 1;
        cardsToSync[index].syncStatus = "error";
        cardsToSync[index].syncError = check?.error || "Anki rejected this card.";
      }
    }

    let synced = 0;
    if (addableNotes.length) {
      const noteIds = await invokeAnki("addNotes", { notes: addableNotes }, settings.ankiUrl);
      for (let index = 0; index < addableCards.length; index += 1) {
        const noteId = noteIds[index];
        const card = addableCards[index];
        if (noteId) {
          synced += 1;
          card.ankiNoteId = noteId;
          card.syncStatus = "synced";
          card.syncError = null;
        } else {
          failed += 1;
          card.syncStatus = "error";
          card.syncError = "Anki did not return a note id.";
        }
      }
    }

    await writeCards(cardsState);
    response.json({ synced, failed, recreated: missing, recovered, deleted });
  } catch (error) {
    next(error);
  }
});
