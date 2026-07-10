import { promises as fs } from "node:fs";
import path from "node:path";
import { storyFoldersFile, textsDir } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";
import {
  assertFolderId,
  cleanFolderId,
  folderSegment,
  isSameOrDescendantFolder,
  joinFolderId,
  parentFolderId,
  replaceFolderPrefix
} from "../utils/folders.js";
import { slugify } from "../utils/text.js";

const emptyFoldersState = { folders: [] };
const defaultFolderName = "New folder";

function cleanFolderName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function clientFolder(folder) {
  const id = cleanFolderId(folder.id);
  return {
    id,
    name: cleanFolderName(folder.name) || folderSegment(id) || defaultFolderName,
    parentId: parentFolderId(id)
  };
}

function normalizeFoldersState(state) {
  const folders = [];
  const seenIds = new Set();

  for (const item of Array.isArray(state?.folders) ? state.folders : []) {
    if (!item || typeof item.id !== "string") continue;
    const id = cleanFolderId(item.id);
    try {
      assertFolderId(id);
    } catch {
      continue;
    }
    if (!id || seenIds.has(id)) continue;

    seenIds.add(id);
    folders.push(clientFolder({ id, name: item.name }));
  }

  return { folders };
}

async function readFoldersState() {
  return normalizeFoldersState(await readJson(storyFoldersFile, emptyFoldersState));
}

async function writeFoldersState(state) {
  state.folders = state.folders.map(clientFolder);
  await writeJsonSafe(storyFoldersFile, state);
}

function textsRootPath() {
  return path.resolve(textsDir);
}

function folderDirectoryPath(folderId) {
  const cleanId = cleanFolderId(folderId);
  assertFolderId(cleanId);
  if (!cleanId) return textsRootPath();

  const directory = path.resolve(textsDir, cleanId);
  if (!directory.startsWith(`${textsRootPath()}${path.sep}`)) {
    const error = new Error("Invalid folder id.");
    error.status = 400;
    throw error;
  }
  return directory;
}

