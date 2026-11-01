import type { Pastel } from "../shared/model.ts";
import { t } from "./i18n/index.ts";
import { pastels, pastelVariables } from "./pastels.ts";

/** The pastels a workspace, a machine or a profile can take, and No colour; the one chosen takes the focus unless the swatches sit in a form. */
export function ColorSwatches({
  label,
  chosen,
  onChoose,
  focusChosen = true,
}: {
  label: string;
  chosen: Pastel | null;
  onChoose: (color: Pastel | null) => void;
  focusChosen?: boolean;
}) {
  return (
    <div className="color-swatches" role="radiogroup" aria-label={label}>
      {[null, ...pastels].map((color) => (
        <button
          key={color ?? "none"}
          type="button"
          role="radio"
          aria-checked={chosen === color}
          aria-label={color ? t.labels.pastel[color] : t.labels.noColour}
          className={color ? "swatch" : "swatch no-color"}
          style={color ? pastelVariables(color) : undefined}
          autoFocus={focusChosen && chosen === color}
          onClick={() => onChoose(color)}
        />
      ))}
    </div>
  );
}
