/** The three looks for car mode the agent asks about in the ask clip, each on an iPhone, which the trailer's opening also shows. */
export const CAR_MODE_CHOICE = "Whole screen is the button";

const MIC = (colour: string) => `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="9" y="3" width="6" height="11" rx="3" fill="${colour}"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="${colour}" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;

const STATUS_ICONS = `<span class="icons"><svg viewBox="0 0 18 12" width="12" height="8"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 16 12" width="11" height="8.5"><path d="M8 11.5 5.6 8.9a3.4 3.4 0 0 1 4.8 0zM3.6 6.9a6.2 6.2 0 0 1 8.8 0l-1.3 1.3a4.4 4.4 0 0 0-6.2 0zM1.3 4.6a9.5 9.5 0 0 1 13.4 0l-1.3 1.3a7.6 7.6 0 0 0-10.8 0z"/></svg><svg viewBox="0 0 26 12" width="19" height="9"><rect x="0.5" y="0.5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".45"/><rect x="2.5" y="2.5" width="16" height="7" rx="1.8"/><rect x="23.8" y="4" width="1.7" height="4" rx=".8" opacity=".45"/></svg></span>`;

const iPhone = (screen: string, { background, ink }: { background: string; ink: string }) => `<style>
  body { margin: 0; padding: 8px 6px 12px; background: transparent; font: 11px -apple-system, "SF Pro Text", system-ui, sans-serif; }
  .iphone { position: relative; width: 158px; height: 336px; margin: 0 auto; padding: 4px; box-sizing: border-box; border-radius: 34px; background: linear-gradient(150deg, #9a9ca3 0%, #46474d 16%, #1d1e22 50%, #46474d 84%, #9a9ca3 100%); box-shadow: 0 16px 30px rgba(0, 0, 0, 0.5), 0 2px 5px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.22); }
  .button { position: absolute; width: 3px; border-radius: 2px; background: linear-gradient(90deg, #6b6d73, #2d2e33); }
  .bezel { height: 100%; padding: 3px; box-sizing: border-box; border-radius: 30px; background: #000; }
  .screen { position: relative; height: 100%; border-radius: 27px; overflow: hidden; background: ${background}; color: ${ink}; }
  .island { position: absolute; z-index: 3; top: 8px; left: 50%; width: 40px; height: 13px; margin-left: -20px; border-radius: 8px; background: #000; }
  .status { position: absolute; z-index: 2; top: 0; left: 0; right: 0; height: 30px; display: flex; align-items: center; justify-content: space-between; padding: 0 9px 0 20px; font-weight: 600; font-size: 10.5px; color: ${ink}; }
  .icons { display: flex; gap: 2px; align-items: center; fill: currentColor; }
  .home { position: absolute; z-index: 2; bottom: 6px; left: 50%; width: 54px; height: 4px; margin-left: -27px; border-radius: 2px; background: ${ink}; opacity: 0.85; }
  .top { position: absolute; top: 34px; left: 12px; right: 12px; display: flex; align-items: center; gap: 6px; }
  .title { flex: 1; font-size: 9px; font-weight: 600; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .leave { padding: 3px 9px; border-radius: 10px; font-size: 9px; font-weight: 600; }
</style><div class="iphone"><span class="button" style="left:-2px;top:62px;height:14px"></span><span class="button" style="left:-2px;top:88px;height:26px"></span><span class="button" style="left:-2px;top:120px;height:26px"></span><span class="button" style="right:-2px;top:98px;height:42px"></span><div class="bezel"><div class="screen"><div class="island"></div><div class="status"><span>9:41</span>${STATUS_ICONS}</div>${screen}<div class="home"></div></div></div></div>`;

const STATE_CHIPS = [
  ["Listening", "rgba(255,255,255,0.28)"],
  ["Working", "#f59e0b"],
  ["Speaking", "#22c55e"],
  ["Approve", "#ef4444"],
]
  .map(([state, colour]) => `<span style="padding:2px 3.5px;border-radius:5px;background:${colour}">${state}</span>`)
  .join("");

const wholeScreenButton = iPhone(
  `<div class="top"><span class="title">Fix the login bug</span><span class="leave" style="background:rgba(255,255,255,0.2);color:#fff">Leave</span></div>
  <div style="position:absolute;top:92px;left:0;right:0;display:flex;justify-content:center"><div style="position:relative;width:110px;height:110px;display:flex;align-items:center;justify-content:center">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(255,255,255,0.08)"></div><div style="position:absolute;inset:16px;border-radius:50%;background:rgba(255,255,255,0.13)"></div>
    <div style="position:relative;width:54px;height:54px;border-radius:50%;background:#fff;box-shadow:0 8px 24px rgba(15,23,80,0.45);padding:13px;box-sizing:border-box">${MIC("#1d4ed8")}</div></div></div>
  <div style="position:absolute;top:214px;left:0;right:0;text-align:center"><div style="font-size:24px;font-weight:800;letter-spacing:-0.02em">Listening…</div><div style="font-size:8.5px;opacity:0.8;margin-top:4px">Tap anywhere when you're done</div></div>
  <div style="position:absolute;bottom:20px;left:0;right:0;display:flex;gap:2px;justify-content:center;font-size:6px;font-weight:600">${STATE_CHIPS}</div>`,
  { background: "radial-gradient(130% 85% at 50% 42%, #4f8cff 0%, #1d4ed8 48%, #172f7a 100%)", ink: "#fff" },
);

const darkForNight = iPhone(
  `<div class="top" style="justify-content:flex-end"><span class="leave" style="background:#1c1c1e;color:#8e8e93">Leave</span></div>
  <div style="position:absolute;top:86px;left:0;right:0;display:flex;justify-content:center"><div style="position:relative;width:122px;height:122px;display:flex;align-items:center;justify-content:center">
    <div style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(96,165,250,0.18)"></div>
    <div style="position:absolute;inset:12px;border-radius:50%;border:4px solid #60a5fa;box-shadow:0 0 22px #3b82f6, 0 0 60px rgba(59,130,246,0.35), inset 0 0 20px rgba(30,64,175,0.9)"></div>
    <span style="position:relative;font-size:13px;font-weight:600;color:#bfdbfe;letter-spacing:0.02em">Listening</span></div></div>
  <div style="position:absolute;top:226px;left:0;right:0;text-align:center;font-size:9px;color:#5b6b8c">Say "stop" when you're done</div>
  <div style="position:absolute;bottom:22px;left:0;right:0;text-align:center;font-size:8px;color:#3a3a3c">Fix the login bug</div>`,
  { background: "radial-gradient(90% 60% at 50% 42%, #0b1428 0%, #000 70%)", ink: "#fff" },
);

const WAVEFORM = [6, 13, 18, 10, 15, 8, 5]
  .map((height) => `<span style="width:2.5px;height:${height}px;border-radius:2px;background:#007aff"></span>`)
  .join("");

const wordsOnScreen = iPhone(
  `<div class="top"><span class="title" style="color:#3a3a3c">Fix the login bug</span><span class="leave" style="background:#fff;color:#007aff;box-shadow:0 1px 2px rgba(0,0,0,0.08)">Leave</span></div>
  <div style="position:absolute;top:64px;left:10px;right:10px">
    <div style="font-size:7px;font-weight:700;letter-spacing:0.08em;color:#8e8e93;text-align:right;margin:0 2px 3px">YOU SAID</div>
    <div style="margin-left:18px;padding:7px 9px;border-radius:13px 13px 3px 13px;background:#007aff;color:#fff;font-size:11px;font-weight:600;line-height:1.3">Run the tests again and tell me which ones fail</div>
    <div style="font-size:7px;font-weight:700;letter-spacing:0.08em;color:#8e8e93;margin:10px 2px 3px">AGENT</div>
    <div style="margin-right:18px;padding:7px 9px;border-radius:13px 13px 13px 3px;background:#e5e5ea;color:#1c1c1e;font-size:10.5px;line-height:1.3">Two tests failed: session expiry and the remember-me cookie…</div></div>
  <div style="position:absolute;bottom:18px;left:8px;right:8px;display:flex;align-items:center;gap:5px;padding:7px 8px;border-radius:16px;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,0.08)">
    <div style="width:30px;height:30px;border-radius:50%;background:#007aff;padding:7px;box-sizing:border-box;flex:none">${MIC("#fff")}</div>
    <div style="font-size:11px;font-weight:700;color:#1c1c1e">Listening…</div><div style="display:flex;gap:2px;align-items:center;margin-left:auto">${WAVEFORM}</div></div>`,
  { background: "#f2f2f7", ink: "#000" },
);

export const carModeQuestion = {
  question: "How should car mode look on the phone?",
  html: `<div style="font: 14px -apple-system, system-ui, sans-serif; color: light-dark(#1f1d2b, #ecebf5); color-scheme: light dark">Each phone shows the <b>Listening…</b> state. Voice commands, Leave and approving on the screen work the same in all three; only the screen changes.</div>`,
  options: [
    {
      label: CAR_MODE_CHOICE,
      description: "Tap anywhere to talk or stop. Each state fills the screen with its own colour, readable from the corner of your eye.",
      html: wholeScreenButton,
      recommended: true,
    },
    {
      label: "Dark, for night",
      description: "A glowing ring on black: almost no glare when driving at night.",
      html: darkForNight,
    },
    {
      label: "Words on screen",
      description: "What you said and the reply, large. Easier to catch a misheard word, but more to read.",
      html: wordsOnScreen,
    },
  ],
};
