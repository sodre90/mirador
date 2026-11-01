type Rgb = [number, number, number];

/** The colours ansi.ts produces: `#rrggbb` or `rgb(r, g, b)`. */
function rgbOf(color: string): Rgb | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function relativeLuminance([red, green, blue]: Rgb) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

const ratioOf = (first: Rgb, second: Rgb) => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
};

/** WCAG's contrast ratio, from 1 to 21; null for a colour it cannot read. */
export function contrastRatio(foreground: string, background: string): number | null {
  const [front, back] = [rgbOf(foreground), rgbOf(background)];
  return front && back ? ratioOf(front, back) : null;
}

const mixed = (color: Rgb, toward: number, share: number): Rgb => color.map((channel) => Math.round(channel + (toward - channel) * share)) as Rgb;

/**
 * The colour, moved toward black on a light background (toward white on a dark one) just far enough to reach the
 * contrast, keeping its hue, the way terminals' minimum contrast setting does.
 */
export function readableOn(foreground: string, background: string, minimumRatio = 4.5): string {
  const [front, back] = [rgbOf(foreground), rgbOf(background)];
  if (!front || !back || ratioOf(front, back) >= minimumRatio) return foreground;
  const toward = relativeLuminance(back) > 0.5 ? 0 : 255;
  const steps = Array.from({ length: 20 }, (_, index) => mixed(front, toward, (index + 1) / 20));
  const [red, green, blue] = steps.find((step) => ratioOf(step, back) >= minimumRatio) ?? steps.at(-1)!;
  return `rgb(${red}, ${green}, ${blue})`;
}
