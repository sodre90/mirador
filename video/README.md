# The Mirador trailer & README GIFs

A flagship 0.15.5 trailer (~88 seconds at 4K and 60 fps, dark theme) plus 7 reproducible light-theme feature GIFs for `README.md`, all filmed from a real Mirador host running real Claude Code, opencode, official plugins, and a local peer-to-peer broker against a scripted stand-in model. Apart from the drawn hook and chapter 10, nothing is mocked by hand, and no account, conversation, or setting of yours is used.

```bash
cd video
bun install
bun run build      # narrates, films, encodes, scores and renders: out/mirador-trailer.mp4
bun run gifs       # films and two-pass encodes the 7 README GIFs into ../docs/gifs/
```

It needs Google Chrome, [opencode](https://opencode.ai), ffmpeg, [uv](https://docs.astral.sh/uv/), git and about 3 GB of free disk while it films. The 4K render takes about 15–20 minutes on an M-series Mac.

## The stages

| Step | Command | What it does |
| --- | --- | --- |
| Narrate | `bun run narrate` | Speaks `narration/lines.ts` with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) into `public/narration`. Only changed lines are spoken again. The model downloads once to `~/.cache/mirador-video` and is verified by SHA-256. |
| Film | `bun run capture` | `capture/trailer.spec.ts` starts Mirador on a free port with the demo projects in `capture/demo-world.ts` (including custom `.mirador/icon.svg` project icons) and a local `mirador-p2p` broker when installed, and films each chapter in a 4K Chrome window at 250% zoom. `MIRADOR_VIDEO_SCENES=showPoint,p2p` films only those scenes and keeps the other clips. |
| Encode | `bun run encode` | Turns the captured frames into 60 fps MP4 clips in `public/clips` and deletes the temporary frame folders. |
| Score | `bun run music` | Synthesises the 120 BPM score and stereo transition SFX into `public/music/score.wav` (`audio/compose.ts`), locked to the storyboard's exact bar grid. |
| Render | `bun run render` | Renders the [Remotion](https://www.remotion.dev) composition in `src` to `out/render.mp4`, then `audio/master.ts` masters its loudness to YouTube's -14 LUFS target in `out/mirador-trailer.mp4`. |
| README GIFs | `bun run gifs` | Runs `capture/readme-gifs.spec.ts` (light theme, 1280×760) and encodes all 7 feature GIFs into `../docs/gifs/` via two-pass ffmpeg palette generation (`capture/encode-gifs.ts`). `MIRADOR_GIFS=show-and-point,ask` regenerates a subset. |

`bun run studio` opens the composition in Remotion's editor. `bun run test` checks timing, camera framing, beat/bar alignment, and narration coverage.

## Structure of the trailer

- **Hook (0:00–0:08)**: Accelerating wall of agent text and diffs with a bold kinetic headline (*"Coding agents write faster than you can read."*) flips on the beat into the agent asking how car mode should look, with three iPhone mockups springing in and the recommended one picked.
- **01 · Canvas (`showPoint`)**: Live checkout diagram beside the chat, clicking *Point and ask* on a bottleneck, and watching the diagram redraw with a mail queue.
- **02 · Ask (`ask`)**: Visual iPhone car-mode previews answered with a click.
- **03 · Review & Tours (`review`)**: Full-screen guided code review — Flow walkthrough, Findings tab, asking about a blocker, and watching it update in place.
- **04 · Side Chat (`sideChat`)**: Selecting any words in a reply and asking in a side chat without interrupting the main turn.
- **05 · Worktrees (`worktree`)**: Giving each conversation its own git worktree, then inspecting the diff, committing, and merging from *Changes*.
- **06 · Fork (`fork`)**: Zooming into *Fork from here* on any turn and branching off with the canvas copied along.
- **07 · Multi-Agent (`delegate`)**: Claude Code delegating a dead-flag sweep to a local Qwen model on opencode and verifying the result.
- **08 · Background Jobs (`jobs`)**: Watching a 214-test e2e run on `build-01`, following it live in a terminal, and waking the agent when green.
- **09 · Plugins & Media (`media`)**: Official *Plugins…* gallery, then Media marking a slow spinner on the frame, cutting it, and playing the rendered clip.
- **10 · Peer-to-Peer (`p2p`)**: A drawn motion graphic: studio-mac copies an invite from *Devices*, the link flies to ada-laptop's *Machines*, an encrypted tunnel draws between them, and studio-mac's workspaces open on the laptop.
- **End Card**: Animated Mirador wordmark, all six supported agents, concise Homebrew install command, platforms, and website/GitHub addresses.

## Changing it

- **Cuts, camera, accents, chapter labels**: `src/storyboard.ts`. Every scene uses whole beats at `TEMPO = 120` (exact 0.5 s = 30 frames/beat), and each musical act sums to whole 4-beat bars. `camera.ts` reserves a 168 px top inset so zoomed views never collide with the floating chapter bar (`src/components/CaptionCard.tsx`).
- **Narration**: edit `narration/lines.ts` and run `bun run narrate`.
- **Scripts & demo projects**: `capture/scenes.ts` and `capture/demo-world.ts`.
- **Plugins**: `capture/plugins.ts` caches clean release clones in `~/.cache/mirador-video/plugins`.
