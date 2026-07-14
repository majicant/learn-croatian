import { Search, Send, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiJson } from "../../api/client";
import { isSynced, syncLabel } from "../../domain/cards";
import type { MinedCard, StorySummary } from "../../types";
import { CardEditModal } from "./CardEditModal";

type CardsProps = {
  cards: MinedCard[];
  stories: StorySummary[];
  reloadCards: () => Promise<void>;
  setError: (message: string) => void;
};

type CardsTab = "pending" | "synced";

function cardMatchesSearch(card: MinedCard, searchTerm: string) {
  const searchableText = [
    card.croatianSentence,
    card.englishTranslation,
    card.targetText,
    card.hint,
    card.note
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("hr");

  return searchableText.includes(searchTerm);
}

export function CardsView({ cards, stories, reloadCards, setError }: CardsProps) {
  const [syncing, setSyncing] = useState(false);
  const [playingId, setPlayingId] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCardsTab, setSelectedCardsTab] = useState<CardsTab | "">("");
  const [cardSearchQuery, setCardSearchQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const pendingCount = cards.filter((card) => !isSynced(card)).length;
  const syncedCount = cards.filter(isSynced).length;
  const errorCount = cards.filter((card) => card.syncStatus === "error").length;
  const pendingCards = cards.filter((card) => !isSynced(card));
  const syncedCards = cards.filter(isSynced);
  const activeCardsTab: CardsTab = selectedCardsTab || (pendingCount > 0 ? "pending" : "synced");
  const tabCards = activeCardsTab === "pending" ? pendingCards : syncedCards;
  const cardSearchTerm = cardSearchQuery.trim().toLocaleLowerCase("hr");
  const visibleCards = cardSearchTerm ? tabCards.filter((card) => cardMatchesSearch(card, cardSearchTerm)) : tabCards;
  const editingCard = cards.find((card) => card.id === editingId) || null;
  const editingCardStoryAudioFile = editingCard
    ? stories.find((story) => story.id === editingCard.storyId)?.audioFile || null
    : null;

  useEffect(() => {
    if (!editingId || editingCard) return;
    cancelEdit();
  }, [editingCard, editingId]);

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
  }

  function cancelEdit() {
    setEditingId("");
  }

  function selectCardsTab(tab: CardsTab) {
    cancelEdit();
    setSelectedCardsTab(tab);
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
          <div className="cards-list-controls">
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
            <div className="card-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={cardSearchQuery}
                onChange={(event) => setCardSearchQuery(event.target.value)}
                placeholder="Search cards"
                aria-label="Search cards"
                spellCheck={false}
              />
              {cardSearchQuery && (
                <button
                  className="card-search-clear icon-button"
                  type="button"
                  onClick={() => setCardSearchQuery("")}
                  aria-label="Clear card search"
                  title="Clear search"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <section className="cards-list" role="tabpanel" aria-label={activeCardsTab === "pending" ? "Pending cards" : "Synced cards"}>
            {visibleCards.length === 0 && (
              <p className="muted">
                {cardSearchTerm
                  ? "No matching cards."
                  : activeCardsTab === "pending"
                    ? "No pending cards."
                    : "No synced cards."}
              </p>
            )}
            {visibleCards.map(renderCard)}
          </section>
        </>
      )}
      {editingCard && (
        <CardEditModal
          key={editingCard.id}
          card={editingCard}
          onClose={cancelEdit}
          onCardsChanged={reloadCards}
          setError={setError}
          onMessage={setMessage}
          storyAudioFile={editingCardStoryAudioFile}
        />
      )}
    </main>
  );
}
