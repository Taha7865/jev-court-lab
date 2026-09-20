# JEV Court Lab

A deliberately small basketball decision experiment: one uploaded 5–15 second possession, generic player and ball tracks, a reviewed image-plane court state, and one Jev decision at a time.

## Run

Requires Node 22.13+ (24 recommended). Run `npm install`, then `npm run dev` and open the printed local URL. `npm test` runs geometry, causal frame selection, tracking and decision validation checks; `npx tsc --noEmit` checks types; `npm run build` builds the deployable Worker.

Connect an OpenRouter key in the interface. It stays in tab memory and is forwarded only to the app's decision endpoint and OpenRouter. It is not saved in local storage or exported. Alternatively set `OPENROUTER_API_KEY` in the local `.env` or the hosted Site's secret environment. Do not prefix it with NEXT_PUBLIC.

## Use

1. Upload a single continuous shot, 5–15 seconds, under 80 MB. H.264 MP4 and browser-decodable WebM work best; MOV support depends on its codec.
2. The browser decodes frames at 4 fps and runs pretrained YOLOX Tiny at 416×416, merging duplicate boxes. We use this browser-compatible detector rather than introducing a separate GPU service for V1. No custom model is trained.
3. Pause at a decision moment. Assign every visible person to offense, defense or ignore (spectators/referees). Confirm the ball handler. Mark the basket in this frame. A new frame requires a new basket marker because camera motion can invalidate the old one.
4. Ask Jev. The replay freezes at the actual sampled frame; only a validated structured state is submitted to `POST https://openrouter.ai/api/alpha/decisions` using `~typesafe/jev-latest` and one Choice question.
5. Inspect the five probabilities and immutable timeline snapshot. Reveal the continuation, label the observed action, and export JSON containing tracks, states, responses, and observations.

The built-in schematic is **synthetic data** with a clearly labeled **deterministic rules preview**. It does not claim to be detected video or Jev output. You can evaluate its structured state with real Jev after connecting a key.

## Boundaries

- `lib/vision.ts`: lazy-loaded detector, browser frame extraction, generic class-aware motion/size matching tracker. Only actually detected objects are rendered; lost tracks are retained internally for up to 0.8 sec for reassociation.
- `lib/court.ts`: causal frame lookup, aspect-ratio-corrected image-plane geometry, typed state schema, sample fixture, decision schema validation.
- `app/api/decision/route.ts`: same-origin JSON endpoint with a 48 KB body cap, strict allowlisted state, timeouts and actionable provider errors. No raw frames or video are accepted. No silent substitute model or rules fallback is used for a Jev request.
- `app/page.tsx`: upload/review/replay/decision/timeline surface. Analysis lives in memory; JSON export is explicit. Reloading clears uploaded clips, events and the session key.

## What V1 cannot claim

YOLOX Tiny is a generic COCO detector. Small, occluded or blurred basketballs may not be detected; no ball is invented when detection fails. Person detections can include spectators and referees. Possession and teams are user-confirmed, not inferred reliably. Generic track IDs can change during occlusions. Camera motion is not compensated. The motion model is a compact greedy tracker, not a basketball-specific identity model.

Coordinates use x/y fractions of frame dimensions. Distances correct for image aspect ratio and use fractions of image width; speeds use image-width fractions per second. They are **not physical feet, meters, or player speeds**, and perspective can distort all geometry. Passing lanes are image-plane segment proximity tests, not calibrated tactical measurements. Paint occupancy is omitted because no paint polygon is calibrated.

Jev probabilities describe its preferred next action from the available state. They are not measured shot quality or empirically calibrated action/outcome predictions. The observed action label is entered by the reviewer after reveal. No training, identity recognition, play recognition, live video, full court homography, or accuracy benchmark is claimed.

## References

- Jev model: https://openrouter.ai/~typesafe/jev-latest
- OpenRouter Decisions example: https://openrouter.ai/docs/cookbook/building-agents/gate-tool-calls-with-jev
- TypeSafe Choice request/response: https://docs.typesafe.ai/primitives/choice
- Pretrained detector: https://github.com/Megvii-BaseDetection/YOLOX/tree/main/demo/ONNXRuntime
