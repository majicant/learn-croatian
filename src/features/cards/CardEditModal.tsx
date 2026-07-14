import { AlertTriangle, Save, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiJson } from "../../api/client";
import { isSynced, syncLabel } from "../../domain/cards";
import type { AudioMode, CardType, MinedCard } from "../../types";
import {
  StoryAudioClipEditor,
  validateStoryAudioClip,
  type StoryAudioClip
} from "../reader/StoryAudioClipEditor";
import { StoryAudioPlayer, type StoryAudioStatus } from "../reader/StoryAudioPlayer";
import { TargetSentence } from "../reader/TargetSentence";

type CardEditModalProps = {
  card: MinedCard;
  onClose: () => void;
  onCardsChanged: () => Promise<void>;
  setError: (message: string) => void;
  onMessage?: (message: string) => void;
  allowDelete?: boolean;
  storyAudioFile?: string | null;
  onStartStoryAudioPlayback?: () => void;
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
  createAudioOnlyCard: boolean;
};

type ClozeSelection = {
  start: number;
  end: number;
  text: string;
};

type AudioWarningMode = "delete" | "regenerate";
type ConfirmedAudioMode = Extract<AudioMode, "generate" | "none">;

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
    createAudioOnlyCard: Boolean(card.createAudioOnlyCard && card.audioFile)
  };
}

function storyClipFromCard(card: MinedCard): StoryAudioClip | null {
  if (
    card.audioSource !== "story-crop" ||
    !Number.isFinite(card.storyAudioStart) ||
    !Number.isFinite(card.storyAudioEnd)
  ) {
    return null;
  }

  return {
    start: card.storyAudioStart as number,
    end: card.storyAudioEnd as number
  };
}

function sameStoryClip(left: StoryAudioClip | null, right: StoryAudioClip | null) {
  return left?.start === right?.start && left?.end === right?.end;
}

