import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  FilePlus2,
  Folder,
  Library,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  Volume2,
  X
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "read" | "import" | "cards" | "settings";
type CardType = "basic" | "cloze";
type SyncStatus = "pending" | "synced" | "error";

const READING_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const DEFAULT_SETTINGS: SettingsState = {
  ankiUrl: "http://127.0.0.1:8765",
  deckName: "Croatian::Mined"
};

type Analysis = {
  english: string;
  notes: string[];
};

type Sentence = {
  id: string;
  croatian: string;
  analysis?: Analysis;
  hasCards?: boolean;
  cardCount?: number;
};

type Paragraph = {
  id: string;
  sentences: Sentence[];
};

type Story = {
  id: string;
  title: string;
  level: string;
  paragraphs: Paragraph[];
};

type StorySummary = {
  id: string;
  title: string;
  level: string;
  completed: boolean;
};

type MinedCard = {
  id: string;
  type: CardType;
  storyId: string;
  sentenceId: string;
  croatianSentence: string;
  targetText?: string;
  englishTranslation: string;
  hint?: string;
  note?: string;
  audioFile?: string | null;
  syncStatus: SyncStatus;
  syncError?: string | null;
};

type SettingsState = {
  ankiUrl: string;
  deckName: string;
};

type ImportPreview = {
  paragraphs: string[][];
  sentenceCount: number;
};

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with ${response.status}`);
  }
  return payload as T;
}

function splitPreview(text: string): ImportPreview {
  const sentencePattern = /[^.!?\u2026]+(?:[.!?\u2026]+["'")\]]*)?|[^.!?\u2026]+$/gu;
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => (paragraph.match(sentencePattern)?.map((sentence) => sentence.trim()) || []).filter(Boolean));

  return {
    paragraphs,
    sentenceCount: paragraphs.reduce((total, paragraph) => total + paragraph.length, 0)
  };
}

function sentenceList(story: Story | null): Sentence[] {
  return story?.paragraphs.flatMap((paragraph) => paragraph.sentences) || [];
}

function buildPages(paragraphs: Paragraph[]): Paragraph[][] {
  const pages: Paragraph[][] = [];
  let current: Paragraph[] = [];
  let sentenceCount = 0;
  let characterCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphSentences = paragraph.sentences.length;
    const paragraphCharacters = paragraph.sentences.reduce((total, sentence) => total + sentence.croatian.length, 0);
    const wouldOverflow = current.length > 0 && (sentenceCount + paragraphSentences > 14 || characterCount + paragraphCharacters > 2200);

    if (wouldOverflow) {
      pages.push(current);
      current = [];
      sentenceCount = 0;
      characterCount = 0;
    }

    current.push(paragraph);
    sentenceCount += paragraphSentences;
    characterCount += paragraphCharacters;
  }

  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

function groupStoriesByLevel(stories: StorySummary[]) {
  const grouped = new Map<string, StorySummary[]>();
  for (const story of stories) {
    const level = story.level || "Other";
    grouped.set(level, [...(grouped.get(level) || []), story]);
  }

  return Array.from(grouped.entries()).sort(([a], [b]) => {
    const aIndex = READING_LEVELS.indexOf(a);
    const bIndex = READING_LEVELS.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    }
    return a.localeCompare(b, "hr");
  });
}

function targetParts(sentence: string, target: string) {
  if (!target) return { before: sentence, target: "", after: "" };
  const index = sentence.indexOf(target);
  if (index === -1) return { before: sentence, target: "", after: "" };
  return {
    before: sentence.slice(0, index),
    target,
    after: sentence.slice(index + target.length)
  };
}

function cardTypeLabel(type: CardType) {
  return type === "basic" ? "Basic" : "Cloze";
}

function syncLabel(card: MinedCard) {
  if (card.syncStatus === "synced") return "Synced";
  if (card.syncStatus === "error") return "Needs retry";
  return "Pending";
}

function isSynced(card: MinedCard) {
  return card.syncStatus === "synced";
}

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

type ReaderProps = {
  stories: StorySummary[];
  selectedStoryId: string;
  onSelectStory: (id: string) => void;
  story: Story | null;
  loadingStory: boolean;
  pages: Paragraph[][];
  pageIndex: number;
  setPageIndex: (index: number) => void;
  selectedSentence: Sentence | null;
  selectedSentenceCards: MinedCard[];
  analyzingId: string;
  onChooseSentence: (sentence: Sentence) => void;
  onCloseSentence: () => void;
  onToggleCompleted: (completed: boolean) => Promise<void>;
  completed: boolean;
  refreshStoryAndCards: () => Promise<void>;
  setError: (message: string) => void;
};

function ReaderView({
  stories,
  selectedStoryId,
  onSelectStory,
  story,
  loadingStory,
  pages,
  pageIndex,
  setPageIndex,
  selectedSentence,
  selectedSentenceCards,
  analyzingId,
  onChooseSentence,
  onCloseSentence,
  onToggleCompleted,
  completed,
  refreshStoryAndCards,
  setError
}: ReaderProps) {
  const visibleParagraphs = pages[pageIndex] || [];
  const groupedStories = useMemo(() => groupStoriesByLevel(stories), [stories]);

  return (
    <main className="reader-grid">
      <aside className="story-sidebar" aria-label="Stories">
        <div className="panel-heading">
          <h2>Stories</h2>
          <span>{stories.length}</span>
        </div>
        <div className="story-list">
          {stories.length === 0 && <p className="muted">Import a Croatian text to begin.</p>}
          {groupedStories.map(([level, levelStories]) => (
            <section className="level-folder" key={level}>
              <div className="level-folder-head">
                <Folder size={15} aria-hidden="true" />
                <span>{level}</span>
                <small>{levelStories.length}</small>
              </div>
              {levelStories.map((item) => (
                <button
                  className={`story-row ${item.id === selectedStoryId ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => onSelectStory(item.id)}
                >
                  <span className="story-title">{item.title}</span>
                  <span className="story-meta">
                    <span className={item.completed ? "status done" : "status"}>
                      {item.completed ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                      {item.completed ? "Completed" : "Open"}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>

      <section className="reading-panel" aria-label="Reader">
        {loadingStory && <p className="muted">Loading story...</p>}
        {!loadingStory && story && (
          <>
            <div className="reader-head">
              <div>
                <p className="level-label">{story.level}</p>
                <h1>{story.title}</h1>
              </div>
              <label className="complete-toggle">
                <input type="checkbox" checked={completed} onChange={(event) => void onToggleCompleted(event.target.checked)} />
                Completed
              </label>
            </div>

            <div className="page-controls" aria-label="Page controls">
              <button disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)} title="Previous page">
                <ChevronLeft size={16} aria-hidden="true" />
                Previous
              </button>
              <span>
                Page {pageIndex + 1} of {pages.length}
              </span>
              <button disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex(pageIndex + 1)} title="Next page">
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>

            <article className="story-text">
              {visibleParagraphs.map((paragraph) => (
                <p key={paragraph.id}>
                  {paragraph.sentences.map((sentence) => (
                    <button
                      className={`sentence ${sentence.hasCards ? "has-card" : ""} ${
                        selectedSentence?.id === sentence.id ? "selected" : ""
                      }`}
                      key={sentence.id}
                      onClick={() => onChooseSentence(sentence)}
                      title={sentence.hasCards ? `${sentence.cardCount} saved card(s)` : "Analyze sentence"}
                    >
                      {sentence.croatian}{" "}
                    </button>
                  ))}
                </p>
              ))}
            </article>
          </>
        )}
      </section>

      <AnalysisPanel
        story={story}
        sentence={selectedSentence}
        cards={selectedSentenceCards}
        isAnalyzing={analyzingId === selectedSentence?.id}
        onClose={onCloseSentence}
        refreshStoryAndCards={refreshStoryAndCards}
        setError={setError}
      />
    </main>
  );
}

