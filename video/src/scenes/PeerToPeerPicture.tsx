import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ACCENTS, BRAND, FONT, MONO } from "../brand.ts";

const clamped = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeInOut = Easing.bezier(0.45, 0, 0.2, 1);

/** When each beat of the chapter happens, in its seconds. */
const BEATS = {
  computersIn: 0.05,
  inviteOpened: 0.5,
  copied: 1.15,
  linkFlies: 1.3,
  linkLands: 2.1,
  added: 2.35,
  tunnelDrawn: 2.45,
  tunnelEnds: 3.05,
  machineAppears: 2.85,
  joined: 3.15,
  chips: 4.6,
};

/** The drawing is laid out in units of its own and zoomed to fill the frame, so it rasterises at full size. */
const ZOOM = 1.15;
const LAYOUT = { width: 3840 / ZOOM, height: 2160 / ZOOM };
const SCREEN = { width: 1240, height: 800, top: 380 };
const STUDIO_X = 176;
const LAPTOP_X = 1904;
const TITLE_BAR = 60;
const PANEL = "#17161f";
const CARD = "#1f1e2a";
const LINE = "#34324a";
const MUTED = "#a9a6c9";
const GREEN = "#34d399";
const INVITE_LINK = "mirador://join/9ZEX-4XBV-5PMW";

/** The tunnel's curve between the two screens, and a point a fraction of the way along it. */
const TUNNEL = { from: { x: STUDIO_X + SCREEN.width, y: SCREEN.top + 400 }, bend: { x: (STUDIO_X + SCREEN.width + LAPTOP_X - 18) / 2, y: SCREEN.top + 250 }, to: { x: LAPTOP_X - 18, y: SCREEN.top + 400 } };
function alongTunnel(t: number) {
  const { from, bend, to } = TUNNEL;
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * bend.x + t * t * to.x, y: u * u * from.y + 2 * u * t * bend.y + t * t * to.y };
}

function useSeconds() {
  const { fps } = useVideoConfig();
  return useCurrentFrame() / fps;
}

function springAt(seconds: number, at: number, fps: number, config = { damping: 16, mass: 0.7 }) {
  return spring({ frame: (seconds - at) * fps, fps, config });
}

const SHOP_API = { name: "shop-api", colour: "#4f8cff", conversations: ["Explain the checkout", "Stop the double charge", "Review: retry card payments"] };
const MOBILE_APP = { name: "mobile-app", colour: "#2dd4bf", conversations: ["Design car mode", "Delete the three dead flags"] };
const STOREFRONT = { name: "storefront", colour: "#a78bfa", conversations: ["Tighten the checkout copy"] };
const WORKSPACES = [SHOP_API, MOBILE_APP, STOREFRONT];

function WindowFrame({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div style={{ width: SCREEN.width, height: SCREEN.height, borderRadius: 22, overflow: "hidden", background: PANEL, border: `2px solid ${accent}55`, boxShadow: `0 40px 120px rgba(0,0,0,0.6), 0 0 90px ${accent}26` }}>
      <div style={{ height: TITLE_BAR, display: "flex", alignItems: "center", gap: 14, padding: "0 24px", background: "#121119", borderBottom: `1px solid ${LINE}` }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((colour) => (
          <span key={colour} style={{ width: 20, height: 20, borderRadius: "50%", background: colour }} />
        ))}
        <span style={{ marginLeft: 18, fontSize: 26, fontWeight: 600, color: MUTED }}>{title}</span>
      </div>
      <div style={{ position: "relative", height: SCREEN.height - TITLE_BAR }}>{children}</div>
    </div>
  );
}

/** A desktop: the window on a monitor's stand. */
function Desktop({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {children}
      <div style={{ width: 150, height: 110, background: "linear-gradient(180deg, #2b2a36, #1c1b25)" }} />
      <div style={{ width: 440, height: 26, borderRadius: "14px 14px 6px 6px", background: "linear-gradient(180deg, #3a3948, #23222d)" }} />
    </div>
  );
}

/** A laptop: the window above its keyboard deck. */
function Laptop({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ padding: 18, borderRadius: 34, background: "#0b0a11", border: "2px solid #2c2b38" }}>{children}</div>
      <div style={{ width: 1400, height: 34, borderRadius: "0 0 40px 40px", background: "linear-gradient(180deg, #3d3c4c, #22212c)", position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: 240, height: 12, marginLeft: -120, borderRadius: "0 0 12px 12px", background: "#191821" }} />
      </div>
    </div>
  );
}

