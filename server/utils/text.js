export function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("hr-HR")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
}

export function slugify(value) {
  return (
    String(value || "story")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("hr-HR")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "story"
  );
}

export function asCleanString(value) {
  return String(value || "").trim();
}
