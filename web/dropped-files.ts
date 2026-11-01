import { useRef, useState, type Dispatch, type DragEvent, type RefObject, type SetStateAction } from "react";
import { refusalText } from "./host-error.ts";
import { insertAtCaret } from "./insert-at-caret.ts";

const isImage = (file: File) => file.type.startsWith("image/");

/**
 * What a drop carries besides images: files to copy, and folders, which can't be. Read while the drop is handled: its
 * items are gone after that.
 */
export function nonImagesDropped(transfer: DataTransfer): { files: File[]; folders: string[] } {
  const dropped = [...transfer.items].filter(({ kind }) => kind === "file").map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }));
  return {
    files: dropped.flatMap(({ entry, file }) => (file && !entry?.isDirectory && !isImage(file) ? [file] : [])),
    folders: dropped.flatMap(({ entry }) => (entry?.isDirectory ? [entry.name] : [])),
  };
}

/** Numbered, so that two files of the same name each get their own path. */
export const copyingPlaceholder = (number: number, name: string) => `[Copying #${number}: ${name}…]`;

/** A path with a space in it goes in quotes, so that it reads as one path. */
export const pathToInsert = (path: string) => (/\s/.test(path) ? `"${path}"` : path);

/** A function as the replacement, since a replacement string reads `$&` and `$$` in a file's name as patterns. */
export const withPathOfCopy = (text: string, placeholder: string, path: string) => text.replace(placeholder, () => pathToInsert(path));

const withoutPlaceholder = (text: string, placeholder: string) => text.replace(`${placeholder} `, "").replace(placeholder, "");

/** The host keeps a copy, since the browser gives the file's contents but never its path, and answers where it is. */
async function copyToHost(conversationId: string, file: File): Promise<string> {
  const response = await fetch(`/conversations/${conversationId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });
  if (!response.ok) throw new Error(await refusalText(response, String(response.status)));
  return ((await response.json()) as { path: string }).path;
}

/**
 * Files other than images dropped into the message box go in as the path of a copy on the host, as a terminal puts in
 * a dropped file's path: a placeholder at the caret while the file is copied, then the path in its place.
 */
export function useDroppedFiles(conversationId: string, setText: Dispatch<SetStateAction<string>>, textarea: RefObject<HTMLTextAreaElement | null>) {
  const [copyingCount, setCopyingCount] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const filesDropped = useRef(0);

  const copy = async (file: File, placeholder: string) => {
    try {
      const path = await copyToHost(conversationId, file);
      setText((current) => withPathOfCopy(current, placeholder, path));
    } catch (error) {
      setText((current) => withoutPlaceholder(current, placeholder));
      setProblem(`Could not copy ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCopyingCount((count) => count - 1);
    }
  };

  return {
    copying: copyingCount > 0,
    problem,
    onDrop(event: DragEvent) {
      const { files, folders } = nonImagesDropped(event.dataTransfer);
      setProblem(folders.length > 0 ? `Folders can't go into a message: ${folders.join(", ")}.` : null);
      if (files.length === 0) return;
      const copies = files.map((file) => ({ file, placeholder: copyingPlaceholder(++filesDropped.current, file.name) }));
      insertAtCaret(textarea.current, setText, copies.map(({ placeholder }) => `${placeholder} `).join(""));
      setCopyingCount((count) => count + copies.length);
      copies.forEach(({ file, placeholder }) => void copy(file, placeholder));
    },
  };
}