type AnalysisPanelProps = {
  story: Story | null;
  sentence: Sentence | null;
  cards: MinedCard[];
  isAnalyzing: boolean;
  onClose: () => void;
  refreshStoryAndCards: () => Promise<void>;
  setError: (message: string) => void;
};

function AnalysisPanel({ story, sentence, cards, isAnalyzing, onClose, refreshStoryAndCards, setError }: AnalysisPanelProps) {
  const croatianTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cardType, setCardType] = useState<CardType>("basic");
  const [croatianSentence, setCroatianSentence] = useState("");
  const [targetText, setTargetText] = useState("");
  const [englishTranslation, setEnglishTranslation] = useState("");
  const [hint, setHint] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState("");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sentence) return;
    setCardType("basic");
    setCroatianSentence(sentence.croatian);
    setTargetText("");
    setEnglishTranslation(sentence.analysis?.english || "");
    setHint("");
    setNote("");
    setNoteOpen(false);
    setPendingSelection("");
    setGenerateAudio(false);
  }, [sentence?.id]);

  useEffect(() => {
    if (!sentence?.analysis?.english) return;
    setEnglishTranslation((current) => current || sentence.analysis?.english || "");
  }, [sentence?.analysis?.english]);

  function captureCroatianSelection() {
    const textarea = croatianTextareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setPendingSelection("");
      return;
    }

    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
    if (selected && textarea.value.includes(selected)) {
      setPendingSelection(selected);
    }
  }

  function applyPendingSelection() {
    if (!pendingSelection) return;
    setTargetText(pendingSelection);
    setPendingSelection("");
    window.getSelection()?.removeAllRanges();
  }

  async function saveCard() {
    if (!story || !sentence) return;
    setSaving(true);
    setError("");
    try {
      await apiJson("/api/cards", {
        method: "POST",
        body: JSON.stringify({
          type: cardType,
          storyId: story.id,
          sentenceId: sentence.id,
          croatianSentence,
          targetText,
          englishTranslation,
          hint,
          note,
          generateAudio
        })
      });
      await refreshStoryAndCards();
      setTargetText("");
      setHint("");
      setNote("");
      setNoteOpen(false);
      setPendingSelection("");
      setGenerateAudio(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Card save failed.");
    } finally {
      setSaving(false);
    }
  }

  const needsHiddenText = cardType === "cloze";
  const targetInSentence = targetText ? croatianSentence.includes(targetText) : false;
  const canSave = Boolean(
    sentence && croatianSentence && englishTranslation && !saving && (!needsHiddenText || (targetText && targetInSentence))
  );

  return (
    <aside className={`analysis-panel ${sentence ? "open" : ""}`} aria-label="Selected sentence" aria-hidden={!sentence}>
      {story && sentence && (
        <>
          <div className="analysis-panel-head">
            <div>
              <h2>Mine sentence</h2>
              <span>{story.level}</span>
            </div>
            <button className="icon-button" onClick={onClose} title="Close sentence panel" aria-label="Close sentence panel">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <p className="selected-croatian">
            {sentence.croatian}
          </p>

          <section className="analysis-block">
            {isAnalyzing && <p className="muted">Generating translation...</p>}
            {!isAnalyzing && sentence.analysis && (
              <>
                <h3>English</h3>
                <p>{sentence.analysis.english}</p>
                {sentence.analysis.notes.length > 0 && (
                  <ul className="note-list">
                    {sentence.analysis.notes.map((analysisNote, index) => (
                      <li key={`${analysisNote}-${index}`}>{analysisNote}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {!isAnalyzing && !sentence.analysis && <p className="muted">Translation appears here after analysis.</p>}
          </section>

          <section className="saved-cards">
            <div className="subhead">
              <h3>Saved</h3>
              <span>{cards.length}</span>
            </div>
            {cards.length === 0 && <p className="muted">No cards for this sentence yet.</p>}
            {cards.map((card) => (
              <div className="mini-card" key={card.id}>
                <span className="pill">{card.type}</span>
                <p>
                  <strong>{card.type === "basic" ? card.croatianSentence : card.targetText}</strong>
                  <span>{syncLabel(card)}</span>
                </p>
              </div>
            ))}
          </section>

          <section className="card-controls">
            <h3>Create card</h3>
            <div className="segmented">
              {(["basic", "cloze"] as CardType[]).map((type) => (
                <button className={cardType === type ? "active" : ""} key={type} onClick={() => setCardType(type)}>
                  {cardTypeLabel(type)}
                </button>
              ))}
            </div>

            <div className="card-face-group">
              <h4>Front</h4>
              <label>
                Croatian sentence
                <textarea
                  ref={croatianTextareaRef}
                  value={croatianSentence}
                  onChange={(event) => {
                    setCroatianSentence(event.target.value);
                    setPendingSelection("");
                  }}
                  onKeyUp={captureCroatianSelection}
                  onMouseUp={captureCroatianSelection}
                  onPointerUp={captureCroatianSelection}
                  onSelect={captureCroatianSelection}
                  onTouchEnd={captureCroatianSelection}
                  rows={4}
                />
              </label>

              {needsHiddenText && (
                <>
                  <div className="target-row">
                    <label>
                      Hidden text
                      <input
                        value={targetText}
                        onChange={(event) => {
                          setTargetText(event.target.value);
                          setPendingSelection("");
                        }}
                        placeholder="Highlight text above, then click Hide"
                      />
                    </label>
                    <button type="button" className="secondary" disabled={!pendingSelection} onMouseDown={(event) => event.preventDefault()} onClick={applyPendingSelection}>
                      Hide
                    </button>
                  </div>
                  {targetText && !targetInSentence && <p className="field-error">Hidden text must match the Croatian text exactly.</p>}

                  <label>
                    Hint (optional)
                    <input value={hint} onChange={(event) => setHint(event.target.value)} placeholder="kupiti = to buy (perfective)" />
                  </label>
                </>
              )}
            </div>

            <div className="card-face-group">
              <h4>Back</h4>
              <label>
                English
                <textarea value={englishTranslation} onChange={(event) => setEnglishTranslation(event.target.value)} rows={3} />
              </label>

              <button className="secondary full" type="button" onClick={() => setNoteOpen((current) => !current)}>
                {noteOpen ? "Hide note" : "Add note"}
              </button>
              {noteOpen && (
                <label>
                  Notes
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
                </label>
              )}
            </div>

            <label className="checkline setting-check">
              <input
                type="checkbox"
                checked={generateAudio}
                onChange={(event) => setGenerateAudio(event.target.checked)}
              />
              <Volume2 size={16} aria-hidden="true" />
              Generate audio
            </label>

            <div className="mine-preview">
              <TargetSentence sentence={croatianSentence} target={needsHiddenText ? targetText : ""} />
            </div>

            <button className="full" disabled={!canSave} onClick={() => void saveCard()}>
              <Save size={16} aria-hidden="true" />
              {saving ? "Adding..." : "Add card"}
            </button>
          </section>
        </>
      )}
    </aside>
  );
}

function TargetSentence({ sentence, target }: { sentence: string; target: string }) {
  const parts = targetParts(sentence, target);
  if (!parts.target) return <p>{sentence}</p>;
  return (
    <p>
      {parts.before}
      <span className="target-mark">[...]</span>
      {parts.after}
    </p>
  );
}

type ImportProps = {
  onImported: (storyId: string) => Promise<void>;
  setError: (message: string) => void;
};

function ImportView({ onImported, setError }: ImportProps) {
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState("A2");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const preview = useMemo(() => splitPreview(text), [text]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = await apiJson<{ storyId: string }>("/api/texts/import", {
        method: "POST",
        body: JSON.stringify({ title, level, text })
      });
      setTitle("");
      setText("");
      await onImported(payload.storyId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="import-view">
      <section className="import-form">
        <h1>Import story</h1>
        <form onSubmit={(event) => void submit(event)}>
          <div className="field-grid">
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Priča iz Splita" />
            </label>
            <label>
              Level
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                {READING_LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="file-input">
            <Upload size={16} aria-hidden="true" />
            Upload .txt
            <input type="file" accept=".txt,text/plain" onChange={handleFile} />
          </label>
          <label>
            Croatian text
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={14} />
          </label>
          <button type="submit" disabled={saving}>
            <FilePlus2 size={16} aria-hidden="true" />
            {saving ? "Saving..." : "Save story"}
          </button>
        </form>
      </section>

      <aside className="preview-panel">
        <div className="panel-heading">
          <h2>Preview</h2>
          <span>
            {preview.paragraphs.length} paragraphs / {preview.sentenceCount} sentences
          </span>
        </div>
        {preview.paragraphs.length === 0 && <p className="muted">Paste text to preview paragraph and sentence splitting.</p>}
        {preview.paragraphs.slice(0, 4).map((paragraph, index) => (
          <div className="preview-paragraph" key={index}>
            <span>Paragraph {index + 1}</span>
            {paragraph.map((sentence, sentenceIndex) => (
              <p key={`${sentence}-${sentenceIndex}`}>{sentence}</p>
            ))}
          </div>
        ))}
      </aside>
    </main>
  );
}

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

function CardsView({ cards, reloadCards, setError }: CardsProps) {
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
                        placeholder="kupiti = to buy (perfective)"
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

type SettingsProps = {
  settings: SettingsState;
  reloadSettings: () => Promise<void>;
  setError: (message: string) => void;
};

function SettingsView({ settings, reloadSettings, setError }: SettingsProps) {
  const [draft, setDraft] = useState<SettingsState>(settings);
  const [decks, setDecks] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const deckOptions = useMemo(() => Array.from(new Set([draft.deckName, ...decks].filter(Boolean))), [decks, draft.deckName]);

  useEffect(() => setDraft(settings), [settings]);

  async function testConnection() {
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const payload = await apiJson<{ version: number }>("/api/anki/test", {
        method: "POST",
        body: JSON.stringify({ ankiUrl: draft.ankiUrl })
      });
      setMessage(`Connected to AnkiConnect v${payload.version}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  async function loadDecks() {
    setLoadingDecks(true);
    setMessage("");
    setError("");
    try {
      const payload = await apiJson<{ decks: string[] }>("/api/anki/decks", {
        method: "POST",
        body: JSON.stringify({ ankiUrl: draft.ankiUrl })
      });
      setDecks(payload.decks);
      setMessage(`Found ${payload.decks.length} decks.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load decks.");
    } finally {
      setLoadingDecks(false);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await apiJson("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(draft)
      });
      await reloadSettings();
      setMessage("Settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="settings-view">
      <section className="settings-panel">
        <div className="cards-toolbar">
          <div>
            <h1>Settings</h1>
            <p>Anki sync and card defaults</p>
          </div>
        </div>

        {message && <p className="success-line">{message}</p>}

        <form className="settings-form" onSubmit={(event) => void saveSettings(event)}>
          <label>
            AnkiConnect URL
            <input value={draft.ankiUrl} onChange={(event) => setDraft({ ...draft, ankiUrl: event.target.value })} />
          </label>

          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void testConnection()} disabled={testing}>
              <RefreshCw size={16} aria-hidden="true" />
              {testing ? "Testing..." : "Test connection"}
            </button>
            <button type="button" className="secondary" onClick={() => void loadDecks()} disabled={loadingDecks}>
              <Library size={16} aria-hidden="true" />
              {loadingDecks ? "Loading..." : "Load decks"}
            </button>
          </div>

          <label>
            Deck
            <select
              value={draft.deckName}
              onChange={(event) => event.target.value && setDraft({ ...draft, deckName: event.target.value })}
            >
              {deckOptions.map((deck) => (
                <option key={deck} value={deck}>
                  {deck}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={saving}>
            <Save size={16} aria-hidden="true" />
            {saving ? "Saving..." : "Save settings"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default App;