function Button({ children, pressed = 0, style }: { children: ReactNode; pressed?: number; style?: CSSProperties }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 26px", borderRadius: 14, background: BRAND.violet, color: "#fff", fontWeight: 600, fontSize: 28, transform: `scale(${1 - 0.06 * pressed})`, ...style }}>
      {children}
    </span>
  );
}

function LinkIcon({ size, colour }: { size: number; colour: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={colour} strokeWidth={2.2} strokeLinecap="round">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </svg>
  );
}

function Lock({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="#fff" fillOpacity={0.12} />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

/** studio-mac's Settings → Devices: an invite for another computer, its link copied, then the laptop joining. */
function StudioMacScreen({ seconds, fps }: { seconds: number; fps: number }) {
  const opened = springAt(seconds, BEATS.inviteOpened, fps);
  const pressed = interpolate(seconds, [BEATS.inviteOpened - 0.15, BEATS.inviteOpened - 0.05, BEATS.inviteOpened + 0.08], [0, 1, 0], clamped);
  const copied = seconds >= BEATS.copied;
  const joined = springAt(seconds, BEATS.joined, fps);
  const inviteLeaves = interpolate(seconds, [BEATS.joined - 0.2, BEATS.joined], [0, 1], clamped);
  return (
    <WindowFrame title="Mirador · studio-mac" accent={BRAND.violet}>
      <div style={{ position: "absolute", inset: 0, display: "flex" }}>
        <div style={{ width: 250, borderRight: `1px solid ${LINE}`, padding: "24px 18px", opacity: 0.55 }}>
          {WORKSPACES.map((workspace) => (
            <div key={workspace.name} style={{ display: "flex", alignItems: "center", gap: 12, margin: "6px 0 26px", fontSize: 24, fontWeight: 600 }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: workspace.colour }} />
              {workspace.name}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "40px 48px", fontSize: 27, color: "#ecebf5" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 38, fontWeight: 700 }}>Devices</span>
            <Button pressed={pressed}>Invite a device</Button>
          </div>
          <div style={{ color: MUTED, margin: "14px 0 30px", lineHeight: 1.4 }}>Other computers and browsers that joined this Mirador with an invite.</div>
          <div style={{ position: "relative", height: 330 }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: Math.min(1, opened * 1.3) * (1 - inviteLeaves),
                transform: `translateY(${24 * (1 - opened)}px)`,
                border: `2px solid ${BRAND.violet}aa`,
                borderRadius: 18,
                background: CARD,
                padding: "28px 32px",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 30 }}>Paste in Machines on the other computer</div>
              <div style={{ margin: "20px 0 22px", padding: "16px 20px", borderRadius: 12, background: "#13121a", border: `1px solid ${LINE}`, font: `27px ${MONO}`, color: "#d9d6ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {INVITE_LINK}?tunnel=eyJob3N0IjoiazhhSzJk…
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "10px 22px", borderRadius: 12, border: `1px solid ${copied ? GREEN : LINE}`, color: copied ? GREEN : "#ecebf5", fontWeight: 600 }}>
                {copied ? "✓ Copied" : "Copy link"}
              </span>
            </div>
            <div style={{ position: "absolute", inset: 0, opacity: Math.min(1, joined * 1.3), transform: `translateY(${24 * (1 - joined)}px)` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "26px 30px", borderRadius: 18, border: `2px solid ${GREEN}`, background: "rgba(52, 211, 153, 0.08)", fontSize: 31, fontWeight: 700, color: GREEN }}>
                ✓ ada-laptop joined
                <span style={{ padding: "8px 20px", borderRadius: 12, border: `1px solid ${LINE}`, color: "#ecebf5", fontSize: 25, fontWeight: 600 }}>Done</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 22, padding: "22px 30px", borderRadius: 18, border: `1px solid ${LINE}`, fontSize: 27 }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: GREEN, boxShadow: `0 0 12px ${GREEN}` }} />
                <b>ada-laptop</b>
                <span style={{ color: MUTED }}>connected peer to peer · just now</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

function RailButton({ label, colour, shown, active }: { label: string; colour: string; shown: number; active?: boolean }) {
  return (
    <div style={{ position: "relative", width: 64, height: 64, margin: "18px auto 0", borderRadius: 18, background: colour, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 30, opacity: Math.min(1, shown * 1.4), transform: `scale(${0.6 + 0.4 * shown})`, boxShadow: active ? `0 0 0 4px ${PANEL}, 0 0 0 7px ${colour}, 0 0 30px ${colour}` : "none" }}>
      {label}
      {active && <span style={{ position: "absolute", right: -4, bottom: -4, width: 20, height: 20, borderRadius: "50%", background: GREEN, border: `4px solid ${PANEL}` }} />}
    </div>
  );
}

