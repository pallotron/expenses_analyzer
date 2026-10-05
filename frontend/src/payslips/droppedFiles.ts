/**
 * What a drop holds, folders included. `dataTransfer.files` lists a dropped
 * folder as one entry that is not a PDF, so the folder is walked through its
 * file system entries instead. Takes entries rather than an event so tests
 * can pass fakes: jsdom has no `webkitGetAsEntry`.
 */

const isPdf = (name: string) => name.toLowerCase().endsWith(".pdf");

/**
 * The entry of each dropped file or folder, or null when the browser offers
 * none (then `dataTransfer.files` is all there is). Call it inside the drop
 * handler: the items are emptied once the event is over.
 */
export function entriesOf(dt: DataTransfer): FileSystemEntry[] | null {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  if (items.length === 0 || items.some((i) => typeof i.webkitGetAsEntry !== "function")) return null;
  const entries = items.map((i) => i.webkitGetAsEntry());
  return entries.every((e) => e !== null) ? (entries as FileSystemEntry[]) : null;
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((ok, fail) => entry.file(ok, fail));

/** A directory's children. readEntries answers in batches; an empty one means done. */
async function childrenOf(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function pdfsIn(dir: FileSystemDirectoryEntry): Promise<File[]> {
  const found: File[] = [];
  for (const child of await childrenOf(dir)) {
    if (child.isDirectory) found.push(...(await pdfsIn(child as FileSystemDirectoryEntry)));
    else if (child.isFile && isPdf(child.name)) found.push(await fileOf(child as FileSystemFileEntry));
  }
  return found;
}

/** Dropped files as they are, and every PDF inside dropped folders, however deep. */
export async function filesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) files.push(...(await pdfsIn(entry as FileSystemDirectoryEntry)));
    else if (entry.isFile) files.push(await fileOf(entry as FileSystemFileEntry));
  }
  return files;
}
