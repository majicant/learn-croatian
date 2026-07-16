import {
  AudioLines,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileAudio,
  Folder,
  FolderPlus,
  List,
  ListFilter,
  MoreHorizontal,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ChangeEvent, DragEvent, KeyboardEvent, MouseEvent } from "react";
import {
  buildFolderTree,
  buildPages,
  groupStoriesByLevel,
  isSameOrDescendantFolder,
  sentenceList
} from "../../domain/stories";
import type { FolderTreeNode } from "../../domain/stories";
import type { CardLoadState, MinedCard, Paragraph, Sentence, Story, StoryFolder, StorySummary } from "../../types";
import { AnalysisPanel } from "./AnalysisPanel";
import { SentenceEditModal } from "./SentenceEditModal";
import { StoryAudioPlayer, type StoryAudioStatus } from "./StoryAudioPlayer";

export type StorySidebarMode = "level" | "folder";
type StoryStatusFilter = "all" | "open" | "completed";

function cleanSentenceText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

const STORY_DRAG_TYPE = "application/x-learn-croatian-story";
const FOLDER_DRAG_TYPE = "application/x-learn-croatian-folder";
const STORY_STATUS_FILTER_MENU_ID = "story-status-filter";
const STORY_STATUS_FILTERS: Array<{ value: StoryStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "completed", label: "Completed" }
];

