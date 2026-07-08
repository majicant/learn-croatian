import { Save, Send, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api/client";
import { isSynced, syncLabel } from "../../domain/cards";
import type { CardType, MinedCard } from "../../types";
import { TargetSentence } from "../reader/TargetSentence";

type CardsProps = {
  cards: MinedCard[];
  reloadCards: () => Promise<void>;
  setError: (message: string) => void;
};

type CardEditDraft = {
  type: CardType;
  croatianSentence: string;
  targetText: string;
  targetStart?: number;
  targetEnd?: number;
  englishTranslation: string;
  hint: string;
  note: string;
};
type CardsTab = "pending" | "synced";

type ClozeSelection = {
  start: number;
  end: number;
  text: string;
};

function hasValidTargetRange(sentence: string, target: string, targetStart?: number, targetEnd?: number) {
  if (!target || !Number.isInteger(targetStart) || !Number.isInteger(targetEnd)) return false;
  const start = targetStart as number;
  const end = targetEnd as number;
  return start >= 0 && end > start && end <= sentence.length && sentence.slice(start, end) === target;
}

function cardToEditDraft(card: MinedCard): CardEditDraft {
  return {
    type: card.type,
    croatianSentence: card.croatianSentence,
    targetText: card.targetText || "",
    targetStart: card.targetStart,
    targetEnd: card.targetEnd,
    englishTranslation: card.englishTranslation,
    hint: card.hint || "",
    note: card.note || ""
  };
}

export function CardsView({ cards, reloadCards, setError }: CardsProps) {
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [playingId, setPlayingId] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCardsTab, setSelectedCardsTab] = useState<CardsTab | "">("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState<CardEditDraft | null>(null);
  const [pendingEditSelection, setPendingEditSelection] = useState<ClozeSelection | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const pendingCount = cards.filter((card) => !isSynced(card)).length;
  const syncedCount = cards.filter(isSynced).length;
  const errorCount = cards.filter((card) => card.syncStatus === "error").length;
  const pendingCards = cards.filter((card) => !isSynced(card));
  const syncedCards = cards.filter(isSynced);
  const activeCardsTab: CardsTab = selectedCardsTab || (pendingCount > 0 ? "pending" : "synced");
  const visibleCards = activeCardsTab === "pending" ? pendingCards : syncedCards;
  const editingCard = cards.find((card) => card.id === editingId) || null;

  useEffect(() => {
    if (!editingId || editingCard) return;
    cancelEdit();
  }, [editingCard, editingId]);

  useEffect(() => {
    if (!editingId) return;

    window.requestAnimationFrame(() => editTextareaRef.current?.focus());
  }, [editingId]);

  useEffect(() => {
    if (!editingId) return;

    const originalOverflow = document.body.style.overflow;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !savingEdit) cancelEdit();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editingId, savingEdit]);

  async function syncCards() {
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const payload = await apiJson<{ synced: number; failed: number; recreated?: number; recovered?: number; deleted?: number }>(
        "/api/cards/sync",
        { method: "POST" }
      );
      const parts = [];
      if (payload.synced) parts.push(`Synced ${payload.synced}.`);
      if (payload.recovered) parts.push(`Recovered ${payload.recovered}.`);
      if (payload.recreated) parts.push(`Recreated ${payload.recreated}.`);
      if (payload.deleted) parts.push(`Deleted ${payload.deleted}.`);
      if (payload.failed) parts.push(`Failed ${payload.failed}.`);
      setMessage(parts.length ? parts.join(" ") : "Anki is up to date.");
      await reloadCards();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  function startEdit(card: MinedCard) {
    setError("");
    setMessage("");
    setEditingId(card.id);
    setEditDraft(cardToEditDraft(card));
    setPendingEditSelection(null);
  }

  function cancelEdit() {
    setEditingId("");
    setEditDraft(null);
    setPendingEditSelection(null);
  }

  function selectCardsTab(tab: CardsTab) {
    cancelEdit();
    setSelectedCardsTab(tab);
  }

  function updateEditDraft(next: Partial<CardEditDraft>) {
    setEditDraft((current) => (current ? { ...current, ...next } : current));
  }

  function captureEditSelection() {
    const textarea = editTextareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setPendingEditSelection(null);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    if (selected.trim()) {
      setPendingEditSelection({ start, end, text: selected });
    } else {
      setPendingEditSelection(null);
    }
  }

  function hideEditSelection() {
    if (!pendingEditSelection) return;
    updateEditDraft({
      targetText: pendingEditSelection.text,
      targetStart: pendingEditSelection.start,
      targetEnd: pendingEditSelection.end
    });
    setPendingEditSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function clearEditTargetSelection() {
    updateEditDraft({ targetText: "", targetStart: undefined, targetEnd: undefined });
    setPendingEditSelection(null);
  }

  async function saveEdit(card: MinedCard) {
    if (!editDraft) return;
    setSavingEdit(true);
    setError("");
    setMessage("");
    try {
      await apiJson(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify(editDraft)
      });
      cancelEdit();
      await reloadCards();
      setMessage(isSynced(card) ? "Saved. Sync to replace the Anki card." : "Saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Card update failed.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteCard(card: MinedCard) {
    const warning = isSynced(card)
      ? "Delete this card? It will be removed from this app now and deleted from your Anki deck the next time you sync."
      : "Delete this pending card?";
    if (!window.confirm(warning)) return;
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Delete failed.");
      }
      if (editingId === card.id) cancelEdit();
      await reloadCards();
      setMessage(isSynced(card) ? "Deleted locally. Sync to delete it from Anki." : "Deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
    }
  }

  async function playAudio(card: MinedCard) {
    if (!card.audioFile) return;
    setPlayingId(card.id);
    try {
      const audio = new Audio(`/media/${encodeURIComponent(card.audioFile)}`);
      audio.addEventListener("ended", () => setPlayingId(""));
      audio.addEventListener("error", () => {
        setPlayingId("");
        setError("Could not play this card's audio file.");
      });
      await audio.play();
    } catch {
      setPlayingId("");
      setError("Could not play this card's audio file.");
    }
  }

  function renderEditModal() {
    if (!editingCard || !editDraft) return null;

    const editNeedsHiddenText = editDraft.type === "cloze";
    const editTargetInSentence = hasValidTargetRange(
      editDraft.croatianSentence,
      editDraft.targetText,
      editDraft.targetStart,
      editDraft.targetEnd
    );
    const canSaveEdit = Boolean(
      editDraft.croatianSentence &&
        editDraft.englishTranslation &&
        !savingEdit &&
        (!editNeedsHiddenText || (editDraft.targetText && editTargetInSentence))
    );

    return (
      <div
        className="card-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !savingEdit) cancelEdit();
        }}
      >
        <section className="card-modal" role="dialog" aria-modal="true" aria-labelledby="card-edit-title">
          <div className="card-modal-head">
            <div>
              <div className="card-modal-kicker">
                <span className="pill">{editingCard.type}</span>
                <span className={`sync-pill ${editingCard.syncStatus}`}>{syncLabel(editingCard)}</span>
                {editingCard.audioFile && (
                  <button
                    className="audio-play"
                    type="button"
                    onClick={() => {
                      void playAudio(editingCard);
                    }}
                    disabled={playingId === editingCard.id}
                  >
                    <Volume2 size={13} aria-hidden="true" />
                    {playingId === editingCard.id ? "Playing" : "Audio"}
                  </button>
                )}
              </div>
              <h2 id="card-edit-title">Edit card</h2>
              <p>{editingCard.type === "basic" ? "Croatian to English" : editingCard.targetText || "Cloze card"}</p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={cancelEdit}
              disabled={savingEdit}
              title="Close editor"
              aria-label="Close editor"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <form
            className="card-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit(editingCard);
            }}
          >
            <label>
              Type
              <select
                value={editDraft.type}
                onChange={(event) => {
                  const nextType = event.target.value as CardType;
                  updateEditDraft({
                    type: nextType,
                    targetText: nextType === "cloze" ? editDraft.targetText : "",
                    targetStart: nextType === "cloze" ? editDraft.targetStart : undefined,
                    targetEnd: nextType === "cloze" ? editDraft.targetEnd : undefined,
                    hint: nextType === "cloze" ? editDraft.hint : ""
                  });
                }}
              >
                <option value="basic">Basic</option>
                <option value="cloze">Cloze</option>
              </select>
            </label>

            <div className="card-face-group">
              <h4>Front</h4>
              <label>
                Croatian sentence
                <textarea
                  ref={editTextareaRef}
                  value={editDraft.croatianSentence}
                  onChange={(event) => {
                    updateEditDraft({
                      croatianSentence: event.target.value,
                      targetText: "",
                      targetStart: undefined,
                      targetEnd: undefined
                    });
                    setPendingEditSelection(null);
                  }}
                  onKeyUp={captureEditSelection}
                  onMouseUp={captureEditSelection}
                  onPointerUp={captureEditSelection}
                  onSelect={captureEditSelection}
                  onTouchEnd={captureEditSelection}
                  rows={3}
                />
              </label>

              {editNeedsHiddenText && (
                <>
                  <div className="target-row">
                    <div className={`target-summary ${editDraft.targetText ? "selected" : ""}`} aria-live="polite">
                      <div className="target-summary-head">
                        <span>Hidden text</span>
                        {editDraft.targetText && (
                          <button
                            type="button"
                            className="target-clear-button"
                            onClick={clearEditTargetSelection}
                            title="Clear hidden text"
                            aria-label="Clear hidden text"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      <strong className={editDraft.targetText ? "" : "empty"}>
                        {editDraft.targetText || "None selected"}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="secondary target-hide-button"
                      disabled={!pendingEditSelection}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={hideEditSelection}
                    >
                      {editDraft.targetText ? "Replace" : "Hide selection"}
                    </button>
                  </div>
                  {editDraft.targetText && !editTargetInSentence && (
                    <p className="field-error">Hidden text must match the Croatian text exactly.</p>
                  )}

                  <label>
                    Hint (optional)
                    <input
                      value={editDraft.hint}
                      onChange={(event) => updateEditDraft({ hint: event.target.value })}
                      placeholder="e.g. to buy"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="card-face-group">
              <h4>Back</h4>
              <label>
                English
                <textarea
                  value={editDraft.englishTranslation}
                  onChange={(event) => updateEditDraft({ englishTranslation: event.target.value })}
                  rows={2}
                />
              </label>

              <label>
                Notes
                <textarea
                  value={editDraft.note}
                  onChange={(event) => updateEditDraft({ note: event.target.value })}
                  rows={2}
                />
              </label>
            </div>

            <div className="mine-preview">
              <TargetSentence
                sentence={editDraft.croatianSentence}
                target={editNeedsHiddenText ? editDraft.targetText : ""}
                targetStart={editNeedsHiddenText ? editDraft.targetStart : undefined}
                targetEnd={editNeedsHiddenText ? editDraft.targetEnd : undefined}
              />
            </div>

            <div className="button-row card-edit-actions">
              <button type="submit" disabled={!canSaveEdit}>
                <Save size={16} aria-hidden="true" />
                {savingEdit ? "Saving..." : "Save changes"}
              </button>
              <button type="button" className="secondary" onClick={cancelEdit} disabled={savingEdit}>
                <X size={16} aria-hidden="true" />
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void deleteCard(editingCard)}
                disabled={savingEdit}
              >
                <Trash2 size={16} aria-hidden="true" />
                Delete
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  function renderCard(card: MinedCard) {
    return (
      <article className="card-row" key={card.id}>
        <button
          className="card-row-open"
          type="button"
          onClick={() => startEdit(card)}
          aria-label={`Edit card: ${card.croatianSentence}`}
        >
          <span className="card-row-head">
            <span className="pill">{card.type}</span>
            <strong>{card.type === "basic" ? "Croatian to English" : card.targetText}</strong>
          </span>
          <span className="card-row-text">{card.croatianSentence}</span>
          <span className="card-row-text muted">{card.englishTranslation}</span>
          {card.hint && <span className="card-row-text muted">Hint: {card.hint}</span>}
          {card.note && <span className="card-row-text muted">{card.note}</span>}
          {card.syncError && card.syncStatus !== "synced" && (
            <span className="card-row-error field-error">{card.syncError}</span>
          )}
        </button>
        <div className="card-row-actions">
          <span className={`sync-pill ${card.syncStatus}`}>{syncLabel(card)}</span>
          {card.audioFile && (
            <button
              className="audio-play"
              type="button"
              onClick={() => {
                void playAudio(card);
              }}
              disabled={playingId === card.id}
            >
              <Volume2 size={13} aria-hidden="true" />
              {playingId === card.id ? "Playing" : "Audio"}
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <main className="cards-view">
      <div className="cards-toolbar">
        <div>
          <h1>Cards</h1>
          <p>
            {cards.length} saved / {syncedCount} synced / {pendingCount} pending
            {errorCount ? ` / ${errorCount} retry` : ""}
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => void syncCards()} disabled={syncing || cards.length === 0}>
            <Send size={16} aria-hidden="true" />
            {syncing ? "Syncing..." : "Sync to Anki"}
          </button>
        </div>
      </div>

      {message && <p className="success-line">{message}</p>}

      {cards.length === 0 && <p className="muted">No cards yet. Mine a sentence from the reader.</p>}
      {cards.length > 0 && (
        <>
          <div className="cards-page-tabs" role="tablist" aria-label="Card sync status">
            <button
              className={activeCardsTab === "pending" ? "active" : ""}
              role="tab"
              aria-selected={activeCardsTab === "pending"}
              onClick={() => selectCardsTab("pending")}
            >
              Pending
              <span>{pendingCount}</span>
            </button>
            <button
              className={activeCardsTab === "synced" ? "active" : ""}
              role="tab"
              aria-selected={activeCardsTab === "synced"}
              onClick={() => selectCardsTab("synced")}
            >
              Synced
              <span>{syncedCount}</span>
            </button>
          </div>

          <section className="cards-list" role="tabpanel" aria-label={activeCardsTab === "pending" ? "Pending cards" : "Synced cards"}>
            {visibleCards.length === 0 && (
              <p className="muted">{activeCardsTab === "pending" ? "No pending cards." : "No synced cards."}</p>
            )}
            {visibleCards.map(renderCard)}
          </section>
        </>
      )}
      {renderEditModal()}
    </main>
  );
}
