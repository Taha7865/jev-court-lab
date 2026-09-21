# JEV Court Lab

One uploaded 5–15 second basketball possession → detected players, basketball and hoop → generic tracks → deterministic court facts → TypeSafe Jev judgments during replay → annotated replay and decision timeline.

## Run

Requires Node 22.13+. Run `npm install`, then `npm run dev`. `npm test` checks geometry, causal frame selection, tracking, possession estimates and decision validation. `npx tsc --noEmit` checks types; `npm run build` produces the deployable Worker.

## Use

1. Upload one continuous shot under 80 MB. H.264 MP4 and browser-decodable MOV/WebM work.
2. The browser samples at 4 fps and runs the pretrained E-BARD YOLOv8n basketball detector. It distinguishes basketballs, hoops, players and referees. No custom training is performed.
3. Ball proximity estimates possession; brief occlusions can use at most 0.5 seconds of past ball evidence. Similar jersey colors group teammates. A detected hoop supplies the basket position. The replay starts at the beginning of the clip.
4. Connect OpenRouter. After tracking finishes, playback starts automatically when connected. Jev evaluates successive structured court states during the replay, with up to two requests per second. There is no per-moment Ask button.
5. Watch the probability bars update while the video continues uninterrupted. Pause or scrub to inspect another moment; that state is evaluated automatically. Optional handler, team and hoop corrections apply to the current frame and automatically update the analysis.
6. Each response is saved on the timeline. Select a saved moment to inspect its exact state or label the observed action; Resume live replay returns to moving odds. Export includes tracks, states, responses and observations.

If detection finds no players, the exact uploaded video remains playable to help check that the file contains the intended footage. Missing or ambiguous ball evidence stays uncertain instead of inventing a handler.

## Live replay behavior

CV still prepares the uploaded clip at 4 fps first; this is live decision analysis of a replay, not camera or live-stream ingestion. Jev requests contain only the court facts for their timestamp, never future frames.

The single-flight queue targets the newest available state and limits starts to one every 500 ms. Slow responses do not pause playback or cause intermediate frames to pile up. The panel shows each response's timestamp. It hides results from a future frame, another handler, an uncertain current possession, or more than 1.5 seconds behind the sampled play. Paused moments require an exact state match. API speed and detection confidence determine the actual update rate; this is not an inference for every video frame.

Completed states are reused when rewinding. Seeking, replacing a clip or editing facts invalidates in-flight results. Hidden tabs and saved-snapshot inspection suspend new requests. A provider error pauses analysis until retry, reconnection or a new clip. The synthetic sample animates local rules and does not spend OpenRouter credits.

PASS_LEFT and PASS_RIGHT retain their existing meaning: a teammate to the screen-left or screen-right of the handler in the image. They are directional categories, not named receivers or player-relative/court-relative directions.

## OpenRouter

The API key is stored only in this browser tab's `sessionStorage`, survives refreshes, and can be removed with **Clear key**. Closing the tab clears its session. It is excluded from analysis exports. Alternatively configure `OPENROUTER_API_KEY` in local `.env` or the Site's secret environment; never prefix it with NEXT_PUBLIC.

Only the strict structured state is sent to the app endpoint and then `POST https://openrouter.ai/api/alpha/decisions`, using `~typesafe/jev-latest` and one Choice question. Jev never receives footage, images, jersey pixels or credentials in its prompt. The endpoint limits input size and rejects raw media and arbitrary additional fields. There is no fallback model for a failed Jev request.

The built-in court schematic is synthetic data with a labeled deterministic rules preview; those weights are not Jev probabilities.

## Boundaries and limitations

- `lib/yolo.ts`: pretrained detector, centered RGB letterbox preprocessing, browser ONNX inference, hoop extraction and jersey color sampling.
- `lib/vision.ts`: frame extraction, duplicate suppression and generic motion/size matching. Tracks may switch under occlusion or camera movement.
- `lib/possession.ts`: causal ball-to-player association, short occlusion carry, jersey-color grouping and optional manual overrides. Association confidence is a heuristic, not calibrated accuracy.
- `lib/court.ts`: causal frame selection, aspect-corrected image-plane geometry, strict facts and decision validation.
- `lib/live-decisions.ts` and `hooks/use-live-jev.ts`: rate-limited automatic requests, completed-state reuse, late-response rejection and timestamp-safe display.
- `app/api/decision/route.ts`: same-origin, bounded structured requests, provider timeouts and visible errors.

Possession is an estimate, not identity recognition. Track numbers are temporary IDs, not jersey numbers. Balls can be missed or falsely detected; a nearby player does not always have possession. Similar uniforms, skin/background pixels, occluded players and camera cuts can corrupt team estimates. Referee suppression is model-based and can be wrong. Missing teams and basket distances are explicitly unknown and included in the quality limitations supplied to Jev.

Coordinates and distances use image-width fractions, not feet or meters. There is no court homography or camera compensation. Passing lanes are image-plane tests. Paint occupancy, shot-quality models, play recognition, live video and training remain out of scope.

Jev probabilities express preferred actions from limited facts. They are not a measured basketball prediction benchmark. Observed actions are reviewer labels after reveal.

## Detector attribution

Gabriele Giudici's [E-BARD detection models](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models), [official project](https://github.com/GabrieleGiudic/E-BARD). The author's YOLOv8n weights are distributed under the model card's CC-BY-4.0 license and were converted to ONNX, opset 17, 704×704 float32. No retraining was performed. See `public/models/E-BARD-NOTICE.txt`. The Ultralytics architecture is AGPL-3.0. Browser inference uses ONNX Runtime Web; its license is included under `public/onnx/`.

Jev references: [model](https://openrouter.ai/~typesafe/jev-latest), [OpenRouter decisions example](https://openrouter.ai/docs/cookbook/building-agents/gate-tool-calls-with-jev), [TypeSafe Choice primitive](https://docs.typesafe.ai/primitives/choice).
