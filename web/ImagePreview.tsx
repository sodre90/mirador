import { useEffect, useState } from "react";
import { t } from "./i18n/index.ts";
import { useClosesAsDialog } from "./desktop-close.ts";

/** The image at full size over the page; a click anywhere or Esc closes it. */
function ImagePreview({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);
  useClosesAsDialog(() => {
    onClose();
    return true;
  });
  return (
    <div className="modal-backdrop image-preview" role="dialog" aria-label={t.canvas.imagePreview} onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

export function useImagePreview() {
  const [src, setSrc] = useState<string | null>(null);
  const preview = src && <ImagePreview src={src} onClose={() => setSrc(null)} />;
  return [preview, setSrc] as const;
}
