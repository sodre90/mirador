# The Mirador trailer

A trailer of about 60 seconds at 4K and 60 fps, made from footage of a real Mirador: a throwaway host on a fake home folder,
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

- **A scene's cut, camera or slam**: `src/storyboard.ts`. Shots and camera moves are keyed to the moments the capture
  marked, such as `["sent", 0.2]`, so they stay right when the footage is filmed again. A scene's `seconds` sets its
  length. A scene with `slam: true` cuts straight in with a flash and a punch of zoom
  (`src/components/Hit.tsx`); the score hits on every slam. A line of narration's
  `musicDipsTo` makes the music dip less under it. The score's last chord rings out over the `backdrop` scene before
  the end card.
- **Keeping the cuts on the beat**: every slammed scene lasts whole beats of the score (`beats(n)`, at `TEMPO`), long
  enough for its narration, and each of the score's sections (from show, review, plugins and jobs) adds up to
  whole bars, so no section bends its tempo. `tests/timeline.test.ts` checks the scenes; when you change a scene's
  length, keep its section's beats a multiple of four.
- **The cold open**: `COLD_OPEN` in `src/storyboard.ts` is six slammed cuts of two beats each, one moment of a clip
  apiece.
- **The opening**: the `hook` scene opens on an agent's answer racing past as a wall of text
  (`src/scenes/WallOfText.tsx`), speeding up while the camera pulls back, and at `CANVAS_AT` in `src/Trailer.tsx` it
  hits (`HITS_AT`) and cuts to a drawing of the checkout diagram the agent draws in the show clip
  (`capture/checkout-flow.ts`). The show scene picks up once the app has drawn it, so it is never drawn twice. The
  score builds under the picture into a hit on the cut to show. The wall used to be a 14-second opening of its own,
  during which YouTube's retention showed a third of viewers leaving; now it lasts 3.5 seconds, after the cold open.
- **The corner labels**: each feature scene names its feature in the bottom-left corner for the whole scene
  (`featureTag` in `src/storyboard.ts`, drawn by `src/components/CaptionCard.tsx`).
- **What the agents say and draw**: `capture/scenes.ts`, then film again.
- **The plugins**: `capture/plugins.ts` clones the plugins that come with Mirador, at the tags `plugins/defaults.json`
  names, and Media at `MEDIA`'s tag, once into `~/.cache/mirador-video/plugins`. Mirador installs Media on camera from
  a catalog that names its GitHub repo, and git fetches it from that cache. Delete a release's folder there to clone it
  again.
- **The voice clip**: the capture still films it, though the trailer no longer shows it: the microphone plays the
  spoken `voiceAsk` line, and a stand-in voice server transcribes it and reads `voiceReply` back (`CAPTURE_ONLY_LINES`).
  A line's `from` in the storyboard names a moment of the clip that its `at` counts from, so a line stays with the
  footage however the shots speed it up.
- **The narration**: edit `narration/lines.ts` and run `bun run narrate`. The render stops with an error while the
  spoken lines don't match the text.
- **The voice**: `bun run narrate --samples` speaks a line in eight voices into `out/voice-samples`. Set `VOICE` in
  `narration/lines.ts` (or `MIRADOR_VIDEO_VOICE`) and narrate again.
- **The music**: put a track in `public/music` and name it in `MUSIC` in `src/storyboard.ts`. It plays under the whole
  trailer and dips while the narrator speaks; `bun run music` would then no longer be needed.
- **The end card's addresses**: `WHERE_TO_GET_IT` and `PLUGIN_CATALOG` in `src/storyboard.ts`.
- **Light theme**: `MIRADOR_VIDEO_THEME=light bun run capture` films the app in its light theme. The trailer has only been
  made in the dark one so far.