/** ada-laptop's Mirador: Machines takes the pasted link, then studio-mac's workspaces and conversations open on it. */
function AdaLaptopScreen({ seconds, fps }: { seconds: number; fps: number }) {
  const linkIn = seconds >= BEATS.linkLands;
  const addPressed = interpolate(seconds, [BEATS.added - 0.08, BEATS.added, BEATS.added + 0.12], [0, 1, 0], clamped);
  const dialogGone = interpolate(seconds, [BEATS.added + 0.15, BEATS.added + 0.45], [0, 1], clamped);
  const machine = springAt(seconds, BEATS.machineAppears, fps);
  return (
    <WindowFrame title="Mirador · ada-laptop" accent={GREEN}>
      <div style={{ position: "absolute", inset: 0, display: "flex" }}>
        <div style={{ width: 110, background: "#0f0e15", borderRight: `1px solid ${LINE}` }}>
          <RailButton label="A" colour="#3a3948" shown={1} />
          <RailButton label="S" colour={BRAND.violet} shown={machine} active={machine > 0.5} />
        </div>
        <div style={{ position: "relative", flex: 1 }}>
          <div style={{ position: "absolute", inset: 0, opacity: machine }}>
            <StudioMacOnTheLaptop seconds={seconds} fps={fps} />
          </div>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `rgba(9, 8, 18, ${0.55 * (1 - dialogGone)})`, opacity: 1 - dialogGone }}>
            <div style={{ width: 900, padding: "38px 44px", borderRadius: 22, background: CARD, border: `1px solid ${LINE}`, fontSize: 27, color: "#ecebf5", transform: `scale(${1 - 0.04 * dialogGone})` }}>
              <div style={{ fontSize: 38, fontWeight: 700 }}>Machines</div>
              <div style={{ color: MUTED, margin: "12px 0 28px", lineHeight: 1.4 }}>Other computers running Mirador, such as a server whose agents keep working while this one sleeps.</div>
              <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                <div style={{ flex: 1, padding: "16px 20px", borderRadius: 12, background: "#13121a", border: `2px solid ${linkIn ? BRAND.violet : LINE}`, font: `26px ${MONO}`, color: linkIn ? "#d9d6ff" : "#5d5a75", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {linkIn ? `${INVITE_LINK}?tunnel=…` : "Paste an invite link"}
                </div>
                <Button pressed={addPressed}>Add</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

/** studio-mac's sidebar and its checkout conversation, open on the laptop. */
function StudioMacOnTheLaptop({ seconds, fps }: { seconds: number; fps: number }) {
  const rows = WORKSPACES.flatMap((workspace) => [{ workspace, conversation: undefined as string | undefined }, ...workspace.conversations.map((conversation) => ({ workspace, conversation }))]);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", fontSize: 25, color: "#ecebf5" }}>
      <div style={{ width: 430, borderRight: `1px solid ${LINE}`, padding: "22px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, fontSize: 28, fontWeight: 700 }}>
          studio-mac
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 10, background: "rgba(52, 211, 153, 0.12)", color: GREEN, fontSize: 20, fontWeight: 600 }}>
            <Lock size={20} /> peer to peer
          </span>
        </div>
        {rows.map(({ workspace, conversation }, index) => {
          const shown = springAt(seconds, BEATS.machineAppears + 0.12 + index * 0.06, fps);
          const style: CSSProperties = { opacity: Math.min(1, shown * 1.3), transform: `translateX(${-26 * (1 - shown)}px)`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
          return conversation ? (
            <div key={`${workspace.name} ${conversation}`} style={{ ...style, padding: "9px 14px 9px 46px", borderRadius: 10, color: "#d6d3ea", background: index === 1 ? "rgba(118, 118, 242, 0.18)" : "transparent" }}>
              {conversation}
            </div>
          ) : (
            <div key={workspace.name} style={{ ...style, display: "flex", alignItems: "center", gap: 12, marginTop: index === 0 ? 0 : 14, padding: "8px 6px", fontWeight: 700 }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: workspace.colour }} />
              {workspace.name}
            </div>
          );
        })}
      </div>
      <Conversation seconds={seconds} fps={fps} />
    </div>
  );
}

function Conversation({ seconds, fps }: { seconds: number; fps: number }) {
  const turns = [
    { who: "You", colour: "#5b5a6e", text: "Walk me through checkout, end to end. Where can an order get stuck?" },
    { who: "Claude", colour: "#e07a5f", text: "Checkout touches four services in one request. I drew the full path on the canvas, with the three places an order can get stuck." },
  ];
  return (
    <div style={{ flex: 1, padding: "30px 36px" }}>
      {turns.map((turn, index) => {
        const shown = springAt(seconds, BEATS.machineAppears + 0.45 + index * 0.22, fps);
        return (
          <div key={turn.who} style={{ display: "flex", gap: 18, marginBottom: 30, opacity: Math.min(1, shown * 1.3), transform: `translateY(${20 * (1 - shown)}px)` }}>
            <span style={{ width: 44, height: 44, flex: "none", borderRadius: 12, background: turn.colour }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{turn.who}</div>
              <div style={{ color: "#d6d3ea", lineHeight: 1.45 }}>{turn.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The invite link, lifted off studio-mac and carried over to the laptop's Machines. */
function FlyingLink({ seconds }: { seconds: number }) {
  const progress = interpolate(seconds, [BEATS.linkFlies, BEATS.linkLands], [0, 1], { ...clamped, easing: easeInOut });
  if (seconds < BEATS.linkFlies - 0.05 || seconds > BEATS.linkLands + 0.12) return null;
  const from = { x: STUDIO_X + 640, y: SCREEN.top + 360 };
  const to = { x: LAPTOP_X + 610, y: SCREEN.top + 500 };
  const x = interpolate(progress, [0, 1], [from.x, to.x]);
  const y = interpolate(progress, [0, 1], [from.y, to.y]) - Math.sin(progress * Math.PI) * 300;
  const fading = interpolate(seconds, [BEATS.linkLands, BEATS.linkLands + 0.12], [1, 0], clamped);
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) rotate(${Math.sin(progress * Math.PI) * -4}deg) scale(${1 + 0.12 * Math.sin(progress * Math.PI)})`, opacity: fading }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 34px", borderRadius: 40, background: "#262440", border: `2px solid ${BRAND.violet}`, boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 60px ${BRAND.violet}88`, font: `600 36px ${MONO}`, color: "#e8e6ff", whiteSpace: "nowrap" }}>
        <LinkIcon size={40} colour="#c9c5ff" />
        {INVITE_LINK}
      </div>
    </div>
  );
}

/** The encrypted link drawn between the screens, its lock, and what travels along it both ways. */
function Tunnel({ seconds, fps }: { seconds: number; fps: number }) {
  const drawn = interpolate(seconds, [BEATS.tunnelDrawn, BEATS.tunnelEnds], [0, 1], { ...clamped, easing: easeInOut });
  if (drawn <= 0) return null;
  const { from, bend, to } = TUNNEL;
  const path = `M ${from.x} ${from.y} Q ${bend.x} ${bend.y} ${to.x} ${to.y}`;
  const lock = springAt(seconds, BEATS.tunnelEnds - 0.1, fps, { damping: 12, mass: 0.6 });
  const middle = alongTunnel(0.5);
  const flowing = seconds - BEATS.tunnelEnds;
  const packets =
    flowing > 0
      ? [0, 1, 2, 3, 4].flatMap((index) => {
          const ahead = (flowing * 0.7 + index / 5) % 1;
          return [
            { key: `out ${index}`, at: alongTunnel(ahead), colour: "#c9c5ff", fade: Math.sin(ahead * Math.PI) },
            { key: `back ${index}`, at: alongTunnel(1 - ((ahead + 0.1) % 1)), colour: GREEN, fade: Math.sin(((ahead + 0.1) % 1) * Math.PI) },
          ];
        })
      : [];
  return (
    <AbsoluteFill>
      <svg width={LAYOUT.width} height={LAYOUT.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id="tunnel" x1={from.x} x2={to.x} y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={BRAND.violet} />
            <stop offset="1" stopColor={GREEN} />
          </linearGradient>
          <filter id="glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        <path d={path} stroke="url(#tunnel)" strokeWidth={30} fill="none" opacity={0.35} filter="url(#glow)" pathLength={1} strokeDasharray={`${drawn} 1`} />
        <path d={path} stroke="url(#tunnel)" strokeWidth={9} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={`${drawn} 1`} />
        {packets.map(({ key, at, colour, fade }) => (
          <circle key={key} cx={at.x} cy={at.y} r={11} fill={colour} opacity={Math.min(1, fade * 1.6)} style={{ filter: `drop-shadow(0 0 10px ${colour})` }} />
        ))}
      </svg>
      <div style={{ position: "absolute", left: middle.x, top: middle.y, transform: `translate(-50%, -50%) scale(${lock})`, width: 128, height: 128, borderRadius: "50%", background: "linear-gradient(150deg, #8b7cf6, #3836a3)", border: "4px solid #fff3", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 70px ${BRAND.violet}` }}>
        <Lock size={64} />
      </div>
      <div style={{ position: "absolute", left: middle.x, top: middle.y + 104, transform: "translateX(-50%)", opacity: Math.min(1, lock * 1.3), font: `700 36px ${FONT}`, color: "#ecebf5", whiteSpace: "nowrap", textAlign: "center" }}>
        Encrypted end to end
      </div>
    </AbsoluteFill>
  );
}

const LABELS_TOP = SCREEN.top + SCREEN.height + 176;

function DeviceLabel({ name, detail, colour, centre }: { name: string; detail: string; colour: string; centre: number }) {
  return (
    <div style={{ position: "absolute", left: centre, top: LABELS_TOP, transform: "translateX(-50%)", textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontSize: 60, fontWeight: 800, color: BRAND.ink, letterSpacing: "-0.02em" }}>{name}</div>
      <div style={{ fontSize: 34, fontWeight: 600, color: colour, marginTop: 6 }}>{detail}</div>
    </div>
  );
}

function Chips({ seconds, fps }: { seconds: number; fps: number }) {
  const chips = ["No VPN", "Nothing to set up", "Works from most networks"];
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: LABELS_TOP + 170, display: "flex", justifyContent: "center", gap: 36, fontFamily: FONT }}>
      {chips.map((chip, index) => {
        const shown = springAt(seconds, BEATS.chips + index * 0.14, fps, { damping: 13, mass: 0.6 });
        return (
          <span key={chip} style={{ display: "inline-flex", alignItems: "center", gap: 16, padding: "20px 40px", borderRadius: 999, background: "rgba(23, 22, 31, 0.85)", border: `2px solid ${ACCENTS.violet}66`, color: BRAND.ink, fontSize: 44, fontWeight: 700, opacity: Math.min(1, shown * 1.4), transform: `translateY(${30 * (1 - shown)}px) scale(${0.85 + 0.15 * shown})` }}>
            <span style={{ color: GREEN }}>✓</span>
            {chip}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Chapter 10, drawn: studio-mac invites another computer, its link flies to ada-laptop's Machines, an encrypted tunnel
 * opens between them, and studio-mac's conversations open on the laptop. Laid out at the frame's own size, so it stays
 * sharp at 4K.
 */
export function PeerToPeerPicture() {
  const { fps } = useVideoConfig();
  const seconds = useSeconds();
  const studio = springAt(seconds, BEATS.computersIn, fps);
  const laptop = springAt(seconds, BEATS.computersIn + 0.12, fps);
  const pushIn = interpolate(seconds, [0, 7], [1, 1.03], clamped);
  return (
    <AbsoluteFill style={{ transform: `scale(${pushIn})` }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: LAYOUT.width, height: LAYOUT.height, zoom: ZOOM, fontFamily: FONT }}>
        <div style={{ position: "absolute", left: STUDIO_X, top: SCREEN.top, opacity: studio, transform: `translateX(${-80 * (1 - studio)}px)` }}>
          <Desktop>
            <StudioMacScreen seconds={seconds} fps={fps} />
          </Desktop>
        </div>
        <div style={{ position: "absolute", left: LAPTOP_X - 18, top: SCREEN.top - 18, opacity: laptop, transform: `translateX(${80 * (1 - laptop)}px)` }}>
          <Laptop>
            <AdaLaptopScreen seconds={seconds} fps={fps} />
          </Laptop>
        </div>
        <div style={{ opacity: studio }}>
          <DeviceLabel name="studio-mac" detail="invites" colour={ACCENTS.violet} centre={STUDIO_X + SCREEN.width / 2} />
        </div>
        <div style={{ opacity: laptop }}>
          <DeviceLabel name="ada-laptop" detail="pastes the link" colour={GREEN} centre={LAPTOP_X + SCREEN.width / 2} />
        </div>
        <Tunnel seconds={seconds} fps={fps} />
        <FlyingLink seconds={seconds} />
        <Chips seconds={seconds} fps={fps} />
      </div>
    </AbsoluteFill>
  );
}
