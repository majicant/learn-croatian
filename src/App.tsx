import {
  BookOpen,
  FilePlus2,
  Library,
  Settings as SettingsIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "./api/client";
import { DEFAULT_SETTINGS } from "./constants";
import { buildPages, sentenceList } from "./domain/stories";
import { CardsView } from "./features/cards/CardsView";
import { ImportView } from "./features/import/ImportView";
import { ReaderView } from "./features/reader/ReaderView";
import { SettingsView } from "./features/settings/SettingsView";
import type { Analysis, MinedCard, SettingsState, Sentence, Story, StorySummary, View } from "./types";

function App() {
  const [view, setView] = useState<View>("read");
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [story, setStory] = useState<Story | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string>("");
  const [selectedSentenceId, setSelectedSentenceId] = useState<string>("");
  const [cards, setCards] = useState<MinedCard[]>([]);
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [pageIndex, setPageIndex] = useState(0);
  const [loadingStory, setLoadingStory] = useState(false);
  const [analyzingId, setAnalyzingId] = useState("");
  const [error, setError] = useState("");

  const selectedSentence = useMemo(
    () => sentenceList(story).find((sentence) => sentence.id === selectedSentenceId) || null,
    [story, selectedSentenceId]
  );
  const selectedSentenceCards = useMemo(
    () =>
      selectedSentence && story
        ? cards.filter((card) => card.storyId === story.id && card.sentenceId === selectedSentence.id)
        : [],
    [cards, selectedSentence, story]
  );
  const pages = useMemo(() => buildPages(story?.paragraphs || []), [story]);
  const currentSummary = stories.find((item) => item.id === story?.id);

  async function loadStories(nextSelectedId?: string) {
    const payload = await apiJson<{ stories: StorySummary[] }>("/api/texts");
    setStories(payload.stories);
    if (nextSelectedId) {
      setSelectedStoryId(nextSelectedId);
    } else if (!selectedStoryId && payload.stories.length) {
      setSelectedStoryId(payload.stories[0].id);
    }
  }

  async function loadCards() {
    const payload = await apiJson<{ cards: MinedCard[] }>("/api/cards");
    setCards(payload.cards);
  }

  async function loadSettings() {
    const payload = await apiJson<{ settings: SettingsState }>("/api/settings");
    setSettings(payload.settings);
  }

  async function loadStory(id: string) {
    setLoadingStory(true);
    try {
      const payload = await apiJson<{ story: Story }>(`/api/texts/${id}`);
      setStory(payload.story);
    } finally {
      setLoadingStory(false);
    }
  }

  async function refreshStoryAndCards() {
    await Promise.all([selectedStoryId ? loadStory(selectedStoryId) : Promise.resolve(), loadCards(), loadStories()]);
  }

  useEffect(() => {
    Promise.all([loadStories(), loadCards(), loadSettings()]).catch((caught) => setError(caught.message));
  }, []);

  useEffect(() => {
    if (!selectedStoryId) {
      setStory(null);
      return;
    }
    setPageIndex(0);
    clearSelectedSentence();
    loadStory(selectedStoryId).catch((caught) => setError(caught.message));
  }, [selectedStoryId]);

  useEffect(() => {
    if (pageIndex > pages.length - 1) setPageIndex(Math.max(0, pages.length - 1));
  }, [pageIndex, pages.length]);

  async function analyzeSentence(sentence: Sentence) {
    if (!story || sentence.analysis || analyzingId === sentence.id) return;
    setAnalyzingId(sentence.id);
    setError("");
    try {
      const payload = await apiJson<{ analysis: Analysis }>(
        `/api/texts/${story.id}/sentences/${sentence.id}/analyze`,
        { method: "POST" }
      );
      setStory((current) => {
        if (!current) return current;
        return {
          ...current,
          paragraphs: current.paragraphs.map((paragraph) => ({
            ...paragraph,
            sentences: paragraph.sentences.map((item) =>
              item.id === sentence.id ? { ...item, analysis: payload.analysis } : item
            )
          }))
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setAnalyzingId("");
    }
  }

  function chooseSentence(sentence: Sentence) {
    if (selectedSentenceId === sentence.id) {
      clearSelectedSentence();
      return;
    }
    setSelectedSentenceId(sentence.id);
    void analyzeSentence(sentence);
  }

  function clearSelectedSentence() {
    setSelectedSentenceId("");
    window.getSelection()?.removeAllRanges();
  }

  async function toggleCompleted(completed: boolean) {
    if (!story) return;
    await apiJson(`/api/progress/${story.id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed })
    });
    await loadStories();
  }

  async function selectImportedStory(storyId: string) {
    await loadStories(storyId);
    await loadCards();
    setView("read");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BookOpen size={20} aria-hidden="true" />
          <span>Learn Croatian</span>
        </div>
        <nav className="tabs" aria-label="Main views">
          <button className={view === "read" ? "active" : ""} onClick={() => setView("read")}>
            <BookOpen size={16} aria-hidden="true" />
            Read
          </button>
          <button className={view === "import" ? "active" : ""} onClick={() => setView("import")}>
            <FilePlus2 size={16} aria-hidden="true" />
            Import
          </button>
          <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>
            <Library size={16} aria-hidden="true" />
            Cards
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <SettingsIcon size={16} aria-hidden="true" />
            Settings
          </button>
        </nav>
      </header>

      {error && (
        <div className="notice" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}

      {view === "read" && (
        <ReaderView
          stories={stories}
          selectedStoryId={selectedStoryId}
          onSelectStory={setSelectedStoryId}
          story={story}
          loadingStory={loadingStory}
          pages={pages}
          pageIndex={pageIndex}
          setPageIndex={setPageIndex}
          selectedSentence={selectedSentence}
          selectedSentenceCards={selectedSentenceCards}
          analyzingId={analyzingId}
          onChooseSentence={chooseSentence}
          onCloseSentence={clearSelectedSentence}
          onToggleCompleted={toggleCompleted}
          completed={Boolean(currentSummary?.completed)}
          refreshStoryAndCards={refreshStoryAndCards}
          setError={setError}
        />
      )}

      {view === "import" && <ImportView onImported={selectImportedStory} setError={setError} />}

      {view === "cards" && <CardsView cards={cards} reloadCards={loadCards} setError={setError} />}

      {view === "settings" && (
        <SettingsView settings={settings} reloadSettings={loadSettings} setError={setError} />
      )}
    </div>
  );
}

export default App;
