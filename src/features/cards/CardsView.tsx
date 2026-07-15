import { ChevronLeft, ChevronRight, ListFilter, Search, Send, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api/client";
import { READING_LEVELS } from "../../constants";
import { isSynced, syncLabel } from "../../domain/cards";
import { folderPickerOptions, isSameOrDescendantFolder } from "../../domain/stories";
import type { MinedCard, StoryFolder, StorySummary } from "../../types";
import { CardEditModal } from "./CardEditModal";

type CardsProps = {
  cards: MinedCard[];
  stories: StorySummary[];
  storyFolders: StoryFolder[];
  reloadCards: () => Promise<void>;
  setError: (message: string) => void;
};

type CardsTab = "pending" | "synced";
type CardSourceFilters = {
  folderId: string;
  storyId: string;
  level: string;
};

const CARDS_PER_PAGE = 10;
const UNFILED_FOLDER_FILTER = "__unfiled__";
const EMPTY_CARD_SOURCE_FILTERS: CardSourceFilters = {
  folderId: "",
  storyId: "",
  level: ""
};
const croatianNaturalCollator = new Intl.Collator("hr", { numeric: true });

function compareReadingLevels(a: string, b: string) {
  const aIndex = READING_LEVELS.indexOf(a);
  const bIndex = READING_LEVELS.indexOf(b);
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
      (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  }
  return croatianNaturalCollator.compare(a, b);
}

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

export function CardsView({ cards, stories, storyFolders, reloadCards, setError }: CardsProps) {
  const [syncing, setSyncing] = useState(false);
  const [playingId, setPlayingId] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCardsTab, setSelectedCardsTab] = useState<CardsTab | "">("");
  const [cardSearchQuery, setCardSearchQuery] = useState("");
  const [cardSourceFilters, setCardSourceFilters] = useState<CardSourceFilters>(() => ({
    ...EMPTY_CARD_SOURCE_FILTERS
  }));
  const [cardFilterMenuOpen, setCardFilterMenuOpen] = useState(false);
  const [cardsPageIndex, setCardsPageIndex] = useState(0);
  const [editingId, setEditingId] = useState("");
  const pendingCount = cards.filter((card) => !isSynced(card)).length;
  const syncedCount = cards.filter(isSynced).length;
  const errorCount = cards.filter((card) => card.syncStatus === "error").length;
  const pendingCards = cards.filter((card) => !isSynced(card));
  const syncedCards = cards.filter(isSynced);
  const activeCardsTab: CardsTab = selectedCardsTab || (pendingCount > 0 ? "pending" : "synced");
  const tabCards = activeCardsTab === "pending" ? pendingCards : syncedCards;
  const cardSearchTerm = cardSearchQuery.trim().toLocaleLowerCase("hr");
  const storyById = useMemo(() => new Map(stories.map((story) => [story.id, story])), [stories]);
  const cardStoryIds = useMemo(() => new Set(cards.map((card) => card.storyId)), [cards]);
  const cardSourceStories = useMemo(
    () =>
      stories
        .filter((story) => cardStoryIds.has(story.id))
        .sort((a, b) => croatianNaturalCollator.compare(a.title, b.title)),
    [cardStoryIds, stories]
  );
  const cardSourceFolderOptions = useMemo(() => folderPickerOptions(storyFolders), [storyFolders]);
  const cardSourceLevels = useMemo(
    () =>
      Array.from(new Set(cardSourceStories.map((story) => story.level || "Other"))).sort(compareReadingLevels),
    [cardSourceStories]
  );
  const hasCardSourceFilters = Boolean(
    cardSourceFilters.folderId || cardSourceFilters.storyId || cardSourceFilters.level
  );
  const isCardListFiltered = Boolean(cardSearchTerm) || hasCardSourceFilters;
  const visibleCards = tabCards.filter((card) => {
    if (cardSearchTerm && !cardMatchesSearch(card, cardSearchTerm)) return false;
    if (cardSourceFilters.storyId && card.storyId !== cardSourceFilters.storyId) return false;

    if (cardSourceFilters.folderId || cardSourceFilters.level) {
      const sourceStory = storyById.get(card.storyId);
      if (!sourceStory) return false;

      if (cardSourceFilters.folderId) {
        const folderMatches =
          cardSourceFilters.folderId === UNFILED_FOLDER_FILTER
            ? !sourceStory.folderId
            : isSameOrDescendantFolder(sourceStory.folderId, cardSourceFilters.folderId);
        if (!folderMatches) return false;
      }

      if (cardSourceFilters.level && (sourceStory.level || "Other") !== cardSourceFilters.level) {
        return false;
      }
    }

    return true;
  });
  const cardsPageCount = Math.ceil(visibleCards.length / CARDS_PER_PAGE);
  const activeCardsPageIndex = Math.min(cardsPageIndex, Math.max(0, cardsPageCount - 1));
  const pageStartIndex = activeCardsPageIndex * CARDS_PER_PAGE;
  const paginatedCards = visibleCards.slice(pageStartIndex, pageStartIndex + CARDS_PER_PAGE);
  const editingCard = cards.find((card) => card.id === editingId) || null;
  const editingCardStoryAudioFile = editingCard
    ? stories.find((story) => story.id === editingCard.storyId)?.audioFile || null
    : null;

  useEffect(() => {
    if (!editingId || editingCard) return;
    cancelEdit();
  }, [editingCard, editingId]);

  useEffect(() => {
    if (!cardFilterMenuOpen) return;
    const closeFilterMenu = () => setCardFilterMenuOpen(false);
    document.addEventListener("click", closeFilterMenu);
    return () => document.removeEventListener("click", closeFilterMenu);
  }, [cardFilterMenuOpen]);

  useEffect(() => {
    setCardsPageIndex(0);
  }, [activeCardsTab]);

  useEffect(() => {
    setCardsPageIndex((current) => Math.min(current, Math.max(0, cardsPageCount - 1)));
  }, [cardsPageCount]);

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
    setCardsPageIndex(0);
    setSelectedCardsTab(tab);
  }

  function updateCardSearch(query: string) {
    setCardSearchQuery(query);
    setCardsPageIndex(0);
  }

  function updateCardSourceFilter(name: keyof CardSourceFilters, value: string) {
    setCardSourceFilters((current) => ({ ...current, [name]: value }));
    setCardsPageIndex(0);
  }

  function clearCardSourceFilters() {
    setCardSourceFilters({ ...EMPTY_CARD_SOURCE_FILTERS });
    setCardsPageIndex(0);
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
                onChange={(event) => updateCardSearch(event.target.value)}
                placeholder="Search cards"
                aria-label="Search cards"
                spellCheck={false}
              />
              {cardSearchQuery && (
                <button
                  className="card-search-clear icon-button"
                  type="button"
                  onClick={() => updateCardSearch("")}
                  aria-label="Clear card search"
                  title="Clear search"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
              <div className="card-filter-menu-wrap" onClick={(event) => event.stopPropagation()}>
                <button
                  className={`card-filter-button icon-button ${hasCardSourceFilters ? "active" : ""}`}
                  type="button"
                  onClick={() => setCardFilterMenuOpen((current) => !current)}
                  aria-label="Filter cards by source"
                  aria-expanded={cardFilterMenuOpen}
                  aria-haspopup="dialog"
                  title="Filter cards"
                >
                  <ListFilter size={15} aria-hidden="true" />
                </button>
                {cardFilterMenuOpen && (
                  <div className="card-filter-menu" role="dialog" aria-label="Card source filters">
                    <div className="card-filter-menu-head">
                      <strong>Filter by source</strong>
                      {hasCardSourceFilters && (
                        <button className="card-filter-clear" type="button" onClick={clearCardSourceFilters}>
                          Clear
                        </button>
                      )}
                    </div>
                    <label>
                      <span>Folder</span>
                      <select
                        value={cardSourceFilters.folderId}
                        onChange={(event) => updateCardSourceFilter("folderId", event.target.value)}
                      >
                        <option value="">All folders</option>
                        <option value={UNFILED_FOLDER_FILTER}>Unfiled</option>
                        {cardSourceFolderOptions.map(({ folder, label }) => (
                          <option value={folder.id} key={folder.id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <span className="card-filter-hint">Includes subfolders.</span>
                    </label>
                    <label>
                      <span>Story</span>
                      <select
                        value={cardSourceFilters.storyId}
                        onChange={(event) => updateCardSourceFilter("storyId", event.target.value)}
                      >
                        <option value="">All stories</option>
                        {cardSourceStories.map((story) => (
                          <option value={story.id} key={story.id}>
                            {story.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Reading level</span>
                      <select
                        value={cardSourceFilters.level}
                        onChange={(event) => updateCardSourceFilter("level", event.target.value)}
                      >
                        <option value="">All levels</option>
                        {cardSourceLevels.map((level) => (
                          <option value={level} key={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>

          {cardsPageCount > 1 && (
            <nav className="cards-pagination" aria-label="Card pages">
              <p>
                Showing {pageStartIndex + 1}–{Math.min(pageStartIndex + CARDS_PER_PAGE, visibleCards.length)} of{" "}
                {visibleCards.length}
              </p>
              <div className="cards-pagination-controls">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setCardsPageIndex(activeCardsPageIndex - 1)}
                  disabled={activeCardsPageIndex === 0}
                  aria-label="Previous card page"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous
                </button>
                <span aria-live="polite">
                  Page {activeCardsPageIndex + 1} of {cardsPageCount}
                </span>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setCardsPageIndex(activeCardsPageIndex + 1)}
                  disabled={activeCardsPageIndex === cardsPageCount - 1}
                  aria-label="Next card page"
                >
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}

          <section className="cards-list" role="tabpanel" aria-label={activeCardsTab === "pending" ? "Pending cards" : "Synced cards"}>
            {visibleCards.length === 0 && (
              <p className="muted">
                {isCardListFiltered
                  ? "No matching cards."
                  : activeCardsTab === "pending"
                    ? "No pending cards."
                    : "No synced cards."}
              </p>
            )}
            {paginatedCards.map(renderCard)}
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
