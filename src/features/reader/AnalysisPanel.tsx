import { RefreshCw, Save, Volume2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { apiJson } from "../../api/client";
import { cardTypeLabel, syncLabel } from "../../domain/cards";
import {
  buildWordCoverageIndex,
  lookupWordCoverage,
  tokenizeWords,
  type WordToken
} from "../../domain/wordCoverage";
import type { CardLoadState, CardType, MinedCard, Sentence, Story, SuggestedCard } from "../../types";
import { CardEditModal } from "../cards/CardEditModal";
import { StoryAudioClipEditor, validateStoryAudioClip, type StoryAudioClip } from "./StoryAudioClipEditor";
import { TargetSentence } from "./TargetSentence";

type AnalysisPanelProps = {
  story: Story | null;
  sentence: Sentence | null;
  cards: MinedCard[];
  allCards: MinedCard[];
  cardLoadState: CardLoadState;
  isAnalyzing: boolean;
  onAnalyzeSentence: (sentence: Sentence, force?: boolean) => Promise<void>;
  onClose: () => void;
  refreshStoryAndCards: () => Promise<void>;
  storyAudioCurrentTime: number;
  storyAudioDuration: number;
  storyAudioPlayRequest: number;
  onStartStoryAudioClipPreview: () => void;
  setError: (message: string) => void;
};

type ClozeSelection = {
  start: number;
  end: number;
  text: string;
};

type MinePanelTab = "analysis" | "create" | "saved";

const MATCH_PREVIEW_LIMIT = 6;

function coverageMessage(matchCount: number, loadState: CardLoadState) {
  if (loadState === "loading") return "Checking saved cards…";
  if (loadState === "error") return "Saved-card coverage is unavailable.";
  if (matchCount === 0) return "This exact form is not in any saved cards.";
  if (matchCount === 1) return "This exact form appears in 1 saved card.";
  return `This exact form appears in ${matchCount} saved cards.`;
}

function clozeMatchMessage(matchCount: number) {
  if (matchCount === 0) return "";
  if (matchCount === 1) return " It is hidden in 1 cloze card.";
  return ` It is hidden in ${matchCount} cloze cards.`;
}

function MatchedCroatianText({ text, normalizedWord }: { text: string; normalizedWord: string }) {
  const tokens = tokenizeWords(text);
  let cursor = 0;

  return (
    <>
      {tokens.map((token) => {
        const before = text.slice(cursor, token.start);
        cursor = token.end;
        return (
          <Fragment key={`${token.start}-${token.end}`}>
            {before}
            {token.normalized === normalizedWord ? <mark>{token.text}</mark> : token.text}
          </Fragment>
        );
      })}
      {text.slice(cursor)}
    </>
  );
}

export function AnalysisPanel({
  story,
  sentence,
  cards,
  allCards,
  cardLoadState,
  isAnalyzing,
  onAnalyzeSentence,
  onClose,
  refreshStoryAndCards,
  storyAudioCurrentTime,
  storyAudioDuration,
  storyAudioPlayRequest,
  onStartStoryAudioClipPreview,
  setError
}: AnalysisPanelProps) {
  const croatianTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wordButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
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
  const [storyAudioClip, setStoryAudioClip] = useState<StoryAudioClip | null>(null);
  const [createAudioOnlyCard, setCreateAudioOnlyCard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<MinePanelTab>("analysis");
  const [editingCardId, setEditingCardId] = useState("");
  const [cardEditorMessage, setCardEditorMessage] = useState("");
  const [selectedWord, setSelectedWord] = useState<WordToken | null>(null);
  const [activeWordStart, setActiveWordStart] = useState<number | null>(null);
  const targetText = targetSelection?.text || "";
  const editingCard = cards.find((card) => card.id === editingCardId) || null;
  const suggestedCards = sentence?.analysis?.suggestedCards ?? [];
  const hasStoryAudio = Boolean(story?.audioFile);
  const storyClipValidation = validateStoryAudioClip(storyAudioClip, storyAudioDuration);
  const validStoryClip = Boolean(hasStoryAudio && storyClipValidation.state === "valid");
  const invalidStoryClip = Boolean(
    hasStoryAudio && storyAudioClip && storyClipValidation.state !== "valid"
  );
  const wordCoverageIndex = useMemo(() => buildWordCoverageIndex(allCards), [allCards]);
  const sentenceWords = useMemo(() => tokenizeWords(sentence?.croatian || ""), [sentence?.croatian]);
  const selectedWordMatches = selectedWord
    ? lookupWordCoverage(wordCoverageIndex, selectedWord.normalized)
    : [];
  const selectedWordClozeMatches = selectedWordMatches.filter((match) => match.isClozeTarget).length;
  const targetWords = useMemo(() => tokenizeWords(targetText), [targetText]);
  const targetWord = targetWords.length === 1 ? targetWords[0] : null;
  const targetWordMatches = targetWord ? lookupWordCoverage(wordCoverageIndex, targetWord.normalized) : [];
  const targetWordClozeMatches = targetWordMatches.filter((match) => match.isClozeTarget).length;

  useEffect(() => {
    setSelectedWord(null);
    setActiveWordStart(null);
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
    setStoryAudioClip(null);
    setCreateAudioOnlyCard(false);
    setEditingCardId("");
    setCardEditorMessage("");
  }, [sentence?.croatian, sentence?.id]);

  useEffect(() => {
    setStoryAudioClip(null);
    setCreateAudioOnlyCard(false);
  }, [story?.audioFile]);

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
    setStoryAudioClip(null);
    setCreateAudioOnlyCard(false);
    setCardEditorMessage("");
    setActiveTab("create");
  }

  function chooseWord(word: WordToken) {
    setActiveWordStart(word.start);
    setSelectedWord((current) => (current?.start === word.start ? null : word));
  }

  function moveWordFocus(event: KeyboardEvent<HTMLButtonElement>, wordIndex: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const focusedWord = sentenceWords[wordIndex];
      if (focusedWord) chooseWord(focusedWord);
      return;
    }

    let nextIndex = wordIndex;
    if (event.key === "ArrowLeft") nextIndex = Math.max(0, wordIndex - 1);
    else if (event.key === "ArrowRight") nextIndex = Math.min(sentenceWords.length - 1, wordIndex + 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sentenceWords.length - 1;
    else return;

    event.preventDefault();
    const nextWord = sentenceWords[nextIndex];
    if (!nextWord) return;
    setActiveWordStart(nextWord.start);
    wordButtonRefs.current.get(nextWord.start)?.focus();
  }

  function useWordAsCloze(word: WordToken) {
    if (!sentence) return;
    const sourceWord = sentence.croatian.slice(word.start, word.end);
    if (sourceWord !== word.text) return;

    let nextTarget = word;
    let resetDraft = false;
    if (croatianSentence !== sentence.croatian) {
      const draftMatches = tokenizeWords(croatianSentence).filter(
        (draftWord) => draftWord.normalized === word.normalized
      );
      if (draftMatches.length === 1) {
        nextTarget = draftMatches[0];
      } else {
        const replaceDraft = window.confirm(
          `Use “${word.text}” as a cloze target?\n\nThis exact word is missing or repeated in your current Croatian draft. Continuing will replace the draft with the full selected sentence and clear its other fields.`
        );
        if (!replaceDraft) return;
        resetDraft = true;
      }
    }

    const nextCroatianSentence = resetDraft ? sentence.croatian : croatianSentence;
    const nextTargetText = nextCroatianSentence.slice(nextTarget.start, nextTarget.end);
    if (!nextTargetText) return;
    const targetChanged =
      !targetSelection ||
      targetSelection.start !== nextTarget.start ||
      targetSelection.end !== nextTarget.end ||
      targetSelection.text !== nextTargetText;

    if (resetDraft) {
      const nextEnglish = sentence.analysis?.english || "";
      previousAnalysisEnglishRef.current = nextEnglish;
      setCroatianSentence(sentence.croatian);
      setEnglishTranslation(nextEnglish);
      setHint("");
      setNote("");
      setNoteOpen(false);
      setGenerateAudio(false);
      setStoryAudioClip(null);
      setCreateAudioOnlyCard(false);
    }

    setCardType("cloze");
    setTargetSelection({ start: nextTarget.start, end: nextTarget.end, text: nextTargetText });
    if (targetChanged) setHint("");
    setPendingSelection(null);
    setCardEditorMessage("");
    setActiveTab("create");
    window.requestAnimationFrame(() => croatianTextareaRef.current?.focus());
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
    const audioMode = hasStoryAudio ? (validStoryClip ? "story-crop" : "none") : generateAudio ? "generate" : "none";
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
          audioMode,
          storyAudioStart: validStoryClip ? storyAudioClip?.start : undefined,
          storyAudioEnd: validStoryClip ? storyAudioClip?.end : undefined,
          createAudioOnlyCard: audioMode !== "none" && createAudioOnlyCard
        })
      });
      await refreshStoryAndCards();
      setTargetSelection(null);
      setHint("");
      setNote("");
      setNoteOpen(false);
      setPendingSelection(null);
      setGenerateAudio(false);
      setStoryAudioClip(null);
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
    sentence &&
      croatianSentence &&
      englishTranslation &&
      !saving &&
      !invalidStoryClip &&
      (!needsHiddenText || (targetText && targetInSentence))
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
              <section className="word-inspector" aria-label="Word inspector">
                <p className="word-inspector-help" id="word-inspector-help">
                  Choose a word to check saved cards.
                </p>
                <p
                  className="selected-croatian inspectable-sentence"
                  role="toolbar"
                  aria-label="Words in the selected Croatian sentence"
                  aria-describedby="word-inspector-help"
                  aria-orientation="horizontal"
                >
                  {sentenceWords.map((word, wordIndex) => {
                    const previousEnd = wordIndex === 0 ? 0 : sentenceWords[wordIndex - 1].end;
                    const isSelected = selectedWord?.start === word.start;
                    return (
                      <Fragment key={`${word.start}-${word.end}`}>
                        {sentence.croatian.slice(previousEnd, word.start)}
                        <button
                          ref={(element) => {
                            if (element) wordButtonRefs.current.set(word.start, element);
                            else wordButtonRefs.current.delete(word.start);
                          }}
                          className={`inspectable-word ${isSelected ? "selected" : ""}`}
                          type="button"
                          lang="hr"
                          aria-pressed={isSelected}
                          tabIndex={(activeWordStart ?? sentenceWords[0]?.start) === word.start ? 0 : -1}
                          onClick={() => chooseWord(word)}
                          onKeyDown={(event) => moveWordFocus(event, wordIndex)}
                        >
                          {word.text}
                        </button>
                      </Fragment>
                    );
                  })}
                  {sentence.croatian.slice(sentenceWords[sentenceWords.length - 1]?.end || 0)}
                </p>
                <div className="word-inspector-announcement" role="status" aria-live="polite" aria-atomic="true">
                  {selectedWord
                    ? `${selectedWord.text}. ${coverageMessage(selectedWordMatches.length, cardLoadState)}${
                        cardLoadState === "ready" ? clozeMatchMessage(selectedWordClozeMatches) : ""
                      }`
                    : ""}
                </div>

                {selectedWord && (
                  <div
                    className={`word-inspector-result ${
                      cardLoadState === "ready" && selectedWordMatches.length ? "covered" : "not-covered"
                    }`}
                  >
                    <div className="word-inspector-status" id="word-inspector-status">
                      <strong lang="hr">{selectedWord.text}</strong>
                      <span>
                        {coverageMessage(selectedWordMatches.length, cardLoadState)}
                        {cardLoadState === "ready" && clozeMatchMessage(selectedWordClozeMatches)}
                      </span>
                    </div>
                    <button
                      className="secondary word-inspector-cloze"
                      type="button"
                      aria-describedby="word-inspector-status"
                      onClick={() => useWordAsCloze(selectedWord)}
                    >
                      Use as cloze
                    </button>

                    {cardLoadState === "ready" && selectedWordMatches.length > 0 && (
                      <details
                        className="word-match-disclosure"
                        key={`${sentence.id}-${selectedWord.start}-${selectedWord.normalized}`}
                      >
                        <summary>
                          View {selectedWordMatches.length} matching {selectedWordMatches.length === 1 ? "card" : "cards"}
                        </summary>
                        <ul className="word-match-list" role="list">
                          {selectedWordMatches.slice(0, MATCH_PREVIEW_LIMIT).map((match) => (
                            <li className="word-match-card" key={match.card.id}>
                              <div className="word-match-meta">
                                <span>
                                  {match.isClozeTarget
                                    ? "Cloze target"
                                    : match.card.type === "cloze"
                                      ? "Cloze card"
                                      : "Basic card"}
                                </span>
                                <span>{syncLabel(match.card)}</span>
                              </div>
                              <p lang="hr">
                                <MatchedCroatianText
                                  text={match.card.croatianSentence}
                                  normalizedWord={selectedWord.normalized}
                                />
                              </p>
                              <p>{match.card.englishTranslation}</p>
                            </li>
                          ))}
                        </ul>
                        {selectedWordMatches.length > MATCH_PREVIEW_LIMIT && (
                          <p className="word-match-limit">
                            Showing the first {MATCH_PREVIEW_LIMIT} of {selectedWordMatches.length} matching cards.
                          </p>
                        )}
                      </details>
                    )}
                  </div>
                )}
              </section>

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
                    {targetWord && (
                      <p className="target-coverage-note">
                        {coverageMessage(targetWordMatches.length, cardLoadState)}
                        {cardLoadState === "ready" && clozeMatchMessage(targetWordClozeMatches)}
                      </p>
                    )}
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

              {hasStoryAudio ? (
                <>
                  <StoryAudioClipEditor
                    storyId={story?.id as string}
                    audioFile={story?.audioFile as string}
                    value={storyAudioClip}
                    onChange={(nextClip) => {
                      setStoryAudioClip(nextClip);
                      if (!nextClip) setCreateAudioOnlyCard(false);
                    }}
                    duration={storyAudioDuration}
                    playhead={storyAudioCurrentTime}
                    onPreviewStart={onStartStoryAudioClipPreview}
                    previewStopRequest={storyAudioPlayRequest}
                    setError={setError}
                  />
                  <label className={`checkline setting-check audio-only-check ${validStoryClip ? "" : "disabled"}`}>
                    <input
                      type="checkbox"
                      checked={validStoryClip && createAudioOnlyCard}
                      disabled={!validStoryClip}
                      onChange={(event) => setCreateAudioOnlyCard(event.target.checked)}
                    />
                    Create audio-only card as well
                  </label>
                </>
              ) : (
                <>
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
                </>
              )}

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
              key={editingCard.id}
              card={editingCard}
              onClose={() => setEditingCardId("")}
              onCardsChanged={refreshStoryAndCards}
              setError={setError}
              onMessage={setCardEditorMessage}
              allowDelete={false}
              storyAudioFile={story?.audioFile}
              onStartStoryAudioPlayback={onStartStoryAudioClipPreview}
            />
          )}
        </>
      )}
    </aside>
  );
}
