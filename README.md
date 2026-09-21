# JEV Court Lab

An uploaded basketball video → detected players, basketball and hoop → generic tracks → deterministic court facts → TypeSafe Jev judgments during replay → annotated replay and decision timeline.

## Run

Requires Node 22.13+. Run `npm install`, then `npm run dev`. `npm test` checks geometry, causal frame selection, tracking, possession estimates and decision validation. `npx tsc --noEmit` checks types; `npm run build` produces the deployable Worker.

## Use

1. Upload a video under 1 GB. The old 5–15 second restriction is removed; multi-minute videos and longer footage are accepted (finite duration up to 24 hours). Processing time grows with length. H.264 MP4 and browser-decodable MOV/WebM work.
2. The browser samples at 4 fps, retains up to 1600 pixels of width, and runs the pretrained E-BARD YOLOv8n basketball detector on the whole frame plus three overlapping square crops for wide/tall videos. WebGPU acceleration is used when available, with WASM fallback. It distinguishes basketballs, hoops, players and referees. No custom training is performed.
3. Ball candidates require plausible player proximity or recent ball continuity; ambiguous candidates stay unknown. Ball proximity estimates possession; brief occlusions can use at most 0.5 seconds of past ball evidence. Similar jersey colors group teammates. A detected hoop supplies the basket position. The replay starts at the beginning of the clip.
4. Connect OpenRouter. After tracking finishes, playback starts automatically when connected. Jev evaluates successive structured court states during the replay, with up to two requests per second. There is no per-moment Ask button.
5. Watch the probability bars update while the video continues uninterrupted. Pause or scrub to inspect another moment; that state is evaluated automatically. Optional handler, team and hoop corrections apply to the current frame and automatically update the analysis.
6. Each response is saved on the timeline. Select a saved moment to inspect its exact state or label the observed action; Resume live replay returns to moving odds. Export includes tracks, states, responses and observations.

If detection finds no players, the exact uploaded video remains playable to help check that the file contains the intended footage. Missing or ambiguous ball evidence stays uncertain instead of inventing a handler.

## Live replay behavior

CV decodes the uploaded clip at 4 fps in ordered 12-frame batches. The local browser player is available as soon as metadata is decoded; it waits for an initial 10-second processed buffer and cannot cross the analyzed-through boundary while detection continues. This is replay analysis, not camera or live-stream ingestion. Jev receives only structured court facts for a timestamp plus up to one second of earlier causal context—never future frames.

During ingestion, timestamp-ordered state snapshots are cached at 250 ms of video time (and state transitions are never skipped). Scrubbing reads those saved timestamps rather than requesting an alternative frame. Responses that belong to a replaced clip are discarded. The panel hides results from a future frame, another handler, or an invalidated possession.

Completed states are reused when rewinding. Seeking, replacing a clip or editing facts invalidates in-flight results. Hidden tabs and saved-snapshot inspection suspend new requests. A provider error pauses analysis until retry, reconnection or a new clip. The synthetic sample animates local rules and does not spend OpenRouter credits.

PASS_LEFT and PASS_RIGHT retain their existing meaning: a teammate to the screen-left or screen-right of the handler in the image. They are directional categories, not named receivers or player-relative/court-relative directions.

## OpenRouter

The API key is stored only in this browser tab's `sessionStorage`, survives refreshes, and can be removed with **Clear key**. Closing the tab clears its session. It is excluded from analysis exports. Alternatively configure `OPENROUTER_API_KEY` in local `.env` or the Site's secret environment; never prefix it with NEXT_PUBLIC.

Only the strict structured state is sent to the app endpoint and then `POST https://openrouter.ai/api/alpha/decisions`, using `~typesafe/jev-latest` and one Choice question. Jev never receives footage, images, jersey pixels or credentials in its prompt. The endpoint limits input size and rejects raw media and arbitrary additional fields. There is no fallback model for a failed Jev request.

The optional built-in sample uses synthetic data with a labeled deterministic rules preview; those weights are not Jev probabilities.

## Boundaries and limitations

- `lib/yolo.ts`: pretrained detector, centered RGB letterbox preprocessing, browser ONNX inference, hoop extraction and jersey color sampling.
- `lib/vision.ts` and `lib/ball-tracking.ts`: ordered batch extraction, duplicate suppression, generic motion/size/jersey matching, and causal ball/possession recovery. Ball visibility, ball-track confidence and possession confidence are separate. A click may seed ball tracking; it is revalidated against nearby players. Brief occlusions decay over 0.5 seconds of video time; passes, shots and camera cuts invalidate the prior possession immediately.
- `lib/detection-geometry.ts`: overlapping crops, coordinate restoration, tile-edge rejection, camera-cut heuristic and active-ball evidence filtering.
- `lib/possession.ts`: causal ball-to-player association, short occlusion carry, jersey-color grouping and optional manual overrides. Association confidence is a heuristic, not calibrated accuracy.
- `lib/court.ts`: causal frame selection, aspect-corrected image-plane geometry, strict facts and decision validation.
- `lib/attacking-geometry.ts` and `lib/decision-policy.ts`: measured shot/drive evidence, explicit finish/open-shot/one-on-one/help-defense criteria, and causal context shared by every JEV request. See [research and limits](docs/decision-policy.md).
- `lib/live-decisions.ts` and `hooks/use-live-jev.ts`: rate-limited automatic requests, completed-state reuse, late-response rejection and timestamp-safe display.
- `app/api/decision/route.ts`: same-origin, bounded structured requests, provider timeouts and visible errors.

