import { AlertTriangle, Save, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiJson } from "../../api/client";
import { isSynced, syncLabel } from "../../domain/cards";
import type { CardType, MinedCard } from "../../types";
import { TargetSentence } from "../reader/TargetSentence";

type CardEditModalProps = {
  card: MinedCard;
  onClose: () => void;
  onCardsChanged: () => Promise<void>;
  setError: (message: string) => void;
  onMessage?: (message: string) => void;
  allowDelete?: boolean;
};

type CardEditDraft = {
  type: CardType;
  croatianSentence: string;
  targetText: string;
  targetStart?: number;
  targetEnd?: number;
  englishTranslation: string;
  hint: string;
  note: string;
  generateAudio: boolean;
  createAudioOnlyCard: boolean;
};

type ClozeSelection = {
  start: number;
  end: number;
  text: string;
};

type AudioEditResolution = "regenerate" | "remove";
type AudioWarningMode = "delete" | "regenerate";

function hasValidTargetRange(sentence: string, target: string, targetStart?: number, targetEnd?: number) {
  if (!target || !Number.isInteger(targetStart) || !Number.isInteger(targetEnd)) return false;
  const start = targetStart as number;
  const end = targetEnd as number;
  return start >= 0 && end > start && end <= sentence.length && sentence.slice(start, end) === target;
}

function cardToEditDraft(card: MinedCard): CardEditDraft {
  return {
    type: card.type,
    croatianSentence: card.croatianSentence,
    targetText: card.targetText || "",
    targetStart: card.targetStart,
    targetEnd: card.targetEnd,
    englishTranslation: card.englishTranslation,
    hint: card.hint || "",
    note: card.note || "",
    generateAudio: Boolean(card.audioFile),
    createAudioOnlyCard: Boolean(card.createAudioOnlyCard && card.audioFile)
  };
}

