import { encode } from "uqr";

/** Cameras find a QR code by the light margin around it, which the standard asks to be four modules wide. */
const QUIET_ZONE_MODULES = 4;

/** Text as a QR code for a phone's camera, black on white whatever the theme. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { border: QUIET_ZONE_MODULES });
  const darkModules = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
  return (
    <svg className="qr-code" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={darkModules} fill="#000000" />
    </svg>
  );
}
