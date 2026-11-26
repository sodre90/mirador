const lineIconShapes = {
  history: (
    <>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.7" />
      <path d="M2.5 2.75v2.95h2.95" />
      <path d="M8 5v3l2 1.25" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4h11" />
      <path d="M12.5 4v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 13V4" />
      <path d="M5.75 4V2.75a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1V4" />
    </>
  ),
  trashMany: (
    <>
      {/* The can in front hides what is behind it: a fixed id, as every copy of this mask is the same. */}
      <mask id="line-icon-trash-behind">
        <rect width="16" height="16" fill="white" stroke="none" />
        <path d="M0.4 5.4h10.2v10.2H0.4zM3.2 3.8h3.8v1.6H3.2z" fill="black" stroke="none" />
      </mask>
      <g mask="url(#line-icon-trash-behind)">
        <path d="M6.5 2.5h8" />
        <path d="M13.75 2.5v6.75a1.25 1.25 0 0 1-1.25 1.25h-4a1.25 1.25 0 0 1-1.25-1.25V2.5" />
        <path d="M9.25 2.5v-.9a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 .75.75v.9" />
      </g>
      <path d="M1.5 6.5h8" />
      <path d="M8.75 6.5v6.75a1.25 1.25 0 0 1-1.25 1.25h-4a1.25 1.25 0 0 1-1.25-1.25V6.5" />
      <path d="M4.25 6.5v-.9a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 .75.75v.9" />
    </>
  ),
  trashBelow: (
    <>
      <path d="M2.5 4h11" />
      <path d="M12.5 4v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 13V4" />
      <path d="M5.75 4V2.75a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1V4" />
      <path d="M8 6.5v5M6.25 9.75 8 11.5l1.75-1.75" />
    </>
  ),
  star: <path d="M8 2l1.53 4.4 4.65.09-3.71 2.81 1.35 4.46L8 11.1l-3.82 2.66 1.35-4.46-3.71-2.81 4.65-.09z" />,
  bell: (
    <>
      <path d="M3.5 11.5h9l-1-1.5V7a3.5 3.5 0 0 0-7 0v3z" />
      <path d="M6.75 13.5a1.4 1.4 0 0 0 2.5 0" />
    </>
  ),
  bellOff: (
    <>
      <path d="M3.5 11.5h9l-1-1.5V7a3.5 3.5 0 0 0-7 0v3z" />
      <path d="M6.75 13.5a1.4 1.4 0 0 0 2.5 0" />
      <path d="M2 2l12 12" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 4.5 8 8.75l5.5-4.25" />
    </>
  ),
  mailOpen: (
    <>
      <path d="M2 6.5 8 2.5l6 4v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
      <path d="M2.5 7 8 10.5 13.5 7" />
    </>
  ),
  fork: (
    <>
      <circle cx="8" cy="12" r="2" />
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="4" r="2" />
      <path d="M12 6v1.25a.75.75 0 0 1-.75.75h-6.5A.75.75 0 0 1 4 7.25V6" />
      <path d="M8 8v2" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.5 4.5h6M12 4.5h1.5" />
      <circle cx="10.5" cy="4.5" r="1.5" />
      <path d="M2.5 11.5h1.5M7 11.5h6.5" />
      <circle cx="5.5" cy="11.5" r="1.5" />
    </>
  ),
  open: (
    <>
      <path d="M6.5 3.5H3.5A1 1 0 0 0 2.5 4.5v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 7.5 8.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M2.5 13.5l3.6-.9 7.4-7.4a1.6 1.6 0 0 0-2.2-2.2L3.9 10.4z" />
      <path d="M10.3 4 12 5.7" />
    </>
  ),
  shield: <path d="M8 1.75 3 3.75v4c0 3 2.2 5.2 5 6.5 2.8-1.3 5-3.5 5-6.5v-4z" />,
  eyeOff: (
    <>
      <path d="M2 8s2.25-4.5 6-4.5S14 8 14 8s-2.25 4.5-6 4.5S2 8 2 8z" />
      <circle cx="8" cy="8" r="1.75" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
};

export type LineIconShape = keyof typeof lineIconShapes;

/** An outline icon on the 16-unit grid the sidebar's foot draws in, coloured by the text around it. */
export function LineIcon({ shape }: { shape: LineIconShape }) {
  return (
    <svg className="line-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {lineIconShapes[shape]}
    </svg>
  );
}