async function folderDirectoryExists(folderId) {
  try {
    return (await fs.stat(folderDirectoryPath(folderId))).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureFolderDirectories(folders) {
  await Promise.all(folders.map((folder) => fs.mkdir(folderDirectoryPath(folder.id), { recursive: true })));
}

function assertParentExists(folders, parentId) {
  const cleanParentId = cleanFolderId(parentId);
  assertFolderId(cleanParentId);
  if (!cleanParentId) return cleanParentId;

  if (!folders.some((folder) => folder.id === cleanParentId)) {
    const error = new Error("Parent folder not found.");
    error.status = 400;
    throw error;
  }

  return cleanParentId;
}

function assertUniqueFolderName(folders, parentId, name, ignoredIds = new Set()) {
  const normalizedName = name.toLocaleLowerCase("hr-HR");
  const cleanParentId = cleanFolderId(parentId);
  if (
    folders.some(
      (folder) =>
        !ignoredIds.has(folder.id) &&
        parentFolderId(folder.id) === cleanParentId &&
        folder.name.toLocaleLowerCase("hr-HR") === normalizedName
    )
  ) {
    const error = new Error("A folder with that name already exists there.");
    error.status = 409;
    throw error;
  }
}

function subtreeFolderIds(folders, folderId) {
  const ids = new Set();
  for (const folder of folders) {
    if (folder.id === folderId || isSameOrDescendantFolder(folder.id, folderId)) {
      ids.add(folder.id);
    }
  }
  return ids;
}

function nextFolderName(folders, parentId) {
  const cleanParentId = cleanFolderId(parentId);
  const takenNames = new Set(
    folders
      .filter((folder) => parentFolderId(folder.id) === cleanParentId)
      .map((folder) => folder.name.toLocaleLowerCase("hr-HR"))
  );
  if (!takenNames.has(defaultFolderName.toLocaleLowerCase("hr-HR"))) return defaultFolderName;

  let index = 2;
  while (takenNames.has(`${defaultFolderName} ${index}`.toLocaleLowerCase("hr-HR"))) {
    index += 1;
  }
  return `${defaultFolderName} ${index}`;
}

async function nextAvailableFolderId(folders, parentId, segment, ignoredIds = new Set()) {
  const cleanParentId = cleanFolderId(parentId);
  const baseSegment = slugify(segment || defaultFolderName);
  let candidateSegment = baseSegment;
  let index = 1;

  while (true) {
    const candidateId = joinFolderId(cleanParentId, candidateSegment);
    const metadataConflict = folders.some((folder) => folder.id === candidateId && !ignoredIds.has(folder.id));
    const diskConflict = !ignoredIds.has(candidateId) && (await folderDirectoryExists(candidateId));
    if (!metadataConflict && !diskConflict) return candidateId;

    candidateSegment = `${baseSegment}-${index}`;
    index += 1;
  }
}

async function moveFolderDirectory(oldFolderId, newFolderId) {
  if (oldFolderId === newFolderId) {
    await fs.mkdir(folderDirectoryPath(newFolderId), { recursive: true });
    return;
  }

  const oldPath = folderDirectoryPath(oldFolderId);
  const newPath = folderDirectoryPath(newFolderId);
  if (await folderDirectoryExists(newFolderId)) {
    const error = new Error("A folder already exists at that path.");
    error.status = 409;
    throw error;
  }

  await fs.mkdir(path.dirname(newPath), { recursive: true });
  try {
    await fs.rename(oldPath, newPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(newPath, { recursive: true });
  }
}

function applyFolderIdMove(folders, oldFolderId, newFolderId) {
  return folders.map((folder) => {
    if (folder.id !== oldFolderId && !isSameOrDescendantFolder(folder.id, oldFolderId)) {
      return clientFolder(folder);
    }

    return clientFolder({
      ...folder,
      id: replaceFolderPrefix(folder.id, oldFolderId, newFolderId)
    });
  });
}

function movedFolderResult(folders, oldFolderId, newFolderId) {
  const folder = folders.find((item) => item.id === newFolderId);
  return {
    folder,
    oldFolderId,
    newFolderId
  };
}

export async function listStoryFolders() {
  const state = await readFoldersState();
  await ensureFolderDirectories(state.folders);
  return state.folders;
}

export async function createStoryFolder(name, parentId = "") {
  const state = await readFoldersState();
  const cleanParentId = assertParentExists(state.folders, parentId);
  const cleanName = cleanFolderName(name) || nextFolderName(state.folders, cleanParentId);
  assertUniqueFolderName(state.folders, cleanParentId, cleanName);

  const id = await nextAvailableFolderId(state.folders, cleanParentId, cleanName);
  const folder = clientFolder({ id, name: cleanName });
  state.folders.push(folder);

  await fs.mkdir(folderDirectoryPath(folder.id), { recursive: true });
  await writeFoldersState(state);
  return folder;
}

export async function renameStoryFolder(id, name) {
  const cleanId = cleanFolderId(id);
  assertFolderId(cleanId);

  const cleanName = cleanFolderName(name);
  if (!cleanName) {
    const error = new Error("Folder name is required.");
    error.status = 400;
    throw error;
  }

  const state = await readFoldersState();
  const folder = state.folders.find((item) => item.id === cleanId);
  if (!folder) {
    const error = new Error("Folder not found.");
    error.status = 404;
    throw error;
  }

  const parentId = parentFolderId(folder.id);
  const ignoredIds = subtreeFolderIds(state.folders, folder.id);
  assertUniqueFolderName(state.folders, parentId, cleanName, ignoredIds);

  const newFolderId = await nextAvailableFolderId(state.folders, parentId, cleanName, ignoredIds);
  await moveFolderDirectory(folder.id, newFolderId);
  state.folders = applyFolderIdMove(state.folders, folder.id, newFolderId).map((item) =>
    item.id === newFolderId ? clientFolder({ ...item, name: cleanName }) : item
  );

  await writeFoldersState(state);
  return movedFolderResult(state.folders, cleanId, newFolderId);
}

export async function moveStoryFolder(id, parentId) {
  const cleanId = cleanFolderId(id);
  assertFolderId(cleanId);

  const state = await readFoldersState();
  const folder = state.folders.find((item) => item.id === cleanId);
  if (!folder) {
    const error = new Error("Folder not found.");
    error.status = 404;
    throw error;
  }

  const cleanParentId = assertParentExists(state.folders, parentId);
  if (cleanParentId === cleanId || isSameOrDescendantFolder(cleanParentId, cleanId)) {
    const error = new Error("A folder cannot be moved inside itself.");
    error.status = 400;
    throw error;
  }

  if (parentFolderId(folder.id) === cleanParentId) {
    return movedFolderResult(state.folders, folder.id, folder.id);
  }

  const ignoredIds = subtreeFolderIds(state.folders, folder.id);
  assertUniqueFolderName(state.folders, cleanParentId, folder.name, ignoredIds);
  const newFolderId = joinFolderId(cleanParentId, folderSegment(folder.id));
  if (
    state.folders.some((item) => item.id === newFolderId && !ignoredIds.has(item.id)) ||
    (await folderDirectoryExists(newFolderId))
  ) {
    const error = new Error("A folder already exists at that path.");
    error.status = 409;
    throw error;
  }

  await moveFolderDirectory(folder.id, newFolderId);
  state.folders = applyFolderIdMove(state.folders, folder.id, newFolderId);

  await writeFoldersState(state);
  return movedFolderResult(state.folders, cleanId, newFolderId);
}

export async function deleteStoryFolder(id) {
  const cleanId = cleanFolderId(id);
  assertFolderId(cleanId);

  const state = await readFoldersState();
  const deletedFolders = state.folders.filter(
    (item) => item.id === cleanId || isSameOrDescendantFolder(item.id, cleanId)
  );
  if (!deletedFolders.length) {
    const error = new Error("Folder not found.");
    error.status = 404;
    throw error;
  }

  state.folders = state.folders.filter((item) => !deletedFolders.some((folder) => folder.id === item.id));
  await writeFoldersState(state);
  await fs.rm(folderDirectoryPath(cleanId), { recursive: true, force: true });
  return deletedFolders;
}

export async function assertStoryFolderExists(folderId) {
  const cleanId = cleanFolderId(folderId);
  if (!cleanId) return "";
  assertFolderId(cleanId);

  const folders = await listStoryFolders();
  if (!folders.some((folder) => folder.id === cleanId)) {
    const error = new Error("Folder not found.");
    error.status = 400;
    throw error;
  }
  return cleanId;
}
