import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Folder,
  List,
  MoreHorizontal,
  Plus,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { groupStoriesByFolder, groupStoriesByLevel } from "../../domain/stories";
import type { MinedCard, Paragraph, Sentence, Story, StoryFolder, StorySummary } from "../../types";
import { AnalysisPanel } from "./AnalysisPanel";

type StorySidebarMode = "level" | "folder";

type ReaderProps = {
  stories: StorySummary[];
  storyFolders: StoryFolder[];
  selectedStoryId: string;
  onSelectStory: (id: string) => void;
  onCreateFolder: () => Promise<StoryFolder>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onRenameStory: (storyId: string, title: string) => Promise<void>;
  onChangeStoryLevel: (storyId: string, level: string) => Promise<void>;
  onMoveStoryToFolder: (storyId: string, folderId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onDeleteStory: (storyId: string) => Promise<void>;
  story: Story | null;
  loadingStory: boolean;
  pages: Paragraph[][];
  pageIndex: number;
  setPageIndex: (index: number) => void;
  selectedSentence: Sentence | null;
  selectedSentenceCards: MinedCard[];
  analyzingId: string;
  onChooseSentence: (sentence: Sentence) => void;
  onAnalyzeSentence: (sentence: Sentence, force?: boolean) => Promise<void>;
  onCloseSentence: () => void;
  onToggleCompleted: (completed: boolean) => Promise<void>;
  completed: boolean;
  refreshStoryAndCards: () => Promise<void>;
  setError: (message: string) => void;
};

export function ReaderView({
  stories,
  storyFolders,
  selectedStoryId,
  onSelectStory,
  onCreateFolder,
  onRenameFolder,
  onRenameStory,
  onChangeStoryLevel,
  onMoveStoryToFolder,
  onDeleteFolder,
  onDeleteStory,
  story,
  loadingStory,
  pages,
  pageIndex,
  setPageIndex,
  selectedSentence,
  selectedSentenceCards,
  analyzingId,
  onChooseSentence,
  onAnalyzeSentence,
  onCloseSentence,
  onToggleCompleted,
  completed,
  refreshStoryAndCards,
  setError
}: ReaderProps) {
  const visibleParagraphs = pages[pageIndex] || [];
  const groupedStories = useMemo(() => groupStoriesByLevel(stories), [stories]);
  const folderGroups = useMemo(() => groupStoriesByFolder(stories, storyFolders), [stories, storyFolders]);
  const [sidebarMode, setSidebarMode] = useState<StorySidebarMode>("level");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [movingStoryId, setMovingStoryId] = useState("");
  const [collapsedLevelIds, setCollapsedLevelIds] = useState<Set<string>>(() => new Set());
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [editingFolderId, setEditingFolderId] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [editingStoryId, setEditingStoryId] = useState("");
  const [storyDraft, setStoryDraft] = useState("");
  const [draggingStoryId, setDraggingStoryId] = useState("");
  const [folderDropId, setFolderDropId] = useState("");
  const [levelDropId, setLevelDropId] = useState("");
  const [openMenuId, setOpenMenuId] = useState("");

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenus = () => setOpenMenuId("");
    document.addEventListener("click", closeMenus);
    return () => document.removeEventListener("click", closeMenus);
  }, [openMenuId]);

  async function addFolder() {
    if (creatingFolder) return;
    setCreatingFolder(true);
    setError("");
    try {
      const folder = await onCreateFolder();
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

  function draggedStoryId(event: DragEvent<HTMLElement>) {
    return draggingStoryId || event.dataTransfer.getData("text/plain");
  }

  function clearDragState() {
    setDraggingStoryId("");
    setFolderDropId("");
    setLevelDropId("");
  }

  function beginStoryDrag(event: DragEvent<HTMLDivElement>, storyId: string) {
    setDraggingStoryId(storyId);
    setOpenMenuId("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", storyId);
  }

  function markFolderDropTarget(event: DragEvent<HTMLElement>, folderId: string) {
    const draggedId = draggedStoryId(event);
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setFolderDropId(folderId);
    setLevelDropId("");
  }

  function markLevelDropTarget(event: DragEvent<HTMLElement>, level: string) {
    const draggedId = draggedStoryId(event);
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setLevelDropId(level);
    setFolderDropId("");
  }

  async function dropStoryInFolder(event: DragEvent<HTMLElement>, folderId: string) {
    event.preventDefault();
    event.stopPropagation();
    const storyId = draggedStoryId(event);
    clearDragState();
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

  async function deleteFolder(folder: StoryFolder, storyCount: number) {
    if (
      storyCount > 0 &&
      !window.confirm(`Delete "${folder.name}" and its ${storyCount} ${storyCount === 1 ? "story" : "stories"}?`)
    ) {
      return;
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
            <button type="button" onClick={() => void deleteStory(item)} role="menuitem">
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
            className="story-row-main"
            type="button"
            onClick={() => onSelectStory(item.id)}
            onDoubleClick={() => startRenamingStory(item)}
          >
            <span className="story-title">{item.title}</span>
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

  return (
    <main className="reader-grid">
      <aside className="story-sidebar" aria-label="Stories">
        <div className="panel-heading">
          <h2>Stories</h2>
        </div>
        <div className="sidebar-mode-toggle" role="group" aria-label="Story organization">
          <button type="button" className={sidebarMode === "level" ? "active" : ""} onClick={() => setSidebarMode("level")}>
            <List size={15} aria-hidden="true" />
            Levels
          </button>
          <button type="button" className={sidebarMode === "folder" ? "active" : ""} onClick={() => setSidebarMode("folder")}>
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
          {sidebarMode === "level" &&
            groupedStories.map(([level, levelStories]) => {
              const isCollapsed = collapsedLevelIds.has(level);
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
          {sidebarMode === "folder" &&
            folderGroups.map(([folder, folderStories]) => {
              const isCollapsed = collapsedFolderIds.has(folder.id);
              const isUnfiled = !folder.id;
              const menuId = `folder-${folder.id}`;
              return (
                <section
                  className={`level-folder folder-section ${folderDropId === folder.id ? "has-drag-target" : ""}`}
                  key={folder.id ? `folder-${folder.id}` : "folder-unfiled"}
                  onDragOver={(event) => markFolderDropTarget(event, folder.id)}
                  onDrop={(event) => void dropStoryInFolder(event, folder.id)}
                >
                  <div className={`level-folder-head folder-folder-head ${isUnfiled ? "unfiled-folder-head" : ""}`}>
                    <button
                      className="folder-collapse-button"
                      type="button"
                      onClick={() => toggleFolder(folder.id)}
                      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${folder.name}`}
                      title={isCollapsed ? "Expand section" : "Collapse section"}
                    >
                      {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    </button>
                    {!isUnfiled && <Folder size={15} aria-hidden="true" />}
                    {isUnfiled ? (
                      <span className="folder-name-static">Unfiled</span>
                    ) : editingFolderId === folder.id ? (
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
                    {!isUnfiled && (
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
                            <button type="button" onClick={() => void deleteFolder(folder, folderStories.length)} role="menuitem">
                              <Trash2 size={14} aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {!isCollapsed && folderStories.length === 0 && <p className="folder-empty muted">No stories yet.</p>}
                  {!isCollapsed && folderStories.map((item) => renderStoryRow(item))}
                </section>
              );
            })}
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
        onAnalyzeSentence={onAnalyzeSentence}
        onClose={onCloseSentence}
        refreshStoryAndCards={refreshStoryAndCards}
        setError={setError}
      />
    </main>
  );
}