Possession is an estimate, not identity recognition. Track numbers are temporary IDs, not jersey numbers. Balls can be missed or falsely detected; a nearby player does not always have possession. Similar uniforms, skin/background pixels, occluded players and camera cuts can corrupt team estimates. Referee suppression is model-based and can be wrong. Missing teams and basket distances are explicitly unknown and included in the quality limitations supplied to Jev.

Coordinates and distances use image-width fractions, not feet or meters. There is no court homography or camera compensation. Passing lanes are image-plane tests. Paint occupancy, shot-quality models, play recognition, live video and training remain out of scope.

Jev probabilities express preferred actions from limited facts. They are not a measured basketball prediction benchmark. Observed actions are reviewer labels after reveal.

## Detector attribution

Gabriele Giudici's [E-BARD detection models](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models), [official project](https://github.com/GabrieleGiudic/E-BARD). The author's YOLOv8n weights are distributed under the model card's CC-BY-4.0 license and were converted to ONNX, opset 17, 704×704 float32. No retraining was performed. See `public/models/E-BARD-NOTICE.txt`. The Ultralytics architecture is AGPL-3.0. Browser inference uses ONNX Runtime Web; its license is included under `public/onnx/`.

Jev references: [model](https://openrouter.ai/~typesafe/jev-latest), [OpenRouter decisions example](https://openrouter.ai/docs/cookbook/building-agents/gate-tool-calls-with-jev), [TypeSafe Choice primitive](https://docs.typesafe.ai/primitives/choice).

## Shooting, driving and passing

The question asks which immediate action the handler should take. SHOOT explicitly covers layups, dunks, close finishes, floaters and jump shots. The criteria favor a credible available finish or open shot over a routine extra pass. DRIVE is prioritized only for a supported local one-on-one opportunity against a close defender, with usable space beyond them and no second defender/help blocking the route. A good available shot or clearly better pass still wins. An uncertain matchup, possible help or congestion must not make DRIVE the first choice; missing shooting-range information is not a reason to default to driving. Being at the top of the key does not by itself establish a drive; a backed-off defender can favor shooting. Passing must improve the opportunity or relieve pressure. These are JEV instructions, not a deterministic one-on-one detector or a probability adjustment.

The headline and history show the highest-probability individual action. Combined passing preference remains visible as a secondary figure. All five original probabilities remain unchanged and sum to one. Screen-left/right refer to the receiver's image x-coordinate relative to the handler; they do not name a receiver when several players are on that side.

The input now includes basket and defender positions, distances relative to the handler's apparent height, and possible help/traffic in a screen corridor toward the hoop. These are uncertain geometric cues, not physical shot range, court calibration or a shot-quality model. The app cannot reliably identify the top of the key, shooting readiness or defender reach. See [the policy research, implementation and evaluation limits](docs/decision-policy.md). Responses include `policy_version: shoot-drive-v3`; reload the site and reselect the clip to obtain new decisions.

Lane geometry checks whether a known defender's feet lie between 8% and 92% of the handler-to-receiver segment, within 3.5% of image width. A known defender there means blocked; an unassigned player there, or no known defenders, means unknown. Otherwise the observed lane is labeled clear. This is a 2D heuristic, not physical pass completion validation. Reach, depth, pass speed, player skill, score and shot clock are not modeled. Observed-action labels allow comparing what happened, not proving the chosen action was optimal.

## Official NBA footage sources

The interface includes a collapsed list of verified official viewing pages:

- [Timberwolves–Nuggets uncut run](https://www.nba.com/watch/video/min-14-0-run-uncut?collection=uncut-moments&plsrc=nba): 4:52.
- [Mavericks–Knicks uncut run](https://www.nba.com/watch/video/mavericks-big-run-vs-knicks-uncut?collection=uncut-moments&plsrc=nba): 6:00.
- [Celtics–Knicks double-overtime finish](https://www.nba.com/watch/video/uncut-lookback-to-celtics-vs-knicks-2ot-thriller-opening-night-2021?collection=uncut-moments&plsrc=nba): 8:31.
- [Cavaliers–Warriors, 2016 Finals Game 7](https://www.nba.com/watch/video/cavaliers-warriors-2016-nba-finals-game-7): full-game source.

These are viewing links, not bundled media or guaranteed direct downloads. The app processes user-supplied local video. Consecutive possessions give better coverage of passes and non-passes than a made-basket highlight reel. Broadcast cuts and replays still require caution. This source search did not bypass playback access controls.

Crop inference follows the general [SAHI](https://obss.github.io/sahi/) approach, implemented in the browser against the existing ONNX model. OpenCV and Ultralytics were used locally to investigate candidate detections on the supplied footage; Python is not required by the hosted site.
