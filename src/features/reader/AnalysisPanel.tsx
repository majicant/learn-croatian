import { Save, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api/client";
import { cardTypeLabel, syncLabel } from "../../domain/cards";
import type { CardType, MinedCard, Sentence, Story } from "../../types";
import { TargetSentence } from "./TargetSentence";

type AnalysisPanelProps = {
  story: Story | null;
  sentence: Sentence | null;
  cards: MinedCard[];
  isAnalyzing: boolean;
  onClose: () => void;
  refreshStoryAndCards: () => Promise<void>;
  setError: (message: string) => void;
};

export function AnalysisPanel({
  story,
  sentence,
  cards,
  isAnalyzing,
  onClose,
  refreshStoryAndCards,
  setError
}: AnalysisPanelProps) {
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
