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
import type { Analysis, MinedCard, SettingsState, Sentence, Story, StoryFolder, StorySummary, View } from "./types";

function App() {
  const [view, setView] = useState<View>("read");
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [storyFolders, setStoryFolders] = useState<StoryFolder[]>([]);
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

  async function loadStoryFolders() {
    const payload = await apiJson<{ folders: StoryFolder[] }>("/api/texts/folders");
    setStoryFolders(payload.folders);
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
    Promise.all([loadStories(), loadStoryFolders(), loadCards(), loadSettings()]).catch((caught) => setError(caught.message));
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

  async function analyzeSentence(sentence: Sentence, force = false) {
    if (!story || (!force && sentence.analysis) || analyzingId === sentence.id) return;
    setAnalyzingId(sentence.id);
    setError("");
    try {
      const payload = await apiJson<{ analysis: Analysis }>(
        `/api/texts/${story.id}/sentences/${sentence.id}/analyze`,
        force
          ? {
              method: "POST",
              body: JSON.stringify({ force: true })
            }
          : { method: "POST" }
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

  async function createStoryFolder() {
    const payload = await apiJson<{ folder: StoryFolder }>("/api/texts/folders", {
      method: "POST",
      body: JSON.stringify({})
    });
    setStoryFolders((current) => [...current, payload.folder]);
    return payload.folder;
  }

  async function renameStoryFolder(folderId: string, name: string) {
    const payload = await apiJson<{ folder: StoryFolder }>(`/api/texts/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
    setStoryFolders((current) => current.map((item) => (item.id === folderId ? payload.folder : item)));
  }

  async function renameStory(storyId: string, title: string) {
    const payload = await apiJson<{ title: string }>(`/api/texts/${storyId}`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    });
    setStories((current) => current.map((item) => (item.id === storyId ? { ...item, title: payload.title } : item)));
    setStory((current) => (current?.id === storyId ? { ...current, title: payload.title } : current));
  }

  async function changeStoryLevel(storyId: string, level: string) {
    const payload = await apiJson<{ level: string }>(`/api/texts/${storyId}`, {
      method: "PATCH",
      body: JSON.stringify({ level })
    });
    setStories((current) => current.map((item) => (item.id === storyId ? { ...item, level: payload.level } : item)));
    setStory((current) => (current?.id === storyId ? { ...current, level: payload.level } : current));
  }

  async function updateStorySentence(storyId: string, sentenceId: string, croatian: string) {
    const payload = await apiJson<{ sentence: Sentence }>(`/api/texts/${storyId}/sentences/${sentenceId}`, {
      method: "PATCH",
      body: JSON.stringify({ croatian })
    });
    setStory((current) => {
      if (!current || current.id !== storyId) return current;
      return {
        ...current,
        paragraphs: current.paragraphs.map((paragraph) => ({
          ...paragraph,
          sentences: paragraph.sentences.map((item) => (item.id === sentenceId ? payload.sentence : item))
        }))
      };
    });
  }

  async function deleteStorySentence(storyId: string, sentenceId: string) {
    const payload = await apiJson<{ story: Story }>(`/api/texts/${storyId}/sentences/${sentenceId}`, {
      method: "DELETE"
    });
    setStory((current) => (current?.id === storyId ? payload.story : current));
    if (selectedSentenceId === sentenceId) {
      clearSelectedSentence();
    }
  }

  async function moveStoryToFolder(storyId: string, folderId: string) {
    await apiJson(`/api/texts/${storyId}/folder`, {
      method: "PATCH",
      body: JSON.stringify({ folderId })
    });
    await loadStories();
    setStory((current) => (current?.id === storyId ? { ...current, folderId } : current));
  }

  async function deleteStory(storyId: string) {
    await apiJson(`/api/texts/${storyId}`, { method: "DELETE" });
    const remainingStories = stories.filter((item) => item.id !== storyId);
    setStories(remainingStories);
    if (selectedStoryId === storyId) {
      setSelectedStoryId(remainingStories[0]?.id || "");
      if (!remainingStories.length) setStory(null);
    }
  }

  async function deleteStoryFolder(folderId: string) {
    await apiJson(`/api/texts/folders/${folderId}`, { method: "DELETE" });
    const deletedStoryIds = new Set(stories.filter((item) => item.folderId === folderId).map((item) => item.id));
    const remainingStories = stories.filter((item) => !deletedStoryIds.has(item.id));
    setStoryFolders((current) => current.filter((item) => item.id !== folderId));
    setStories(remainingStories);
    if (deletedStoryIds.has(selectedStoryId)) {
      setSelectedStoryId(remainingStories[0]?.id || "");
      if (!remainingStories.length) setStory(null);
    }
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
          storyFolders={storyFolders}
          selectedStoryId={selectedStoryId}
          onSelectStory={setSelectedStoryId}
          onCreateFolder={createStoryFolder}
          onRenameFolder={renameStoryFolder}
          onRenameStory={renameStory}
          onChangeStoryLevel={changeStoryLevel}
          onUpdateSentence={updateStorySentence}
          onDeleteSentence={deleteStorySentence}
          onMoveStoryToFolder={moveStoryToFolder}
          onDeleteFolder={deleteStoryFolder}
          onDeleteStory={deleteStory}
          story={story}
          loadingStory={loadingStory}
          pages={pages}
          pageIndex={pageIndex}
          setPageIndex={setPageIndex}
          selectedSentence={selectedSentence}
          selectedSentenceCards={selectedSentenceCards}
          analyzingId={analyzingId}
          onChooseSentence={chooseSentence}
          onAnalyzeSentence={analyzeSentence}
          onCloseSentence={clearSelectedSentence}
          onToggleCompleted={toggleCompleted}
          completed={Boolean(currentSummary?.completed)}
          refreshStoryAndCards={refreshStoryAndCards}
          setError={setError}
        />
      )}

      {view === "import" && <ImportView storyFolders={storyFolders} onImported={selectImportedStory} setError={setError} />}

      {view === "cards" && <CardsView cards={cards} reloadCards={loadCards} setError={setError} />}

      {view === "settings" && (
        <SettingsView settings={settings} reloadSettings={loadSettings} setError={setError} />
      )}
    </div>
  );
}

export default App;
