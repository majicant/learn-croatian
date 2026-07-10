export function cleanFolderId(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

export function assertFolderId(id) {
  const cleanId = cleanFolderId(id);
  if (id !== cleanId || (cleanId && !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(cleanId))) {
    const error = new Error("Invalid folder id.");
    error.status = 400;
    throw error;
  }
}

export function parentFolderId(folderId) {
  const cleanId = cleanFolderId(folderId);
  if (!cleanId.includes("/")) return "";
  return cleanId.slice(0, cleanId.lastIndexOf("/"));
}

export function folderSegment(folderId) {
  const cleanId = cleanFolderId(folderId);
  return cleanId.split("/").filter(Boolean).pop() || "";
}

export function joinFolderId(parentId, segment) {
  const cleanParentId = cleanFolderId(parentId);
  const cleanSegment = cleanFolderId(segment);
  const id = cleanParentId ? `${cleanParentId}/${cleanSegment}` : cleanSegment;
  assertFolderId(id);
  return id;
}

export function isSameOrDescendantFolder(folderId, ancestorId) {
  const cleanFolderIdValue = cleanFolderId(folderId);
  const cleanAncestorId = cleanFolderId(ancestorId);
  return Boolean(
    cleanAncestorId &&
      (cleanFolderIdValue === cleanAncestorId || cleanFolderIdValue.startsWith(`${cleanAncestorId}/`))
  );
}

export function replaceFolderPrefix(folderId, oldFolderId, newFolderId) {
  const cleanFolderIdValue = cleanFolderId(folderId);
  const cleanOldFolderId = cleanFolderId(oldFolderId);
  const cleanNewFolderId = cleanFolderId(newFolderId);

  if (!cleanOldFolderId) return cleanFolderIdValue;
  if (cleanFolderIdValue === cleanOldFolderId) return cleanNewFolderId;
  if (!cleanFolderIdValue.startsWith(`${cleanOldFolderId}/`)) return cleanFolderIdValue;

  const suffix = cleanFolderIdValue.slice(cleanOldFolderId.length);
  return `${cleanNewFolderId}${suffix}`.replace(/^\/+|\/+$/g, "");
}
