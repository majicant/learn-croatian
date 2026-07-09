import { RefreshCw, Save, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api/client";
import { cardTypeLabel, syncLabel } from "../../domain/cards";
import type { CardType, MinedCard, Sentence, Story, SuggestedCard } from "../../types";
import { CardEditModal } from "../cards/CardEditModal";
import { TargetSentence } from "./TargetSentence";

type AnalysisPanelProps = {
  story: Story | null;
  sentence: Sentence | null;
  cards: MinedCard[];
  isAnalyzing: boolean;
  onAnalyzeSentence: (sentence: Sentence, force?: boolean) => Promise<void>;
  onClose: () => void;
  refreshStoryAndCards: () => Promise<void>;
  setError: (message: string) => void;
};

type ClozeSelection = {
  start: number;
  end: number;
  text: string;
};

type MinePanelTab = "analysis" | "create" | "saved";

export function AnalysisPanel({
  story,
  sentence,
  cards,
  isAnalyzing,
  onAnalyzeSentence,
  onClose,
  refreshStoryAndCards,
  setError
}: AnalysisPanelProps) {
  const croatianTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousAnalysisEnglishRef = useRef("");
  const [cardType, setCardType] = useState<CardType>("basic");
  const [croatianSentence, setCroatianSentence] = useState("");
  const [targetSelection, setTargetSelection] = useState<ClozeSelection | null>(null);
  const [englishTranslation, setEnglishTranslation] = useState("");
  const [hint, setHint] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<ClozeSelection | null>(null);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [createAudioOnlyCard, setCreateAudioOnlyCard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<MinePanelTab>("analysis");
  const [editingCardId, setEditingCardId] = useState("");
  const [cardEditorMessage, setCardEditorMessage] = useState("");
  const targetText = targetSelection?.text || "";
  const editingCard = cards.find((card) => card.id === editingCardId) || null;
  const suggestedCards = sentence?.analysis?.suggestedCards ?? [];

  useEffect(() => {
    if (!sentence) return;
    const nextEnglish = sentence.analysis?.english || "";
    previousAnalysisEnglishRef.current = nextEnglish;
    setActiveTab("analysis");
    setCardType("basic");
    setCroatianSentence(sentence.croatian);
    setTargetSelection(null);
    setEnglishTranslation(nextEnglish);
    setHint("");
    setNote("");
    setNoteOpen(false);
    setPendingSelection(null);
    setGenerateAudio(false);
    setCreateAudioOnlyCard(false);
    setEditingCardId("");
    setCardEditorMessage("");
  }, [sentence?.id]);

  useEffect(() => {
    if (!sentence?.analysis?.english) return;
    const nextEnglish = sentence.analysis.english;
    setEnglishTranslation((current) => {
      const previousEnglish = previousAnalysisEnglishRef.current;
      previousAnalysisEnglishRef.current = nextEnglish;
      return !current || current === previousEnglish ? nextEnglish : current;
    });
  }, [sentence?.analysis?.english]);

  useEffect(() => {
    if (!editingCardId || editingCard) return;
    setEditingCardId("");
  }, [editingCard, editingCardId]);

  function captureCroatianSelection() {
    const textarea = croatianTextareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setPendingSelection(null);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    if (selected.trim()) {
      setPendingSelection({ start, end, text: selected });
    } else {
      setPendingSelection(null);
    }
  }

  function applyPendingSelection() {
    if (!pendingSelection) return;
    setTargetSelection(pendingSelection);
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function clearTargetSelection() {
    setTargetSelection(null);
    setPendingSelection(null);
  }

  function useSuggestedCard(suggestedCard: SuggestedCard) {
    setCardType("basic");
    setCroatianSentence(suggestedCard.croatian);
    setEnglishTranslation(suggestedCard.english);
    setTargetSelection(null);
    setPendingSelection(null);
    setHint("");
    setNote("");
    setNoteOpen(false);
    setGenerateAudio(false);
    setCreateAudioOnlyCard(false);
    setCardEditorMessage("");
    setActiveTab("create");
  }

  async function rerunAnalysis() {
    if (!sentence || isAnalyzing) return;
    setCardEditorMessage("");
    await onAnalyzeSentence(sentence, true);
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
          targetStart: targetSelection?.start,
          targetEnd: targetSelection?.end,
          englishTranslation,
          hint,
          note,
          generateAudio,
          createAudioOnlyCard: generateAudio && createAudioOnlyCard
        })
      });
      await refreshStoryAndCards();
      setTargetSelection(null);
      setHint("");
      setNote("");
      setNoteOpen(false);
      setPendingSelection(null);
      setGenerateAudio(false);
      setCreateAudioOnlyCard(false);
      setCardEditorMessage("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Card save failed.");
    } finally {
      setSaving(false);
    }
  }

  const needsHiddenText = cardType === "cloze";
  const targetInSentence = targetSelection
    ? croatianSentence.slice(targetSelection.start, targetSelection.end) === targetSelection.text
    : false;
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

          <div className="analysis-tabs" role="tablist" aria-label="Sentence mining sections">
            <button
              className={activeTab === "analysis" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "analysis"}
              aria-controls="mine-tab-analysis"
              id="mine-tab-analysis-button"
              onClick={() => setActiveTab("analysis")}
            >
              Sentence Analysis
            </button>
            <button
              className={activeTab === "create" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "create"}
              aria-controls="mine-tab-create"
              id="mine-tab-create-button"
              onClick={() => setActiveTab("create")}
            >
              Create Card
            </button>
            <button
              className={activeTab === "saved" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "saved"}
              aria-controls="mine-tab-saved"
              id="mine-tab-saved-button"
              onClick={() => setActiveTab("saved")}
            >
              Saved Cards
            </button>
          </div>

          {activeTab === "analysis" && (
            <div
              id="mine-tab-analysis"
              role="tabpanel"
              aria-labelledby="mine-tab-analysis-button"
            >
              <p className="selected-croatian">
                {sentence.croatian}
              </p>

              <section className="analysis-block">
                <div className="analysis-block-head">
                  <h3>Analysis</h3>
                  <button
                    className="secondary analysis-rerun-button"
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => void rerunAnalysis()}
                    title="Re-run analysis"
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    {isAnalyzing ? "Running..." : "Re-run"}
                  </button>
                </div>
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

              {!isAnalyzing && sentence.analysis && (
                <section className="suggested-cards">
                  <div className="subhead">
                    <h3>Sentence chunks</h3>
                    <span>{suggestedCards.length}</span>
                  </div>
                  {suggestedCards.length === 0 && <p className="muted">No sentence chunks available.</p>}
                  {suggestedCards.map((suggestedCard) => (
                    <button
                      className="suggested-card"
                      key={`${suggestedCard.croatian}-${suggestedCard.english}`}
                      type="button"
                      onClick={() => useSuggestedCard(suggestedCard)}
                    >
                      <span className="suggested-card-text">
                        <strong>{suggestedCard.croatian}</strong>
                        <span>{suggestedCard.english}</span>
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}

          {activeTab === "create" && (
            <section
              className="card-controls"
              id="mine-tab-create"
              role="tabpanel"
              aria-labelledby="mine-tab-create-button"
            >
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
                      setTargetSelection(null);
                      setPendingSelection(null);
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
                      <div className={`target-summary ${targetText ? "selected" : ""}`} aria-live="polite">
                        <div className="target-summary-head">
                          <span>Hidden text</span>
                          {targetText && (
                            <button
                              type="button"
                              className="target-clear-button"
                              onClick={clearTargetSelection}
                              title="Clear hidden text"
                              aria-label="Clear hidden text"
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        <strong className={targetText ? "" : "empty"}>{targetText || "None selected"}</strong>
                      </div>
                      <button type="button" className="secondary target-hide-button" disabled={!pendingSelection} onMouseDown={(event) => event.preventDefault()} onClick={applyPendingSelection}>
                        {targetText ? "Replace" : "Hide selection"}
                      </button>
                    </div>
                    {targetText && !targetInSentence && <p className="field-error">Hidden text must match the Croatian text exactly.</p>}

                    <label>
                      Hint (optional)
                      <input value={hint} onChange={(event) => setHint(event.target.value)} placeholder="e.g. to buy" />
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
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setGenerateAudio(checked);
                    if (!checked) setCreateAudioOnlyCard(false);
                  }}
                />
                <Volume2 size={16} aria-hidden="true" />
                Generate audio
              </label>
              <label className={`checkline setting-check audio-only-check ${generateAudio ? "" : "disabled"}`}>
                <input
                  type="checkbox"
                  checked={generateAudio && createAudioOnlyCard}
                  disabled={!generateAudio}
                  onChange={(event) => setCreateAudioOnlyCard(event.target.checked)}
                />
                Create audio-only card as well
              </label>

              <div className="mine-preview">
                <TargetSentence
                  sentence={croatianSentence}
                  target={needsHiddenText ? targetText : ""}
                  targetStart={needsHiddenText ? targetSelection?.start : undefined}
                  targetEnd={needsHiddenText ? targetSelection?.end : undefined}
                />
              </div>

              <button className="full" disabled={!canSave} onClick={() => void saveCard()}>
                <Save size={16} aria-hidden="true" />
                {saving ? "Adding..." : "Add card"}
              </button>
            </section>
          )}

          {activeTab === "saved" && (
            <section
              className="saved-cards"
              id="mine-tab-saved"
              role="tabpanel"
              aria-labelledby="mine-tab-saved-button"
            >
              <div className="subhead">
                <h3>Saved</h3>
                <span>{cards.length}</span>
              </div>
              {cards.length === 0 && <p className="muted">No cards for this sentence yet.</p>}
              {cardEditorMessage && <p className="success-line">{cardEditorMessage}</p>}
              {cards.map((card) => (
                <button
                  className="mini-card"
                  key={card.id}
                  type="button"
                  onClick={() => {
                    setError("");
                    setCardEditorMessage("");
                    setEditingCardId(card.id);
                  }}
                  aria-label={`Edit card: ${card.croatianSentence}`}
                >
                  <span className="pill">{card.type}</span>
                  <span className="mini-card-body">
                    <strong>{card.type === "basic" ? card.croatianSentence : card.targetText}</strong>
                    <span className="mini-card-status">{syncLabel(card)}</span>
                  </span>
                </button>
              ))}
            </section>
          )}

          {editingCard && (
            <CardEditModal
              card={editingCard}
              onClose={() => setEditingCardId("")}
              onCardsChanged={refreshStoryAndCards}
              setError={setError}
              onMessage={setCardEditorMessage}
              allowDelete={false}
            />
          )}
        </>
      )}
    </aside>
  );
}