export function CardEditModal({
  card,
  onClose,
  onCardsChanged,
  setError,
  onMessage,
  allowDelete = true,
  storyAudioFile = null,
  onStartStoryAudioPlayback
}: CardEditModalProps) {
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const savedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [editDraft, setEditDraft] = useState<CardEditDraft>(() => cardToEditDraft(card));
  const [pendingEditSelection, setPendingEditSelection] = useState<ClozeSelection | null>(null);
  const [storyAudioClip, setStoryAudioClip] = useState<StoryAudioClip | null>(() => storyClipFromCard(card));
  const [generatedAudioEnabled, setGeneratedAudioEnabled] = useState(Boolean(card.audioFile));
  const [storyAudioStatus, setStoryAudioStatus] = useState<StoryAudioStatus>(() => ({
    currentTime: card.storyAudioStart ?? 0,
    duration: 0
  }));
  const [storyAudioPauseRequest, setStoryAudioPauseRequest] = useState(0);
  const [clipPreviewStopRequest, setClipPreviewStopRequest] = useState(0);
  const [audioWarningMode, setAudioWarningMode] = useState<AudioWarningMode | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [playingSavedAudio, setPlayingSavedAudio] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => editTextareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
  }, [audioWarningMode, onClose, savingEdit]);

  useEffect(() => {
    return () => {
      savedAudioRef.current?.pause();
      savedAudioRef.current = null;
    };
  }, []);

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

  function getAudioMode(confirmedMode?: ConfirmedAudioMode): AudioMode {
    if (confirmedMode) return confirmedMode;
    if (hasStoryAudio) {
      if (storyClipChanged) return storyClipValidation.state === "valid" ? "story-crop" : "none";
      return card.audioFile ? "keep" : "none";
    }
    if (!generatedAudioEnabled) return "none";
    return card.audioFile ? "keep" : "generate";
  }

  function getAudioWarningMode() {
    if (!card.audioFile) return null;
    const audioMode = getAudioMode();
    if (audioMode === "none") return "delete";
    if (
      audioMode === "keep" &&
      card.audioSource === "generated" &&
      editDraft.croatianSentence !== card.croatianSentence
    ) {
      return hasStoryAudio ? "delete" : "regenerate";
    }
    return null;
  }

  async function saveEdit(confirmedAudioMode?: ConfirmedAudioMode) {
    const nextAudioWarningMode = getAudioWarningMode();
    if (nextAudioWarningMode === "delete" && !confirmedAudioMode) {
      setAudioWarningMode("delete");
      return;
    }

    if (nextAudioWarningMode === "regenerate" && !confirmedAudioMode) {
      setAudioWarningMode("regenerate");
      return;
    }

    let closed = false;
    setAudioWarningMode(null);
    setSavingEdit(true);
    setError("");
    onMessage?.("");
    try {
      const audioMode = getAudioMode(confirmedAudioMode);
      const willHaveAudio = audioMode !== "none";
      await apiJson(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...editDraft,
          audioMode,
          ...(audioMode === "story-crop" && storyAudioClip
            ? { storyAudioStart: storyAudioClip.start, storyAudioEnd: storyAudioClip.end }
            : {}),
          createAudioOnlyCard: willHaveAudio ? editDraft.createAudioOnlyCard : false
        })
      });
      onClose();
      closed = true;
      await onCardsChanged();
      let savedMessage = "Saved.";
      if (audioMode === "story-crop") {
        savedMessage = card.audioFile ? "Saved with updated story audio clip." : "Saved with story audio clip.";
      } else if (audioMode === "none" && card.audioFile) {
        savedMessage = "Saved without audio.";
      } else if (audioMode === "generate") {
        savedMessage = card.audioFile ? "Saved with regenerated audio." : "Saved with generated audio.";
      }
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

  function stopSavedAudio() {
    savedAudioRef.current?.pause();
    savedAudioRef.current = null;
    setPlayingSavedAudio(false);
  }

  function handleStorySourcePlaybackStart() {
    stopSavedAudio();
    setClipPreviewStopRequest((current) => current + 1);
    onStartStoryAudioPlayback?.();
  }

  function handleClipPreviewStart() {
    stopSavedAudio();
    setStoryAudioPauseRequest((current) => current + 1);
    onStartStoryAudioPlayback?.();
  }

  async function playAudio() {
    if (!card.audioFile) return;
    stopSavedAudio();
    setStoryAudioPauseRequest((current) => current + 1);
    setClipPreviewStopRequest((current) => current + 1);
    onStartStoryAudioPlayback?.();
    setPlayingSavedAudio(true);
    setError("");
    const audio = new Audio(`/media/${encodeURIComponent(card.audioFile)}`);
    savedAudioRef.current = audio;

    function stopThisAudio() {
      if (savedAudioRef.current !== audio) return;
      savedAudioRef.current = null;
      setPlayingSavedAudio(false);
    }

    try {
      audio.addEventListener("ended", stopThisAudio);
      audio.addEventListener("error", () => {
        const isCurrentAudio = savedAudioRef.current === audio;
        stopThisAudio();
        if (isCurrentAudio) setError("Could not play this card's audio file.");
      });
      await audio.play();
    } catch {
      const isCurrentAudio = savedAudioRef.current === audio;
      stopThisAudio();
      if (isCurrentAudio) setError("Could not play this card's audio file.");
    }
  }

  const editNeedsHiddenText = editDraft.type === "cloze";
  const hasStoryAudio = Boolean(storyAudioFile);
  const showAudioDeleteWarning = audioWarningMode === "delete";
  const showAudioRegenerateWarning = audioWarningMode === "regenerate";
  const storyClipValidation = validateStoryAudioClip(storyAudioClip, storyAudioStatus.duration);
  const storyClipChanged = !sameStoryClip(storyAudioClip, storyClipFromCard(card));
  const invalidEditedStoryClip = Boolean(
    hasStoryAudio &&
      storyClipChanged &&
      storyAudioClip &&
      storyClipValidation.state !== "valid"
  );
  const hasEffectiveStoryAudio = Boolean(
    hasStoryAudio &&
      (storyClipChanged ? storyClipValidation.state === "valid" : card.audioFile)
  );
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
      !invalidEditedStoryClip &&
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
                  disabled={playingSavedAudio}
                >
                  <Volume2 size={13} aria-hidden="true" />
                  {playingSavedAudio ? "Playing" : hasStoryAudio ? "Saved audio" : "Audio"}
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

          {hasStoryAudio ? (
            <div className="card-edit-story-audio">
              <StoryAudioPlayer
                audioFile={storyAudioFile as string}
                title="Story source"
                initialTime={card.storyAudioStart ?? 0}
                onPlaybackStart={handleStorySourcePlaybackStart}
                onStatusChange={setStoryAudioStatus}
                pauseRequest={storyAudioPauseRequest}
                setError={setError}
              />
              <StoryAudioClipEditor
                storyId={card.storyId}
                audioFile={storyAudioFile as string}
                value={storyAudioClip}
                onChange={(nextClip) => {
                  setStoryAudioClip(nextClip);
                  if (!nextClip) updateEditDraft({ createAudioOnlyCard: false });
                }}
                duration={storyAudioStatus.duration}
                playhead={storyAudioStatus.currentTime}
                onPreviewStart={handleClipPreviewStart}
                previewStopRequest={clipPreviewStopRequest}
                setError={setError}
              />
              {card.audioFile && !storyAudioClip && !storyClipChanged && (
                <p className="card-edit-audio-note">
                  The current saved audio will stay unless you choose a story clip.
                </p>
              )}
              <label className={`checkline setting-check audio-only-check ${hasEffectiveStoryAudio ? "" : "disabled"}`}>
                <input
                  type="checkbox"
                  checked={hasEffectiveStoryAudio && editDraft.createAudioOnlyCard}
                  disabled={!hasEffectiveStoryAudio}
                  onChange={(event) => updateEditDraft({ createAudioOnlyCard: event.target.checked })}
                />
                Create audio-only card as well
              </label>
            </div>
          ) : (
            <>
              <label className="checkline setting-check">
                <input
                  type="checkbox"
                  checked={generatedAudioEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setGeneratedAudioEnabled(checked);
                    if (!checked) updateEditDraft({ createAudioOnlyCard: false });
                  }}
                />
                <Volume2 size={16} aria-hidden="true" />
                Generate audio
              </label>
              <label className={`checkline setting-check audio-only-check ${generatedAudioEnabled ? "" : "disabled"}`}>
                <input
                  type="checkbox"
                  checked={generatedAudioEnabled && editDraft.createAudioOnlyCard}
                  disabled={!generatedAudioEnabled}
                  onChange={(event) => updateEditDraft({ createAudioOnlyCard: event.target.checked })}
                />
                Create audio-only card as well
              </label>
            </>
          )}

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
                  {showAudioDeleteWarning ? "Remove saved audio?" : "Regenerate audio?"}
                </h3>
                <p id="audio-warning-description">
                  {showAudioDeleteWarning
                    ? hasStoryAudio
                      ? "Saving will remove this card's saved audio. Choose a story clip to replace it, or continue without audio."
                      : "Saving with Generate audio off will delete this card's saved audio file."
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
                    void saveEdit("generate");
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
                    void saveEdit("none");
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
