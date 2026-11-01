import type { CSSProperties } from "react";
import type { Pastel } from "../shared/model.ts";
import { hues, pastelShades, type Hsl } from "../shared/pastels.ts";
export { hues, pastels, pastelShades, type Hsl } from "../shared/pastels.ts";

const cssOf = ({ hue, saturation, lightness }: Hsl) => `hsl(${hue} ${saturation}% ${lightness}%)`;
const lightDark = ({ light, dark }: { light: Hsl; dark: Hsl }) => `light-dark(${cssOf(light)}, ${cssOf(dark)})`;

export function pastelVariables(color: Pastel) {
  const { tint, stripe } = pastelShades(color);
  return { "--pastel-tint": lightDark(tint), "--pastel-stripe": lightDark(stripe) } as CSSProperties;
}

/** A profile's colour, under a name of its own so it holds inside a workspace card coloured by the pastel variables. */
export function profileColorVariable(color: Pastel) {
  return { "--profile-color": lightDark(pastelShades(color).stripe) } as CSSProperties;
}
