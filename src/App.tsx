import {
  BookOpen,
  FilePlus2,
  Library,
  Settings as SettingsIcon
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "./api/client";
import { DEFAULT_SETTINGS } from "./constants";
import { buildPages, isSameOrDescendantFolder, sentenceList } from "./domain/stories";
import { CardsView } from "./features/cards/CardsView";
import { ImportView } from "./features/import/ImportView";
import { ReaderView, type StorySidebarMode } from "./features/reader/ReaderView";
import { SettingsView } from "./features/settings/SettingsView";
import type {
  Analysis,
  CardLoadState,
  MinedCard,
  SettingsState,
  Sentence,
  Story,
  StoryFolder,
  StorySummary,
  View
} from "./types";

function cleanPageIndex(value: unknown) {
  const pageIndex = Number(value);
  return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : 0;
}

function clampPageIndex(pageIndex: number, pageCount: number) {
  return Math.min(cleanPageIndex(pageIndex), Math.max(0, pageCount - 1));
}

function App() {
  const [view, setView] = useState<View>("read");
  const [readerSidebarMode, setReaderSidebarMode] = useState<StorySidebarMode>("folder");
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [storyFolders, setStoryFolders] = useState<StoryFolder[]>([]);
  const [story, setStory] = useState<Story | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string>("");
  const [selectedSentenceId, setSelectedSentenceId] = useState<string>("");
  const [cards, setCards] = useState<MinedCard[]>([]);
  const [cardLoadState, setCardLoadState] = useState<CardLoadState>("loading");
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [pageIndex, setPageIndexState] = useState(0);
  const [loadingStory, setLoadingStory] = useState(false);
  const [analyzingId, setAnalyzingId] = useState("");
  const [error, setError] = useState("");
  const [hasUnsavedReaderEdits, setHasUnsavedReaderEdits] = useState(false);
  const selectedStoryIdRef = useRef(selectedStoryId);

  selectedStoryIdRef.current = selectedStoryId;

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
    try {
      const payload = await apiJson<{ cards: MinedCard[] }>("/api/cards");
      setCards(payload.cards);
      setCardLoadState("ready");
    } catch (caught) {
      setCardLoadState("error");
      throw caught;
    }
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
      const restoredPageIndex = cleanPageIndex(payload.story.pageIndex);
      const nextPageIndex = clampPageIndex(restoredPageIndex, buildPages(payload.story.paragraphs || []).length);
      setStory(payload.story);
      setPageIndexState(nextPageIndex);
      if (restoredPageIndex !== nextPageIndex) {
        saveStoryPageIndex(id, nextPageIndex).catch((caught) => setError(caught.message));
      }
    } finally {
      setLoadingStory(false);
    }
  }

  async function refreshCurrentStory(id: string) {
    const payload = await apiJson<{ story: Story }>(`/api/texts/${id}`);
    setStory((current) =>
      selectedStoryIdRef.current === id && current?.id === id ? payload.story : current
    );
  }

  async function saveStoryPageIndex(storyId: string, nextPageIndex: number) {
    await apiJson(`/api/progress/${storyId}`, {
      method: "PATCH",
      body: JSON.stringify({ pageIndex: cleanPageIndex(nextPageIndex) })
    });
  }

  function setReaderPageIndex(nextPageIndex: number) {
    const cleanIndex = cleanPageIndex(nextPageIndex);
    setPageIndexState(cleanIndex);
    if (selectedStoryId) {
      saveStoryPageIndex(selectedStoryId, cleanIndex).catch((caught) => setError(caught.message));
    }
  }

  async function refreshStoryAndCards() {
    const currentStoryId = selectedStoryIdRef.current;
    await Promise.all([
      currentStoryId ? refreshCurrentStory(currentStoryId) : Promise.resolve(),
      loadCards()
    ]);
  }

  useEffect(() => {
    Promise.all([loadStories(), loadStoryFolders(), loadCards(), loadSettings()]).catch((caught) => setError(caught.message));
  }, []);

  useEffect(() => {
    if (!selectedStoryId) {
      setStory(null);
      setPageIndexState(0);
      return;
    }
    clearSelectedSentence();
    loadStory(selectedStoryId).catch((caught) => setError(caught.message));
  }, [selectedStoryId]);

  useEffect(() => {
    if (!story || story.id !== selectedStoryId) return;

    const nextPageIndex = clampPageIndex(pageIndex, pages.length);
    if (nextPageIndex !== pageIndex) {
      setPageIndexState(nextPageIndex);
      saveStoryPageIndex(story.id, nextPageIndex).catch((caught) => setError(caught.message));
    }
  }, [pageIndex, pages.length, selectedStoryId, story?.id]);

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

  async function toggleCompleted(storyId: string, completed: boolean) {
    await apiJson(`/api/progress/${storyId}`, {
      method: "PATCH",
      body: JSON.stringify({ completed })
    });
    setStories((current) => current.map((item) => (item.id === storyId ? { ...item, completed } : item)));
  }

  async function createStoryFolder(parentId = "") {
    const payload = await apiJson<{ folder: StoryFolder }>("/api/texts/folders", {
      method: "POST",
      body: JSON.stringify({ parentId })
    });
    setStoryFolders((current) => [...current, payload.folder]);
    return payload.folder;
  }

  async function renameStoryFolder(folderId: string, name: string) {
    await apiJson<{ folder: StoryFolder }>(`/api/texts/folders/${encodeURIComponent(folderId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
    await Promise.all([loadStoryFolders(), loadStories(), selectedStoryId ? loadStory(selectedStoryId) : Promise.resolve()]);
  }

  async function moveStoryFolder(folderId: string, parentId: string) {
    await apiJson<{ folder: StoryFolder }>(`/api/texts/folders/${encodeURIComponent(folderId)}/parent`, {
      method: "PATCH",
      body: JSON.stringify({ parentId })
    });
    await Promise.all([loadStoryFolders(), loadStories(), selectedStoryId ? loadStory(selectedStoryId) : Promise.resolve()]);
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

  async function updateStoryText(storyId: string, text: string) {
    const payload = await apiJson<{ story: Story }>(`/api/texts/${encodeURIComponent(storyId)}/text`, {
      method: "PUT",
      body: JSON.stringify({ text })
    });
    setStory((current) =>
      current?.id === storyId ? { ...payload.story, pageIndex: current.pageIndex } : current
    );
    clearSelectedSentence();
  }

  async function uploadStoryAudio(storyId: string, file: File) {
    const contentType = file.type.startsWith("audio/") ? file.type : "application/octet-stream";
    const response = await fetch(`/api/texts/${encodeURIComponent(storyId)}/audio`, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "X-File-Name": encodeURIComponent(file.name)
      },
      body: file
    });
    const payload = (await response.json().catch(() => null)) as { audioFile?: string; error?: string } | null;
    const audioFile = payload?.audioFile;
    if (!response.ok || !audioFile) {
      throw new Error(payload?.error || `Audio upload failed with ${response.status}.`);
    }

    setStories((current) => current.map((item) => (item.id === storyId ? { ...item, audioFile } : item)));
    setStory((current) => (current?.id === storyId ? { ...current, audioFile } : current));
  }

  async function deleteStoryAudio(storyId: string) {
    await apiJson(`/api/texts/${storyId}/audio`, {
      method: "DELETE"
    });

    setStories((current) => current.map((item) => (item.id === storyId ? { ...item, audioFile: null } : item)));
    setStory((current) => (current?.id === storyId ? { ...current, audioFile: null } : current));
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
    await apiJson(`/api/texts/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
    const deletedStoryIds = new Set(
      stories
        .filter((item) => item.folderId === folderId || isSameOrDescendantFolder(item.folderId, folderId))
        .map((item) => item.id)
    );
    const remainingStories = stories.filter((item) => !deletedStoryIds.has(item.id));
    setStoryFolders((current) =>
      current.filter((item) => item.id !== folderId && !isSameOrDescendantFolder(item.id, folderId))
    );
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

  function changeView(nextView: View) {
    if (nextView === view) return;
    if (hasUnsavedReaderEdits && !window.confirm("Discard your unsaved story edits?")) return;
    setView(nextView);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BookOpen size={20} aria-hidden="true" />
          <span>Learn Croatian</span>
        </div>
        <nav className="tabs" aria-label="Main views">
          <button className={view === "read" ? "active" : ""} onClick={() => changeView("read")}>
            <BookOpen size={16} aria-hidden="true" />
            Read
          </button>
          <button className={view === "import" ? "active" : ""} onClick={() => changeView("import")}>
            <FilePlus2 size={16} aria-hidden="true" />
            Import
          </button>
          <button className={view === "cards" ? "active" : ""} onClick={() => changeView("cards")}>
            <Library size={16} aria-hidden="true" />
            Cards
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => changeView("settings")}>
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
          sidebarMode={readerSidebarMode}
          onSidebarModeChange={setReaderSidebarMode}
          selectedStoryId={selectedStoryId}
          onSelectStory={setSelectedStoryId}
          onCreateFolder={createStoryFolder}
          onRenameFolder={renameStoryFolder}
          onRenameStory={renameStory}
          onChangeStoryLevel={changeStoryLevel}
          onUpdateSentence={updateStorySentence}
          onUpdateStoryText={updateStoryText}
          onUnsavedChangesChange={setHasUnsavedReaderEdits}
          onDeleteSentence={deleteStorySentence}
          onUploadStoryAudio={uploadStoryAudio}
          onDeleteStoryAudio={deleteStoryAudio}
          onMoveStoryToFolder={moveStoryToFolder}
          onMoveFolder={moveStoryFolder}
          onDeleteFolder={deleteStoryFolder}
          onDeleteStory={deleteStory}
          story={story}
          loadingStory={loadingStory}
          pages={pages}
          pageIndex={pageIndex}
          setPageIndex={setReaderPageIndex}
          selectedSentence={selectedSentence}
          selectedSentenceCards={selectedSentenceCards}
          allCards={cards}
          cardLoadState={cardLoadState}
          analyzingId={analyzingId}
          onChooseSentence={chooseSentence}
          onAnalyzeSentence={analyzeSentence}
          onCloseSentence={clearSelectedSentence}
          onToggleCompleted={toggleCompleted}
          refreshStoryAndCards={refreshStoryAndCards}
          setError={setError}
        />
      )}

      {view === "import" && <ImportView storyFolders={storyFolders} onImported={selectImportedStory} setError={setError} />}

      {view === "cards" && (
        <CardsView
          cards={cards}
          stories={stories}
          storyFolders={storyFolders}
          reloadCards={loadCards}
          setError={setError}
        />
      )}

      {view === "settings" && (
        <SettingsView settings={settings} reloadSettings={loadSettings} setError={setError} />
      )}
    </div>
  );
}

export default App;