export function CardEditModal({ card, onClose, onCardsChanged, setError, onMessage, allowDelete = true }: CardEditModalProps) {
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editDraft, setEditDraft] = useState<CardEditDraft>(() => cardToEditDraft(card));
  const [pendingEditSelection, setPendingEditSelection] = useState<ClozeSelection | null>(null);
  const [audioWarningMode, setAudioWarningMode] = useState<AudioWarningMode | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [playingId, setPlayingId] = useState("");

  useEffect(() => {
    setEditDraft(cardToEditDraft(card));
    setPendingEditSelection(null);
    setAudioWarningMode(null);
    setSavingEdit(false);
  }, [card]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => editTextareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [card.id]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || savingEdit) return;
      if (audioWarningMode) {
        setAudioWarningMode(null);
        return;
      }
      onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [audioWarningMode, card.id, onClose, savingEdit]);

  function updateEditDraft(next: Partial<CardEditDraft>) {
    setEditDraft((current) => ({ ...current, ...next }));
  }

  function captureEditSelection() {
    const textarea = editTextareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setPendingEditSelection(null);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    if (selected.trim()) {
      setPendingEditSelection({ start, end, text: selected });
    } else {
      setPendingEditSelection(null);
    }
  }

  function hideEditSelection() {
    if (!pendingEditSelection) return;
    updateEditDraft({
      targetText: pendingEditSelection.text,
      targetStart: pendingEditSelection.start,
      targetEnd: pendingEditSelection.end
    });
    setPendingEditSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function clearEditTargetSelection() {
    updateEditDraft({ targetText: "", targetStart: undefined, targetEnd: undefined });
    setPendingEditSelection(null);
  }

  function getAudioWarningMode() {
    if (!card.audioFile) return null;
    if (!editDraft.generateAudio) return "delete";
    if (editDraft.croatianSentence !== card.croatianSentence) return "regenerate";
    return null;
  }

  async function saveEdit(audioResolution?: AudioEditResolution) {
    const nextAudioWarningMode = getAudioWarningMode();
    if (nextAudioWarningMode === "delete" && audioResolution !== "remove") {
      setAudioWarningMode("delete");
      return;
    }

    if (nextAudioWarningMode === "regenerate" && audioResolution !== "regenerate") {
      setAudioWarningMode("regenerate");
      return;
    }

    let closed = false;
    setAudioWarningMode(null);
    setSavingEdit(true);
    setError("");
    onMessage?.("");
    try {
      await apiJson(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...editDraft,
          ...(audioResolution ? { audioResolution } : {}),
          createAudioOnlyCard: editDraft.generateAudio && audioResolution !== "remove" ? editDraft.createAudioOnlyCard : false
        })
      });
      onClose();
      closed = true;
      await onCardsChanged();
      const savedMessage =
        audioResolution === "regenerate"
          ? "Saved with regenerated audio."
          : audioResolution === "remove"
            ? "Saved without audio."
            : !card.audioFile && editDraft.generateAudio
              ? "Saved with generated audio."
              : "Saved.";
      onMessage?.(isSynced(card) ? `${savedMessage} Sync to replace the Anki card.` : savedMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Card update failed.");
    } finally {
      if (!closed) setSavingEdit(false);
    }
  }

  async function deleteCard() {
    const warning = isSynced(card)
      ? "Delete this card? It will be removed from this app now and deleted from your Anki deck the next time you sync."
      : "Delete this pending card?";
    if (!window.confirm(warning)) return;

    let closed = false;
    setSavingEdit(true);
    setError("");
    onMessage?.("");
    try {
      const response = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Delete failed.");
      }
      onClose();
      closed = true;
      await onCardsChanged();
      onMessage?.(isSynced(card) ? "Deleted locally. Sync to delete it from Anki." : "Deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
    } finally {
      if (!closed) setSavingEdit(false);
    }
  }

  async function playAudio() {
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

  const editNeedsHiddenText = editDraft.type === "cloze";
  const showAudioDeleteWarning = audioWarningMode === "delete";
  const showAudioRegenerateWarning = audioWarningMode === "regenerate";
  const editTargetInSentence = hasValidTargetRange(
    editDraft.croatianSentence,
    editDraft.targetText,
    editDraft.targetStart,
    editDraft.targetEnd
  );
  const canSaveEdit = Boolean(
    editDraft.croatianSentence &&
      editDraft.englishTranslation &&
      !savingEdit &&
      (!editNeedsHiddenText || (editDraft.targetText && editTargetInSentence))
  );

  const modal = (
    <div
      className="card-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingEdit && !audioWarningMode) onClose();
      }}
    >
      <section className="card-modal" role="dialog" aria-modal="true" aria-labelledby="card-edit-title">
        <div className="card-modal-head">
          <div>
            <div className="card-modal-kicker">
              <span className="pill">{card.type}</span>
              <span className={`sync-pill ${card.syncStatus}`}>{syncLabel(card)}</span>
              {card.audioFile && (
                <button
                  className="audio-play"
                  type="button"
                  onClick={() => {
                    void playAudio();
                  }}
                  disabled={playingId === card.id}
                >
                  <Volume2 size={13} aria-hidden="true" />
                  {playingId === card.id ? "Playing" : "Audio"}
                </button>
              )}
            </div>
            <h2 id="card-edit-title">Edit card</h2>
            <p>{card.type === "basic" ? "Croatian to English" : card.targetText || "Cloze card"}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={savingEdit}
            title="Close editor"
            aria-label="Close editor"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form
          className="card-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEdit();
          }}
        >
          <label>
            Type
            <select
              value={editDraft.type}
              onChange={(event) => {
                const nextType = event.target.value as CardType;
                updateEditDraft({
                  type: nextType,
                  targetText: nextType === "cloze" ? editDraft.targetText : "",
                  targetStart: nextType === "cloze" ? editDraft.targetStart : undefined,
                  targetEnd: nextType === "cloze" ? editDraft.targetEnd : undefined,
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
                  updateEditDraft({
                    croatianSentence: event.target.value,
                    targetText: "",
                    targetStart: undefined,
                    targetEnd: undefined
                  });
                  setPendingEditSelection(null);
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
                  <div className={`target-summary ${editDraft.targetText ? "selected" : ""}`} aria-live="polite">
                    <div className="target-summary-head">
                      <span>Hidden text</span>
                      {editDraft.targetText && (
                        <button
                          type="button"
                          className="target-clear-button"
                          onClick={clearEditTargetSelection}
                          title="Clear hidden text"
                          aria-label="Clear hidden text"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <strong className={editDraft.targetText ? "" : "empty"}>
                      {editDraft.targetText || "None selected"}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="secondary target-hide-button"
                    disabled={!pendingEditSelection}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={hideEditSelection}
                  >
                    {editDraft.targetText ? "Replace" : "Hide selection"}
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
                    placeholder="e.g. to buy"
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
              <textarea
                value={editDraft.note}
                onChange={(event) => updateEditDraft({ note: event.target.value })}
                rows={2}
              />
            </label>
          </div>

          <label className="checkline setting-check">
            <input
              type="checkbox"
              checked={editDraft.generateAudio}
              onChange={(event) => {
                const checked = event.target.checked;
                updateEditDraft({
                  generateAudio: checked,
                  createAudioOnlyCard: checked ? editDraft.createAudioOnlyCard : false
                });
              }}
            />
            <Volume2 size={16} aria-hidden="true" />
            Generate audio
          </label>
          <label className={`checkline setting-check audio-only-check ${editDraft.generateAudio ? "" : "disabled"}`}>
            <input
              type="checkbox"
              checked={editDraft.generateAudio && editDraft.createAudioOnlyCard}
              disabled={!editDraft.generateAudio}
              onChange={(event) => updateEditDraft({ createAudioOnlyCard: event.target.checked })}
            />
            Create audio-only card as well
          </label>

          <div className="mine-preview">
            <TargetSentence
              sentence={editDraft.croatianSentence}
              target={editNeedsHiddenText ? editDraft.targetText : ""}
              targetStart={editNeedsHiddenText ? editDraft.targetStart : undefined}
              targetEnd={editNeedsHiddenText ? editDraft.targetEnd : undefined}
            />
          </div>

          <div className="button-row card-edit-actions">
            <button type="submit" disabled={!canSaveEdit}>
              <Save size={16} aria-hidden="true" />
              {savingEdit ? "Saving..." : "Save changes"}
            </button>
            <button type="button" className="secondary" onClick={onClose} disabled={savingEdit}>
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
            {allowDelete && (
              <button type="button" className="danger" onClick={() => void deleteCard()} disabled={savingEdit}>
                <Trash2 size={16} aria-hidden="true" />
                Delete
              </button>
            )}
          </div>
        </form>
      </section>

      {audioWarningMode && (
        <div className="confirm-dialog-backdrop" role="presentation">
          <section
            className="confirm-dialog audio-text-warning"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="audio-warning-title"
            aria-describedby="audio-warning-description"
          >
            <div className="confirm-dialog-head">
              <span className="warning-icon" aria-hidden="true">
                <AlertTriangle size={20} />
              </span>
              <div>
                <h3 id="audio-warning-title">
                  {showAudioDeleteWarning ? "Delete saved audio?" : "Regenerate audio?"}
                </h3>
                <p id="audio-warning-description">
                  {showAudioDeleteWarning
                    ? "Saving with Generate audio off will delete this card's saved audio file."
                    : "Audio was generated with the old Croatian text. Regenerate it for the edited sentence before saving."}
                </p>
              </div>
            </div>
            {showAudioRegenerateWarning && (
              <div className="audio-warning-compare" aria-label="Audio text comparison">
                <div>
                  <span>Old text</span>
                  <p>{card.croatianSentence}</p>
                </div>
                <div>
                  <span>New text</span>
                  <p>{editDraft.croatianSentence}</p>
                </div>
              </div>
            )}
            <div className="button-row confirm-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setAudioWarningMode(null)}
                disabled={savingEdit}
              >
                <X size={16} aria-hidden="true" />
                Cancel
              </button>
              {showAudioRegenerateWarning && (
                <button
                  type="button"
                  onClick={() => {
                    void saveEdit("regenerate");
                  }}
                  disabled={savingEdit}
                >
                  <Volume2 size={16} aria-hidden="true" />
                  {savingEdit ? "Saving..." : "Regenerate audio"}
                </button>
              )}
              {showAudioDeleteWarning && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void saveEdit("remove");
                  }}
                  disabled={savingEdit}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Save without audio
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );

  return createPortal(modal, document.body);
}
