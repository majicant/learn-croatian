import { Pencil, Save, Send, Trash2, Volume2, X } from "lucide-react";
import { useRef, useState } from "react";
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
  englishTranslation: string;
  hint: string;
  note: string;
};
type CardsTab = "pending" | "synced";

function cardToEditDraft(card: MinedCard): CardEditDraft {
  return {
    type: card.type,
    croatianSentence: card.croatianSentence,
    targetText: card.targetText || "",
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
  const [pendingEditSelection, setPendingEditSelection] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const pendingCount = cards.filter((card) => !isSynced(card)).length;
  const syncedCount = cards.filter(isSynced).length;
  const errorCount = cards.filter((card) => card.syncStatus === "error").length;
  const pendingCards = cards.filter((card) => !isSynced(card));
  const syncedCards = cards.filter(isSynced);
  const activeCardsTab: CardsTab = selectedCardsTab || (pendingCount > 0 ? "pending" : "synced");
  const visibleCards = activeCardsTab === "pending" ? pendingCards : syncedCards;

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
    setPendingEditSelection("");
  }

  function cancelEdit() {
    setEditingId("");
    setEditDraft(null);
    setPendingEditSelection("");
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
      setPendingEditSelection("");
      return;
    }

    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
    if (selected && textarea.value.includes(selected)) {
      setPendingEditSelection(selected);
    }
  }

  function hideEditSelection() {
    if (!pendingEditSelection) return;
    updateEditDraft({ targetText: pendingEditSelection });
    setPendingEditSelection("");
    window.getSelection()?.removeAllRanges();
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

  function renderCard(card: MinedCard) {
    const isEditing = editingId === card.id && editDraft;
    const editNeedsHiddenText = editDraft?.type === "cloze";
    const editTargetInSentence = Boolean(
      editDraft?.targetText && editDraft.croatianSentence.includes(editDraft.targetText)
    );
    const canSaveEdit = Boolean(
      editDraft &&
        editDraft.croatianSentence &&
        editDraft.englishTranslation &&
        !savingEdit &&
        (!editNeedsHiddenText || (editDraft.targetText && editTargetInSentence))
    );

    return (
      <article className={`card-row ${isEditing ? "editing" : ""}`} key={card.id}>
        <div className="card-row-main">
          <div className="card-row-head">
            <span className="pill">{card.type}</span>
            <strong>{card.type === "basic" ? "Croatian to English" : card.targetText}</strong>
          </div>

          {isEditing ? (
            <form className="card-edit-form" onSubmit={(event) => {
              event.preventDefault();
              void saveEdit(card);
            }}>
              <label>
                Type
                <select
                  value={editDraft.type}
                  onChange={(event) => {
                    const nextType = event.target.value as CardType;
                    updateEditDraft({
                      type: nextType,
                      targetText: nextType === "cloze" ? editDraft.targetText : "",
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
                      updateEditDraft({ croatianSentence: event.target.value });
                      setPendingEditSelection("");
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
                      <label>
                        Hidden text
                        <input
                          value={editDraft.targetText}
                          onChange={(event) => {
                            updateEditDraft({ targetText: event.target.value });
                            setPendingEditSelection("");
                          }}
                          placeholder="Highlight text above, then click Hide"
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!pendingEditSelection}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={hideEditSelection}
                      >
                        Hide
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
                  <textarea value={editDraft.note} onChange={(event) => updateEditDraft({ note: event.target.value })} rows={2} />
                </label>
              </div>

              <div className="mine-preview">
                <TargetSentence
                  sentence={editDraft.croatianSentence}
                  target={editNeedsHiddenText ? editDraft.targetText : ""}
                />
              </div>

              <div className="button-row card-edit-actions">
                <button type="submit" disabled={!canSaveEdit}>
                  <Save size={16} aria-hidden="true" />
                  {savingEdit ? "Saving..." : "Save changes"}
                </button>
                <button type="button" className="secondary" onClick={cancelEdit}>
                  <X size={16} aria-hidden="true" />
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <p>{card.croatianSentence}</p>
              <p className="muted">{card.englishTranslation}</p>
              {card.hint && <p className="muted">Hint: {card.hint}</p>}
              {card.note && <p className="muted">{card.note}</p>}
              {card.syncError && card.syncStatus !== "synced" && <p className="field-error">{card.syncError}</p>}
            </>
          )}
        </div>
        <div className="card-row-actions">
          <span className={`sync-pill ${card.syncStatus}`}>{syncLabel(card)}</span>
          {card.audioFile && (
            <button className="audio-play" type="button" onClick={() => void playAudio(card)} disabled={playingId === card.id}>
              <Volume2 size={13} aria-hidden="true" />
              {playingId === card.id ? "Playing" : "Audio"}
            </button>
          )}
          {!isEditing && (
            <button className="secondary icon-text" onClick={() => startEdit(card)}>
              <Pencil size={16} aria-hidden="true" />
              Edit
            </button>
          )}
          <button className="danger icon-text" onClick={() => void deleteCard(card)}>
            <Trash2 size={16} aria-hidden="true" />
            Delete
          </button>
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
    </main>
  );
}
