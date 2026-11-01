import { useRef, useState, type ClipboardEvent, type Dispatch, type DragEvent, type RefObject, type SetStateAction } from "react";
import type { ImageContent } from "@agentclientprotocol/sdk";
import { carriedImageSource, imageUrl } from "../shared/images.ts";
import { useDraftAttachments } from "./drafts.ts";
import { useImagePreview } from "./ImagePreview.tsx";
import { insertAtCaret } from "./insert-at-caret.ts";
import {
  discardImages,
  imageFilesIn,
  imagesToPaste,
  nextNumber,
  placeholder,
  referencedAttachments,
  restoredDraft,
  uploadImage,
  withoutPlaceholder,
  type Attachment,
} from "./pasted-images.ts";
import { t } from "./i18n/index.ts";

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

/** Images pasted or dropped into the message box: each goes in as `[Image #n]` at the caret, as in Claude Code. */
export function useComposerImages(
  conversationId: string,
  text: string,
  setText: Dispatch<SetStateAction<string>>,
  textarea: RefObject<HTMLTextAreaElement | null>,
) {
  const [attachments, setAttachments] = useDraftAttachments(conversationId);
  const latest = useRef(attachments);
  latest.current = attachments;
  const uploading = useRef(new Set<number>());
  const [uploadingNumbers, setUploadingNumbers] = useState<number[]>([]);
  const showUploads = () => setUploadingNumbers([...uploading.current].sort((a, b) => a - b));
  const [problem, setProblem] = useState<string | null>(null);

  const reserveNumber = () => {
    const number = nextNumber([...latest.current.map(({ number }) => number), ...uploading.current]);
    uploading.current.add(number);
    return number;
  };

  const upload = async (file: File, number: number) => {
    try {
      const imageId = await uploadImage(conversationId, file);
      latest.current = [...latest.current, { number, imageId }];
      setAttachments(latest.current);
    } catch (error) {
      setText((current) => withoutPlaceholder(current, number));
      setProblem(t.chat.images.couldNotAttach(file.name || t.chat.images.theImage, error instanceof Error ? error.message : String(error)));
    } finally {
      uploading.current.delete(number);
      showUploads();
    }
  };

  const attach = (files: File[]) => {
    setProblem(null);
    const pasted = files.map((file) => ({ file, number: reserveNumber() }));
    showUploads();
    insertAtCaret(textarea.current, setText, pasted.map(({ number }) => `${placeholder(number)} `).join(""));
    pasted.forEach(({ file, number }) => void upload(file, number));
  };

  return {
    attachments,
    referenced: referencedAttachments(text, attachments),
    uploadingNumbers,
    uploading: uploadingNumbers.length > 0,
    problem,
    onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
      const images = imagesToPaste(event.clipboardData.getData("text/plain"), imageFilesIn(event.clipboardData));
      if (images.length === 0) return;
      event.preventDefault();
      attach(images);
    },
    onDragOver(event: DragEvent) {
      if (carriesFiles(event)) event.preventDefault();
    },
    onDrop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      const images = imageFilesIn(event.dataTransfer);
      if (images.length > 0) attach(images);
    },
    detach(attachment: Attachment) {
      setText((current) => withoutPlaceholder(current, attachment.number));
      setAttachments((current) => current.filter(({ imageId }) => imageId !== attachment.imageId));
      discardImages(conversationId, [attachment]);
    },
    restore(queuedText: string, imageIds: string[]) {
      const restored = restoredDraft(queuedText, imageIds, latest.current);
      latest.current = [...latest.current, ...restored.attachments];
      setAttachments(latest.current);
      return restored.text;
    },
    replace(replacements: Attachment[]) {
      latest.current = replacements;
      setAttachments(replacements);
    },
    /** The message went out: images pasted but left out of it go. */
    clearAfterSending() {
      const sent = referencedAttachments(text, latest.current);
      discardImages(conversationId, latest.current.filter((attachment) => !sent.includes(attachment)));
      setProblem(null);
      setAttachments([]);
    },
  };
}

export function PastedImages({
  conversationId,
  attachments,
  uploadingNumbers,
  onRemove,
}: {
  conversationId: string;
  attachments: Attachment[];
  uploadingNumbers: number[];
  onRemove: (attachment: Attachment) => void;
}) {
  const [preview, open] = useImagePreview();
  if (attachments.length === 0 && uploadingNumbers.length === 0) return null;
  return (
    <>
      <ul className="pasted-images" aria-label={t.chat.images.pasted}>
      {attachments.map((attachment) => (
        <li key={attachment.imageId}>
          <button type="button" className="thumbnail" aria-label={t.chat.images.show(attachment.number)} onClick={() => open(imageUrl(conversationId, attachment.imageId))}>
            <img src={imageUrl(conversationId, attachment.imageId)} alt="" />
          </button>
          <span className="pasted-image-label">{placeholder(attachment.number)}</span>
          <button type="button" className="icon" aria-label={t.chat.images.remove(attachment.number)} onClick={() => onRemove(attachment)}>
            ✕
          </button>
        </li>
      ))}
      {uploadingNumbers.map((number) => (
        <li key={`uploading-${number}`} className="uploading">
          <span className="upload-spinner" aria-hidden="true" />
          <span className="pasted-image-label">{placeholder(number)}</span>
          {t.chat.images.uploading}
        </li>
      ))}
      </ul>
      {preview}
    </>
  );
}

/** Pasted images, by their id, and images the agent's updates carried. */
export function MessageImages({ conversationId, imageIds = [], carried = [] }: { conversationId: string; imageIds?: string[]; carried?: ImageContent[] }) {
  const [preview, open] = useImagePreview();
  const sources = [...imageIds.map((imageId) => imageUrl(conversationId, imageId)), ...carried.flatMap((image) => carriedImageSource(image) ?? [])];
  if (sources.length === 0) return null;
  return (
    <div className="message-images">
      {sources.map((source, index) => (
        <button key={index} type="button" className="thumbnail" aria-label={`Show image ${index + 1}`} onClick={() => open(source)}>
          <img src={source} alt="" />
        </button>
      ))}
      {preview}
    </div>
  );
}
