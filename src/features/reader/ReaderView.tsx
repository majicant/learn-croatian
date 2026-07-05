import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Folder } from "lucide-react";
import { useMemo } from "react";
import { groupStoriesByLevel } from "../../domain/stories";
import type { MinedCard, Paragraph, Sentence, Story, StorySummary } from "../../types";
import { AnalysisPanel } from "./AnalysisPanel";

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

export function ReaderView({
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
