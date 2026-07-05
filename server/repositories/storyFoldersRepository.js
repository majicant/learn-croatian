import { storyFoldersFile } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";
import { slugify } from "../utils/text.js";

const emptyFoldersState = { folders: [] };
const defaultFolderName = "New folder";

function cleanFolderId(value) {
  return String(value || "").trim();
}

function assertFolderId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    const error = new Error("Invalid folder id.");
    error.status = 400;
    throw error;
  }
}

function normalizeFoldersState(state) {
  return {
    folders: Array.isArray(state?.folders)
      ? state.folders
          .filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
          .map((folder) => ({
            id: folder.id,
            name: folder.name
          }))
      : []
  };
}

async function readFoldersState() {
  return normalizeFoldersState(await readJson(storyFoldersFile, emptyFoldersState));
}

function cleanFolderName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function assertUniqueFolderName(folders, name, ignoredFolderId = "") {
  const normalizedName = name.toLocaleLowerCase("hr-HR");
  if (
    folders.some(
      (folder) => folder.id !== ignoredFolderId && folder.name.toLocaleLowerCase("hr-HR") === normalizedName
    )
  ) {
    const error = new Error("A folder with that name already exists.");
    error.status = 409;
    throw error;
  }
}

function nextFolderName(folders) {
  const takenNames = new Set(folders.map((folder) => folder.name.toLocaleLowerCase("hr-HR")));
  if (!takenNames.has(defaultFolderName.toLocaleLowerCase("hr-HR"))) return defaultFolderName;

  let index = 2;
  while (takenNames.has(`${defaultFolderName} ${index}`.toLocaleLowerCase("hr-HR"))) {
    index += 1;
  }
  return `${defaultFolderName} ${index}`;
}

export async function listStoryFolders() {
  return (await readFoldersState()).folders;
}

export async function createStoryFolder(name) {
  const state = await readFoldersState();
  const cleanName = cleanFolderName(name) || nextFolderName(state.folders);
  assertUniqueFolderName(state.folders, cleanName);

  const base = slugify(cleanName);
  let candidate = base;
  let index = 1;
  while (state.folders.some((folder) => folder.id === candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }

  const folder = {
    id: candidate,
    name: cleanName
  };
  state.folders.push(folder);
  await writeJsonSafe(storyFoldersFile, state);
  return folder;
}

export async function renameStoryFolder(id, name) {
  assertFolderId(id);
  const cleanName = cleanFolderName(name);
  if (!cleanName) {
    const error = new Error("Folder name is required.");
    error.status = 400;
    throw error;
  }

  const state = await readFoldersState();
  const folder = state.folders.find((item) => item.id === id);
  if (!folder) {
    const error = new Error("Folder not found.");
    error.status = 404;
    throw error;
  }

  assertUniqueFolderName(state.folders, cleanName, id);
  folder.name = cleanName;
  await writeJsonSafe(storyFoldersFile, state);
  return folder;
}

export async function deleteStoryFolder(id) {
  assertFolderId(id);
  const state = await readFoldersState();
  const folder = state.folders.find((item) => item.id === id);
  if (!folder) {
    const error = new Error("Folder not found.");
    error.status = 404;
    throw error;
  }

  state.folders = state.folders.filter((item) => item.id !== id);
  await writeJsonSafe(storyFoldersFile, state);
  return folder;
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
