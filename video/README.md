# The Mirador trailer

A trailer of 2 minutes 33 seconds at 4K and 60 fps, made from footage of a real Mirador: a throwaway host on a fake home folder,
running the real Claude Code and opencode against a scripted stand-in for the model. Nothing in it is mocked up by hand, and no
account, conversation or setting of yours is used.

```bash
cd video
bun install
bun run build      # narrates, films, encodes, scores and renders: out/mirador-trailer.mp4
```

It needs Google Chrome, [opencode](https://opencode.ai), ffmpeg, [uv](https://docs.astral.sh/uv/), git and about 3 GB of free disk while it films. The
render alone takes about 20 minutes on an M-series Mac.

## The stages

| Step | Command | What it does |
| --- | --- | --- |
| Narrate | `bun run narrate` | Speaks `narration/lines.ts` with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), on this machine, into `public/narration`. Only changed lines are spoken again. The model is downloaded once to `~/.cache/mirador-video` and checked against its hash. It comes first because the voice scene's microphone plays the spoken question. |
| Film | `bun run capture` | `capture/trailer.spec.ts` starts Mirador on a free port with the demo projects in `capture/demo-world.ts`, and films each scene in a 4K Chrome window at 250% zoom. The agents' answers come from `capture/scenes.ts`, through the fake model in `capture/director.ts`; in the delegate scene, Claude Code hands its task to opencode, and in the jobs scene an `ssh` stand-in reaches a build server on this machine (`/tmp/build-01`). Each scene becomes `public/clips/<scene>.frames` and `<scene>.json`, with the moments and boxes the edit uses. `MIRADOR_VIDEO_SCENES=plugins,media` films only those scenes and keeps the other clips; a scene may need the one before it. |
| Encode | `bun run encode` | Turns the frames into 60 fps videos at the speed they were filmed, and deletes the frames. |
| Score | `bun run music` | Synthesises the score into `public/music/score.wav` (`audio/compose.ts`), timed to the storyboard. |
| Render | `bun run render` | Renders the [Remotion](https://www.remotion.dev) composition in `src` to `out/render.mp4`, then `audio/master.ts` brings its sound to YouTube's loudness (-14 LUFS) in `out/mirador-trailer.mp4`. |

`bun run studio` opens the composition in Remotion's editor, to scrub through it. `bun run test` checks the timing and
camera logic, and that the storyboard speaks every line.

## Changing it

- **A scene's cut, camera or caption**: `src/storyboard.ts`. Shots, camera moves and captions are keyed to the moments the
  capture marked, such as `["sent", 0.2]`, so they stay right when the footage is filmed again. A scene's `seconds` sets
  its length, and `fadeInFrames: 0` cuts straight to it instead of crossfading; the score puts a hit on such a cut. A
  line of narration's `musicDipsTo` makes the music dip less under it. A clip scene can have several `captions`. The
  montage's scenes (edit, terminals, groups) last whole beats of the score (`BEAT`), so each starts on the beat. The score's last chord
  rings out over the `backdrop` scene before the end card.
- **The opening**: the wall scene's `goesBlackAt` is when the wall cuts to black and silence. In the black its
  `statement` lands its `parts` as the narrator says them: `STATEMENT_AT` is when the `statement` line starts, and each
  part's `after` is how far into the spoken line its words begin, so measure them again when the line is spoken again.
  At `pictureAt` the statement clears and the checkout diagram the agent draws in the show clip
  (`capture/checkout-flow.ts`) draws itself. The score follows all three.
- **What the agents say and draw**: `capture/scenes.ts`, then film again.
- **The plugins**: `capture/plugins.ts` clones the plugins that come with Mirador, at the tags `plugins/defaults.json`
  names, and Media at `MEDIA`'s tag, once into `~/.cache/mirador-video/plugins`. Mirador installs Media on camera from
  a catalog that names its GitHub repo, and git fetches it from that cache. Delete a release's folder there to clone it
  again.
- **The voice scene**: the microphone plays the spoken `voiceAsk` line, and a stand-in voice server transcribes it and
  reads `voiceReply` back. A line with its own `voice` in `narration/lines.ts` is said by someone other than the
  narrator. In the storyboard, a line's `from` names a moment of the clip that its `at` counts from, so the question and
  the reply stay with the footage however the shots speed it up.
- **The narration**: edit `narration/lines.ts` and run `bun run narrate`. The render stops with an error while the
  spoken lines don't match the text.
- **The voice**: `bun run narrate --samples` speaks a line in eight voices into `out/voice-samples`. Set `VOICE` in
  `narration/lines.ts` (or `MIRADOR_VIDEO_VOICE`) and narrate again.
- **The music**: put a track in `public/music` and name it in `MUSIC` in `src/storyboard.ts`. It plays under the whole
  trailer and dips while the narrator speaks; `bun run music` would then no longer be needed.
- **The end card's addresses**: `WHERE_TO_GET_IT` and `PLUGIN_CATALOG` in `src/storyboard.ts`.
- **Light theme**: `MIRADOR_VIDEO_THEME=light bun run capture` films the app in its light theme. The trailer has only been
  made in the dark one so far.