type ReaderProps = {
  stories: StorySummary[];
  storyFolders: StoryFolder[];
  sidebarMode: StorySidebarMode;
  onSidebarModeChange: (mode: StorySidebarMode) => void;
  selectedStoryId: string;
  onSelectStory: (id: string) => void;
  onCreateFolder: (parentId?: string) => Promise<StoryFolder>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onRenameStory: (storyId: string, title: string) => Promise<void>;
  onChangeStoryLevel: (storyId: string, level: string) => Promise<void>;
  onUpdateSentence: (storyId: string, sentenceId: string, croatian: string) => Promise<void>;
  onDeleteSentence: (storyId: string, sentenceId: string) => Promise<void>;
  onUploadStoryAudio: (storyId: string, file: File) => Promise<void>;
  onDeleteStoryAudio: (storyId: string) => Promise<void>;
  onMoveStoryToFolder: (storyId: string, folderId: string) => Promise<void>;
  onMoveFolder: (folderId: string, parentId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onDeleteStory: (storyId: string) => Promise<void>;
  story: Story | null;
  loadingStory: boolean;
  pages: Paragraph[][];
  pageIndex: number;
  setPageIndex: (index: number) => void;
  selectedSentence: Sentence | null;
  selectedSentenceCards: MinedCard[];
  allCards: MinedCard[];
  cardLoadState: CardLoadState;
  analyzingId: string;
  onChooseSentence: (sentence: Sentence) => void;
  onAnalyzeSentence: (sentence: Sentence, force?: boolean) => Promise<void>;
  onCloseSentence: () => void;
  onToggleCompleted: (storyId: string, completed: boolean) => Promise<void>;
  refreshStoryAndCards: () => Promise<void>;
  setError: (message: string) => void;
};

export function ReaderView({
  stories,
  storyFolders,
  sidebarMode,
  onSidebarModeChange,
  selectedStoryId,
  onSelectStory,
  onCreateFolder,
  onRenameFolder,
  onRenameStory,
  onChangeStoryLevel,
  onUpdateSentence,
  onDeleteSentence,
  onUploadStoryAudio,
  onDeleteStoryAudio,
  onMoveStoryToFolder,
  onMoveFolder,
  onDeleteFolder,
  onDeleteStory,
  story,
  loadingStory,
  pages,
  pageIndex,
  setPageIndex,
  selectedSentence,
  selectedSentenceCards,
  allCards,
  cardLoadState,
  analyzingId,
  onChooseSentence,
  onAnalyzeSentence,
  onCloseSentence,
  onToggleCompleted,
  refreshStoryAndCards,
  setError
}: ReaderProps) {
  const [storySearchQuery, setStorySearchQuery] = useState("");
  const [storyStatusFilter, setStoryStatusFilter] = useState<StoryStatusFilter>("all");
  const storySearchTerm = storySearchQuery.trim().toLocaleLowerCase("hr");
  const hasStoryStatusFilter = storyStatusFilter !== "all";
  const filteredStories = useMemo(() => {
    return stories.filter((item) => {
      if (storyStatusFilter === "open" && item.completed) return false;
      if (storyStatusFilter === "completed" && !item.completed) return false;
      if (!storySearchTerm) return true;
      return item.title.toLocaleLowerCase("hr").includes(storySearchTerm);
    });
  }, [stories, storySearchTerm, storyStatusFilter]);
  const groupedStories = useMemo(() => groupStoriesByLevel(filteredStories), [filteredStories]);
  const folderTree = useMemo(() => buildFolderTree(filteredStories, storyFolders), [filteredStories, storyFolders]);
  const isStoryListFiltered = Boolean(storySearchTerm) || hasStoryStatusFilter;
  const visibleGroupedStories = useMemo(
    () => (isStoryListFiltered ? groupedStories.filter(([, levelStories]) => levelStories.length > 0) : groupedStories),
    [groupedStories, isStoryListFiltered]
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [movingStoryId, setMovingStoryId] = useState("");
  const [movingFolderId, setMovingFolderId] = useState("");
  const [collapsedLevelIds, setCollapsedLevelIds] = useState<Set<string>>(() => new Set());
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [editingFolderId, setEditingFolderId] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [editingStoryId, setEditingStoryId] = useState("");
  const [storyDraft, setStoryDraft] = useState("");
  const [draggingStoryId, setDraggingStoryId] = useState("");
  const [draggingFolderId, setDraggingFolderId] = useState("");
  const [folderDropId, setFolderDropId] = useState<string | null>(null);
  const [levelDropId, setLevelDropId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState("");
  const [contentEditStoryId, setContentEditStoryId] = useState("");
  const [editingSentence, setEditingSentence] = useState<Sentence | null>(null);
  const [pendingSentenceEdits, setPendingSentenceEdits] = useState<Record<string, string>>({});
  const [pendingDeletedSentenceIds, setPendingDeletedSentenceIds] = useState<Set<string>>(() => new Set());
  const [pendingStoryAudioFile, setPendingStoryAudioFile] = useState<File | null>(null);
  const [pendingStoryAudioRemoved, setPendingStoryAudioRemoved] = useState(false);
  const [storyAudioInputKey, setStoryAudioInputKey] = useState(0);
  const [storyAudioStatus, setStoryAudioStatus] = useState<StoryAudioStatus>({ currentTime: 0, duration: 0 });
  const [storyAudioPauseRequest, setStoryAudioPauseRequest] = useState(0);
  const [storyAudioPlayRequest, setStoryAudioPlayRequest] = useState(0);
  const [savingContentEdits, setSavingContentEdits] = useState(false);
  const [updatingProgressStoryId, setUpdatingProgressStoryId] = useState("");

  const isEditingStoryContent = Boolean(story && contentEditStoryId === story.id);
  const stagedPages = useMemo(() => {
    if (!isEditingStoryContent || !story) return pages;

    const paragraphs = story.paragraphs
      .map((paragraph) => ({
        ...paragraph,
        sentences: paragraph.sentences
          .filter((sentence) => !pendingDeletedSentenceIds.has(sentence.id))
          .map((sentence) => {
            const croatian = pendingSentenceEdits[sentence.id];
            if (!croatian) return sentence;
            return {
              ...sentence,
              croatian,
              analysis: croatian === sentence.croatian ? sentence.analysis : undefined
            };
          })
      }))
      .filter((paragraph) => paragraph.sentences.length);

    return buildPages(paragraphs);
  }, [isEditingStoryContent, pages, pendingDeletedSentenceIds, pendingSentenceEdits, story]);
  const selectedStorySummary = useMemo(
    () => stories.find((item) => item.id === selectedStoryId) || null,
    [stories, selectedStoryId]
  );
  const selectedStoryCompleted = Boolean(selectedStorySummary?.completed);
  const activePageIndex = Math.min(pageIndex, Math.max(0, stagedPages.length - 1));
  const isLastPage = activePageIndex >= stagedPages.length - 1;
  const visibleParagraphs = stagedPages[activePageIndex] || [];

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenus = () => setOpenMenuId("");
    document.addEventListener("click", closeMenus);
    return () => document.removeEventListener("click", closeMenus);
  }, [openMenuId]);

  useEffect(() => {
    setStoryAudioStatus({ currentTime: 0, duration: 0 });
  }, [story?.audioFile]);

  async function addFolder(parentId = "") {
    if (creatingFolder) return;
    setCreatingFolder(true);
    setOpenMenuId("");
    setError("");
    try {
      const folder = await onCreateFolder(parentId);
      if (parentId) {
        setCollapsedFolderIds((current) => {
          const next = new Set(current);
          next.delete(parentId);
          return next;
        });
      }
      setEditingFolderId(folder.id);
      setFolderDraft(folder.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Folder could not be created.");
    } finally {
      setCreatingFolder(false);
    }
  }

  function toggleFolder(folderId: string) {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  function toggleLevel(level: string) {
    setCollapsedLevelIds((current) => {
      const next = new Set(current);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  function startRenamingFolder(folder: StoryFolder) {
    setEditingFolderId(folder.id);
    setFolderDraft(folder.name);
  }

  async function finishRenamingFolder(folder: StoryFolder, value = folderDraft) {
    if (editingFolderId !== folder.id) return;
    const nextName = value.trim().replace(/\s+/g, " ");
    setEditingFolderId("");
    if (!nextName || nextName === folder.name) {
      setFolderDraft("");
      return;
    }

    setError("");
    try {
      await onRenameFolder(folder.id, nextName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Folder could not be renamed.");
    } finally {
      setFolderDraft("");
    }
  }

  function handleFolderNameKey(event: KeyboardEvent<HTMLInputElement>, folder: StoryFolder) {
    if (event.key === "Enter") {
      event.preventDefault();
      void finishRenamingFolder(folder, event.currentTarget.value);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setFolderDraft(folder.name);
      setEditingFolderId("");
    }
  }

  function startRenamingStory(item: StorySummary) {
    setEditingStoryId(item.id);
    setStoryDraft(item.title);
  }

  async function finishRenamingStory(item: StorySummary, value = storyDraft) {
    if (editingStoryId !== item.id) return;
    const nextTitle = value.trim().replace(/\s+/g, " ");
    setEditingStoryId("");
    if (!nextTitle || nextTitle === item.title) {
      setStoryDraft("");
      return;
    }

    setError("");
    try {
      await onRenameStory(item.id, nextTitle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story could not be renamed.");
    } finally {
      setStoryDraft("");
    }
  }

  function handleStoryNameKey(event: KeyboardEvent<HTMLInputElement>, item: StorySummary) {
    if (event.key === "Enter") {
      event.preventDefault();
      void finishRenamingStory(item, event.currentTarget.value);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setStoryDraft(item.title);
      setEditingStoryId("");
    }
  }

  function storyFolderId(storyId: string) {
    return stories.find((item) => item.id === storyId)?.folderId || "";
  }

  function storyReadingLevel(storyId: string) {
    return stories.find((item) => item.id === storyId)?.level || "";
  }

  function dragHasType(event: DragEvent<HTMLElement>, type: string) {
    return Array.from(event.dataTransfer.types).includes(type);
  }

  function draggedStoryId(event: DragEvent<HTMLElement>) {
    if (draggingFolderId || dragHasType(event, FOLDER_DRAG_TYPE)) return "";
    return draggingStoryId || event.dataTransfer.getData(STORY_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
  }

  function draggedFolderId(event: DragEvent<HTMLElement>) {
    return draggingFolderId || event.dataTransfer.getData(FOLDER_DRAG_TYPE);
  }

  function clearDragState() {
    setDraggingStoryId("");
    setDraggingFolderId("");
    setFolderDropId(null);
    setLevelDropId(null);
  }

  function beginStoryDrag(event: DragEvent<HTMLDivElement>, storyId: string) {
    setDraggingStoryId(storyId);
    setOpenMenuId("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(STORY_DRAG_TYPE, storyId);
    event.dataTransfer.setData("text/plain", storyId);
  }

  function beginFolderDrag(event: DragEvent<HTMLElement>, folderId: string) {
    const target = event.target as HTMLElement;
    if (target.closest("button,input")) {
      event.preventDefault();
      return;
    }

    setDraggingFolderId(folderId);
    setOpenMenuId("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FOLDER_DRAG_TYPE, folderId);
    event.dataTransfer.setData("text/plain", folderId);
  }

  function canMoveFolderToParent(folderId: string, parentId: string) {
    const currentParentId = storyFolders.find((folder) => folder.id === folderId)?.parentId || "";
    return Boolean(
      folderId &&
        parentId !== currentParentId &&
        folderId !== parentId &&
        !isSameOrDescendantFolder(parentId, folderId)
    );
  }

  async function moveFolderToParent(folderId: string, parentId: string) {
    if (movingFolderId) return;

    setMovingFolderId(folderId);
    setOpenMenuId("");
    setError("");
    try {
      await onMoveFolder(folderId, parentId);
      if (parentId) {
        setCollapsedFolderIds((current) => {
          const next = new Set(current);
          next.delete(parentId);
          return next;
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Folder could not be moved.");
    } finally {
      setMovingFolderId("");
    }
  }

  function markFolderDropTarget(event: DragEvent<HTMLElement>, folderId: string) {
    const storyId = draggedStoryId(event);
    const folderToMoveId = draggedFolderId(event);
    if (!storyId && !canMoveFolderToParent(folderToMoveId, folderId)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setFolderDropId(folderId);
    setLevelDropId(null);
  }

  function markLevelDropTarget(event: DragEvent<HTMLElement>, level: string) {
    const draggedId = draggedStoryId(event);
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setLevelDropId(level);
    setFolderDropId(null);
  }

  async function dropInFolder(event: DragEvent<HTMLElement>, folderId: string) {
    event.preventDefault();
    event.stopPropagation();
    const folderToMoveId = draggedFolderId(event);
    const storyId = draggedStoryId(event);
    clearDragState();

    if (folderToMoveId) {
      if (!canMoveFolderToParent(folderToMoveId, folderId) || movingFolderId) return;
      await moveFolderToParent(folderToMoveId, folderId);
      return;
    }

    if (!storyId || movingStoryId) return;

    const sourceFolderId = storyFolderId(storyId);
    if (sourceFolderId === folderId) return;

    setMovingStoryId(storyId);
    setError("");
    try {
      await onMoveStoryToFolder(storyId, folderId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story could not be moved.");
    } finally {
      setMovingStoryId("");
    }
  }

  async function dropStoryInLevel(event: DragEvent<HTMLElement>, level: string) {
    event.preventDefault();
    event.stopPropagation();
    const storyId = draggedStoryId(event);
    clearDragState();
    if (!storyId || movingStoryId) return;
    if (storyReadingLevel(storyId) === level) return;

    setMovingStoryId(storyId);
    setError("");
    try {
      await onChangeStoryLevel(storyId, level);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story level could not be changed.");
    } finally {
      setMovingStoryId("");
    }
  }

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, id: string) {
    event.stopPropagation();
    setOpenMenuId((current) => (current === id ? "" : id));
  }

  function clearContentEditing() {
    setContentEditStoryId("");
    setEditingSentence(null);
    setPendingSentenceEdits({});
    setPendingDeletedSentenceIds(new Set());
    setPendingStoryAudioFile(null);
    setPendingStoryAudioRemoved(false);
    setStoryAudioInputKey((current) => current + 1);
  }

  function selectStoryFromSidebar(storyId: string) {
    if (storyId !== selectedStoryId) clearContentEditing();
    onSelectStory(storyId);
  }

  function startEditingStoryContent(item: StorySummary) {
    setOpenMenuId("");
    if (contentEditStoryId === item.id) return;
    setContentEditStoryId(item.id);
    setEditingSentence(null);
    setPendingSentenceEdits({});
    setPendingDeletedSentenceIds(new Set());
    setPendingStoryAudioFile(null);
    setPendingStoryAudioRemoved(false);
    setStoryAudioInputKey((current) => current + 1);
    onCloseSentence();
    if (selectedStoryId !== item.id) {
      onSelectStory(item.id);
    }
  }

  function openSentenceEditor(sentence: Sentence) {
    setEditingSentence(sentence);
    onCloseSentence();
  }

  async function setStoryCompletion(storyId: string, nextCompleted: boolean) {
    if (updatingProgressStoryId) return;
    setUpdatingProgressStoryId(storyId);
    setOpenMenuId("");
    setError("");
    try {
      await onToggleCompleted(storyId, nextCompleted);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story progress could not be updated.");
    } finally {
      setUpdatingProgressStoryId("");
    }
  }

  function stageEditedSentence(sentence: Sentence, croatian: string) {
    if (!story) return;
    const sourceSentence = sentenceList(story).find((item) => item.id === sentence.id);
    if (!sourceSentence) return;

    const nextCroatian = cleanSentenceText(croatian);
    const originalCroatian = cleanSentenceText(sourceSentence.croatian);
    setPendingSentenceEdits((current) => {
      const next = { ...current };
      if (nextCroatian === originalCroatian) {
        delete next[sentence.id];
      } else {
        next[sentence.id] = nextCroatian;
      }
      return next;
    });
    setEditingSentence(null);
  }

  function deleteEditedSentence(sentence: Sentence) {
    if (!story) return;
    const cardCount = sentence.cardCount || 0;
    const warning = cardCount
      ? `Delete this sentence? ${cardCount} saved ${cardCount === 1 ? "card" : "cards"} from it will stay in Cards.`
      : "Delete this sentence?";
    if (!window.confirm(warning)) return;

    setPendingSentenceEdits((current) => {
      const next = { ...current };
      delete next[sentence.id];
      return next;
    });
    setPendingDeletedSentenceIds((current) => {
      const next = new Set(current);
      next.add(sentence.id);
      return next;
    });
    setEditingSentence(null);
  }

  function stageStoryAudioUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    setPendingStoryAudioFile(file);
    setPendingStoryAudioRemoved(false);
  }

  function stageStoryAudioRemoval() {
    setPendingStoryAudioFile(null);
    setPendingStoryAudioRemoved(Boolean(story?.audioFile));
    setStoryAudioInputKey((current) => current + 1);
  }

  function renderStoryAudioEditFooter() {
    const audioFileName = pendingStoryAudioFile?.name || (pendingStoryAudioRemoved ? "" : story?.audioFile || "");

    return (
      <section className="story-audio-edit-panel" aria-label="Story audio edit">
        {audioFileName ? (
          <div className="story-audio-edit-file">
            <span className="story-audio-edit-file-name">
              <FileAudio size={17} aria-hidden="true" />
              {audioFileName}
            </span>
            <button
              className="story-audio-edit-remove icon-button"
              type="button"
              onClick={stageStoryAudioRemoval}
              disabled={savingContentEdits}
              aria-label="Remove story audio"
              title="Remove audio"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <label className={`story-audio-upload-button ${savingContentEdits ? "disabled" : ""}`} aria-label="Upload story audio" title="Upload audio">
            <FileAudio size={20} aria-hidden="true" />
            <span>Upload audio</span>
            <input
              key={storyAudioInputKey}
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.ogg,.oga,.webm,.flac,.aac"
              onChange={stageStoryAudioUpload}
              disabled={savingContentEdits}
            />
          </label>
        )}
      </section>
    );
  }

  async function saveContentEditing() {
    if (!story || savingContentEdits) return;

    const storyId = story.id;
    const deletedSentenceIds = Array.from(pendingDeletedSentenceIds);
    const editedSentences = Object.entries(pendingSentenceEdits).filter(
      ([sentenceId]) => !pendingDeletedSentenceIds.has(sentenceId)
    );
    const audioChanged = Boolean(pendingStoryAudioFile || (pendingStoryAudioRemoved && story.audioFile));

    if (!deletedSentenceIds.length && !editedSentences.length && !audioChanged) {
      clearContentEditing();
      return;
    }

    setSavingContentEdits(true);
    setError("");
    try {
      for (const [sentenceId, croatian] of editedSentences) {
        await onUpdateSentence(storyId, sentenceId, croatian);
      }
      for (const sentenceId of deletedSentenceIds) {
        await onDeleteSentence(storyId, sentenceId);
      }
      if (pendingStoryAudioFile) {
        await onUploadStoryAudio(storyId, pendingStoryAudioFile);
      } else if (pendingStoryAudioRemoved && story.audioFile) {
        await onDeleteStoryAudio(storyId);
      }
      clearContentEditing();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story edits could not be saved.");
    } finally {
      setSavingContentEdits(false);
    }
  }

  function descendantFolderCount(node: FolderTreeNode): number {
    return node.children.reduce((total, child) => total + 1 + descendantFolderCount(child), 0);
  }

  async function deleteFolder(folder: StoryFolder, storyCount: number, subfolderCount = 0) {
    if (storyCount > 0 || subfolderCount > 0) {
      const contents = [
        storyCount ? `${storyCount} ${storyCount === 1 ? "story" : "stories"}` : "",
        subfolderCount ? `${subfolderCount} ${subfolderCount === 1 ? "subfolder" : "subfolders"}` : ""
      ]
        .filter(Boolean)
        .join(" and ");
      if (!window.confirm(`Delete "${folder.name}" and its ${contents}? Saved cards from those stories will stay in Cards.`)) {
        return;
      }
    }

    setOpenMenuId("");
    setError("");
    try {
      await onDeleteFolder(folder.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Folder could not be deleted.");
    }
  }

  async function deleteStory(item: StorySummary) {
    if (!window.confirm(`Delete "${item.title}"? Saved cards from this story will stay in Cards.`)) {
      return;
    }

    setOpenMenuId("");
    setError("");
    try {
      await onDeleteStory(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story could not be deleted.");
    }
  }

  function renderStoryMenu(item: StorySummary) {
    const menuId = `story-${item.id}`;
    return (
      <div className="row-menu-wrap" onClick={(event) => event.stopPropagation()}>
        <button
          className="row-menu-button"
          type="button"
          onClick={(event) => toggleMenu(event, menuId)}
          aria-label={`Story options for ${item.title}`}
          title="Story options"
        >
          <MoreHorizontal size={15} aria-hidden="true" />
        </button>
        {openMenuId === menuId && (
          <div className="row-menu" role="menu">
            {item.completed && (
              <button
                type="button"
                onClick={() => void setStoryCompletion(item.id, false)}
                disabled={Boolean(updatingProgressStoryId)}
                role="menuitem"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Reopen
              </button>
            )}
            <button type="button" onClick={() => startEditingStoryContent(item)} role="menuitem">
              <PencilLine size={14} aria-hidden="true" />
              Edit
            </button>
            <button className="danger-menu-item" type="button" onClick={() => void deleteStory(item)} role="menuitem">
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderStoryRow(item: StorySummary) {
    const isDragging = draggingStoryId === item.id;
    const isEditing = editingStoryId === item.id;
    const isDraggable = !isEditing;

    return (
      <div
        className={`story-row ${item.id === selectedStoryId ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
        draggable={isDraggable}
        key={item.id}
        onDragStart={isDraggable ? (event) => beginStoryDrag(event, item.id) : undefined}
        onDragEnd={clearDragState}
      >
        {isEditing ? (
          <div className="story-row-main story-row-editing">
            <input
              className="story-name-input"
              value={storyDraft}
              onChange={(event) => setStoryDraft(event.target.value)}
              onBlur={(event) => void finishRenamingStory(item, event.currentTarget.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => handleStoryNameKey(event, item)}
              aria-label="Story title"
              autoFocus
            />
          </div>
        ) : (
          <button
            className="story-row-content story-row-select"
            type="button"
            onClick={() => selectStoryFromSidebar(item.id)}
            onDoubleClick={() => startRenamingStory(item)}
          >
            <span className="story-title-line">
              <span className="story-title">{item.title}</span>
              {item.audioFile && (
                <span className="story-audio-indicator" aria-label="Has audio" title="Has audio">
                  <AudioLines size={14} aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="story-meta">
              <span className={item.completed ? "status done" : "status"}>
                {item.completed ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                {item.completed ? "Completed" : "Open"}
              </span>
            </span>
          </button>
        )}
        {renderStoryMenu(item)}
      </div>
    );
  }

  function renderFolderMenu(folder: StoryFolder, node: FolderTreeNode) {
    const menuId = `folder-${folder.id}`;
    return (
      <div className="row-menu-wrap" onClick={(event) => event.stopPropagation()}>
        <button
          className="row-menu-button"
          type="button"
          onClick={(event) => toggleMenu(event, menuId)}
          aria-label={`Folder options for ${folder.name}`}
          title="Folder options"
        >
          <MoreHorizontal size={15} aria-hidden="true" />
        </button>
        {openMenuId === menuId && (
          <div className="row-menu" role="menu">
            <button type="button" onClick={() => void addFolder(folder.id)} role="menuitem">
              <FolderPlus size={14} aria-hidden="true" />
              Add Subfolder
            </button>
            <button
              className="danger-menu-item"
              type="button"
              onClick={() => void deleteFolder(folder, node.storyCount, descendantFolderCount(node))}
              role="menuitem"
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderFolderNode(node: FolderTreeNode) {
    if (isStoryListFiltered && node.storyCount === 0) return null;

    const folder = node.folder;
    const isCollapsed = !isStoryListFiltered && collapsedFolderIds.has(folder.id);
    const isEditing = editingFolderId === folder.id;
    const isDragging = draggingFolderId === folder.id;

    return (
      <section
        className={`level-folder folder-section ${folderDropId === folder.id ? "has-drag-target" : ""} ${
          isDragging ? "dragging-folder" : ""
        }`}
        key={`folder-${folder.id}`}
        style={{ "--folder-indent": `${node.depth * 0.85}rem` } as CSSProperties}
        onDragOver={(event) => markFolderDropTarget(event, folder.id)}
        onDrop={(event) => void dropInFolder(event, folder.id)}
      >
        <div
          className="level-folder-head folder-folder-head"
          draggable={!isEditing && movingFolderId !== folder.id}
          onDragStart={!isEditing ? (event) => beginFolderDrag(event, folder.id) : undefined}
          onDragEnd={clearDragState}
        >
          <button
            className="folder-collapse-button"
            type="button"
            onClick={() => toggleFolder(folder.id)}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${folder.name}`}
            title={isCollapsed ? "Expand section" : "Collapse section"}
          >
            {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
          <Folder size={15} aria-hidden="true" />
          {isEditing ? (
            <input
              className="folder-name-input"
              value={folderDraft}
              onChange={(event) => setFolderDraft(event.target.value)}
              onBlur={(event) => void finishRenamingFolder(folder, event.currentTarget.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => handleFolderNameKey(event, folder)}
              aria-label="Folder name"
              autoFocus
            />
          ) : (
            <button
              className="folder-name-button"
              type="button"
              onDoubleClick={() => startRenamingFolder(folder)}
              title="Double-click to rename"
            >
              {folder.name}
            </button>
          )}
          {renderFolderMenu(folder, node)}
        </div>
        {!isCollapsed && node.storyCount === 0 && <p className="folder-empty muted">No stories yet.</p>}
        {!isCollapsed && node.stories.map((item) => renderStoryRow(item))}
        {!isCollapsed && node.children.map((child) => renderFolderNode(child))}
      </section>
    );
  }

  function renderUnfiledFolder() {
    const isCollapsed = !isStoryListFiltered && collapsedFolderIds.has("");
    return (
      <section
        className={`level-folder folder-section ${folderDropId === "" ? "has-drag-target" : ""}`}
        key="folder-unfiled"
        style={{ "--folder-indent": "0rem" } as CSSProperties}
        onDragOver={(event) => markFolderDropTarget(event, "")}
        onDrop={(event) => void dropInFolder(event, "")}
      >
        <div className="level-folder-head folder-folder-head unfiled-folder-head">
          <button
            className="folder-collapse-button"
            type="button"
            onClick={() => toggleFolder("")}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} Unfiled`}
            title={isCollapsed ? "Expand section" : "Collapse section"}
          >
            {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
          <span className="folder-name-static">Unfiled</span>
        </div>
        {!isCollapsed && folderTree.unfiledStories.length === 0 && <p className="folder-empty muted">No stories yet.</p>}
        {!isCollapsed && folderTree.unfiledStories.map((item) => renderStoryRow(item))}
      </section>
    );
  }

  return (
    <main className="reader-grid">
      <aside className="story-sidebar" aria-label="Stories">
        <div className="panel-heading">
          <h2>Stories</h2>
        </div>
        <div className="story-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={storySearchQuery}
            onChange={(event) => setStorySearchQuery(event.target.value)}
            placeholder="Search titles"
            aria-label="Search stories by title"
            spellCheck={false}
          />
          {storySearchQuery && (
            <button
              className="story-search-clear icon-button"
              type="button"
              onClick={() => setStorySearchQuery("")}
              aria-label="Clear story search"
              title="Clear search"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
          <div className="story-filter-menu-wrap" onClick={(event) => event.stopPropagation()}>
            <button
              className={`story-filter-button icon-button ${hasStoryStatusFilter ? "active" : ""}`}
              type="button"
              onClick={(event) => toggleMenu(event, STORY_STATUS_FILTER_MENU_ID)}
              aria-label="Filter stories by status"
              aria-expanded={openMenuId === STORY_STATUS_FILTER_MENU_ID}
              title="Filter stories"
            >
              <ListFilter size={15} aria-hidden="true" />
            </button>
            {openMenuId === STORY_STATUS_FILTER_MENU_ID && (
              <div className="story-filter-menu" role="menu" aria-label="Status filters">
                {STORY_STATUS_FILTERS.map((filter) => (
                  <button
                    className={storyStatusFilter === filter.value ? "active" : ""}
                    type="button"
                    onClick={() => {
                      setStoryStatusFilter(filter.value);
                      setOpenMenuId("");
                    }}
                    role="menuitemradio"
                    aria-checked={storyStatusFilter === filter.value}
                    key={filter.value}
                  >
                    <span>{filter.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sidebar-mode-toggle" role="group" aria-label="Story organization">
          <button
            type="button"
            className={sidebarMode === "level" ? "active" : ""}
            onClick={() => onSidebarModeChange("level")}
          >
            <List size={15} aria-hidden="true" />
            Levels
          </button>
          <button
            type="button"
            className={sidebarMode === "folder" ? "active" : ""}
            onClick={() => onSidebarModeChange("folder")}
          >
            <Folder size={15} aria-hidden="true" />
            Folders
          </button>
        </div>
        {sidebarMode === "folder" && (
          <div className="folder-toolbar">
            <button
              className="folder-add-button"
              type="button"
              disabled={creatingFolder}
              onClick={() => void addFolder()}
              title="Add folder"
              aria-label="Add folder"
            >
              <Plus size={15} aria-hidden="true" />
              Add Folder
            </button>
          </div>
        )}
        <div className="story-list">
          {stories.length === 0 && <p className="muted">Import a Croatian text to begin.</p>}
          {stories.length > 0 && isStoryListFiltered && filteredStories.length === 0 && (
            <p className="story-search-empty muted">No matching stories.</p>
          )}
          {filteredStories.length > 0 &&
            sidebarMode === "level" &&
            visibleGroupedStories.map(([level, levelStories]) => {
              const isCollapsed = !isStoryListFiltered && collapsedLevelIds.has(level);
              return (
                <section
                  className={`level-folder level-drop-section ${levelDropId === level ? "has-drag-target" : ""}`}
                  key={level}
                  onDragOver={(event) => markLevelDropTarget(event, level)}
                  onDrop={(event) => void dropStoryInLevel(event, level)}
                >
                  <div className="level-folder-head level-list-head">
                    <button
                      className="level-collapse-button"
                      type="button"
                      onClick={() => toggleLevel(level)}
                      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${level}`}
                      title={isCollapsed ? "Expand level" : "Collapse level"}
                    >
                      {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    </button>
                    <span>{level}</span>
                  </div>
                  {!isCollapsed && levelStories.map((item) => renderStoryRow(item))}
                </section>
              );
            })}
          {filteredStories.length > 0 && sidebarMode === "folder" && (
            <>
              {(!isStoryListFiltered || folderTree.unfiledStories.length > 0) && renderUnfiledFolder()}
              {folderTree.nodes.map((node) => renderFolderNode(node))}
            </>
          )}
        </div>
      </aside>

      <section className="reading-panel" aria-label="Reader">
        {loadingStory && (
          <div className="reader-scroll-area">
            <p className="muted">Loading story...</p>
          </div>
        )}
        {!loadingStory && story && (
          <>
            <div className="reader-scroll-area">
              <div className="reader-head">
                <div>
                  <p className="level-label">{story.level}</p>
                  <h1>{story.title}</h1>
                </div>
                {isEditingStoryContent && (
                  <div className="reader-actions" aria-label="Edit mode actions">
                    <div className="reader-action-buttons">
                      <button
                        className="edit-mode-cancel-button secondary"
                        type="button"
                        onClick={clearContentEditing}
                        disabled={savingContentEdits}
                      >
                        <X size={16} aria-hidden="true" />
                        Cancel
                      </button>
                      <button
                        className="edit-mode-save-button"
                        type="button"
                        onClick={() => void saveContentEditing()}
                        disabled={savingContentEdits}
                      >
                        <Save size={16} aria-hidden="true" />
                        {savingContentEdits ? "Saving..." : "Save"}
                      </button>
                    </div>
                    <span className="edit-mode-label">Edit mode</span>
                  </div>
                )}
              </div>

              <div className="page-controls" aria-label="Page controls">
                <button disabled={activePageIndex === 0} onClick={() => setPageIndex(activePageIndex - 1)} title="Previous page">
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous
                </button>
                <span>
                  Page {activePageIndex + 1} of {stagedPages.length}
                </span>
                {isLastPage ? (
                  <button
                    disabled={!story || selectedStoryCompleted || updatingProgressStoryId === story.id}
                    onClick={() => story && void setStoryCompletion(story.id, true)}
                    title={selectedStoryCompleted ? "Story completed" : "Mark completed"}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {selectedStoryCompleted ? "Completed" : "Mark Completed"}
                  </button>
                ) : (
                  <button onClick={() => setPageIndex(activePageIndex + 1)} title="Next page">
                    Next
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                )}
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
                        onClick={() => (isEditingStoryContent ? openSentenceEditor(sentence) : onChooseSentence(sentence))}
                        title={
                          isEditingStoryContent
                            ? "Edit sentence"
                            : sentence.hasCards
                              ? `${sentence.cardCount} saved card(s)`
                              : "Analyze sentence"
                        }
                      >
                        {sentence.croatian}{" "}
                      </button>
                    ))}
                  </p>
                ))}
              </article>
            </div>

            {isEditingStoryContent ? (
              <div className="reader-audio-footer">
                {renderStoryAudioEditFooter()}
              </div>
            ) : story.audioFile && (
              <div className="reader-audio-footer">
                <StoryAudioPlayer
                  audioFile={story.audioFile}
                  title={story.title}
                  onPlaybackStart={() => setStoryAudioPlayRequest((current) => current + 1)}
                  onStatusChange={setStoryAudioStatus}
                  pauseRequest={storyAudioPauseRequest}
                  setError={setError}
                />
              </div>
            )}
          </>
        )}
      </section>

      {story && editingSentence && (
        <SentenceEditModal
          sentence={editingSentence}
          onClose={() => setEditingSentence(null)}
          onSave={stageEditedSentence}
          onDelete={deleteEditedSentence}
        />
      )}

      <AnalysisPanel
        story={story}
        sentence={selectedSentence}
        cards={selectedSentenceCards}
        allCards={allCards}
        cardLoadState={cardLoadState}
        isAnalyzing={analyzingId === selectedSentence?.id}
        onAnalyzeSentence={onAnalyzeSentence}
        onClose={onCloseSentence}
        refreshStoryAndCards={refreshStoryAndCards}
        storyAudioCurrentTime={storyAudioStatus.currentTime}
        storyAudioDuration={storyAudioStatus.duration}
        storyAudioPlayRequest={storyAudioPlayRequest}
        onStartStoryAudioClipPreview={() => setStoryAudioPauseRequest((current) => current + 1)}
        setError={setError}
      />
    </main>
  );
}
