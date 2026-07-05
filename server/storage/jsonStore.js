import { promises as fs } from "node:fs";
import path from "node:path";

export async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonSafe(filePath, fallback);
  }
}

export async function readJson(filePath, fallback) {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    if (!contents.trim()) return structuredClone(fallback);
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}

export async function writeJsonSafe(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}
