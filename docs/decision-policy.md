# Shoot / drive policy — shoot-drive-v2

Researched September 21, 2026. This changes the question sent to JEV and its measured input, not the model weights. Responses retain the model's original probabilities. `policy_version` is included in server responses and exported decisions for comparison.

## Coaching basis

- [Basketball Immersion: Teaching the Shoot or Drive Basketball Decision](https://basketballimmersion.com/the-shoot-or-drive-basketball-decision/) describes a coaching approach that prioritizes an open shot within the player's range, attacks a close defender, and allows a better opportunity for a teammate to override the shot. Its arm-length cue is a teaching simplification, not a threshold we can accurately recover from broadcast bounding boxes.
- [Jr. NBA: Layup](https://jr.nba.com/layup/) defines the layup as a shot near the basket. Our SHOOT action explicitly includes finishes and is not restricted to jump shots.
- [Jr. NBA: Rookie Practice Plan 4](https://jr.nba.com/basketball-practice-plans/rookie/page/4/) practices choosing a pass to an open cutter or driving for a layup when the cutter is defended. DRIVE creates the opportunity; SHOOT takes the available finish.
- [FIBA/WABC Level 1 coaching manual](https://assets.fiba.basketball/image/upload/documents-corporate-wabc-coaching-level-manuals-level-1-eng.pdf), section 3.2, discusses including help-defender position in a drive decision. Only the indexed section was accessible during this research; the large PDF could not be retrieved in full.

These are coaching principles, not evidence that a universal shoot-first rule is optimal or that this implementation improves basketball decisions.

## Application

The shared policy in `lib/decision-policy.ts` applies to both background and replay requests. It explicitly favors an available credible finish or good open shot over an unproductive extra pass, describes the one-on-one drive read, checks for help, and requires a concrete advantage for a pass. The five response labels are unchanged.

`buildState` now includes the detected/marked basket position, primary defender (nearest observed defender, not a verified matchup), defender positions and distances, distances normalized by the handler's apparent height, and possible secondary defenders, teammates and unassigned players along a projected route to the hoop. The corridor uses current-frame geometry only and is labeled as an image-plane estimate. A missing defender does not establish openness; an unassigned corridor player makes help status unknown.

The hoop is elevated and its image position is not a floor projection. Neither proximity in pixels nor a ratio to player height proves layup range, an open shot, top-of-key position or an actual driving lane. Court zone, shooting range and shot readiness remain explicitly unknown. Defender reach, stance, dribble eligibility, player shooting skill and shot clock are not measured. Missing information lowers confidence without imposing an automatic preference for passing.

Earlier context includes at most four same-handler, same-source observations from the preceding second, sorted by timestamp. The richer shot/drive evidence is retained. Future and current-frame entries are excluded. This filter is not a complete possession-segment model.

The UI leads with the highest-probability individual action. Combined left/right passing preference is secondary so it cannot be confused with the top individual action.

## Verification and remaining evaluation

Automated tests cover close-rim versus perimeter geometry, trailing versus help defenders, offensive congestion, defender spacing and aspect ratios, missing and unassigned detections, strict schema compatibility, causal context, and cache identity after corrections. Policy contract tests check the explicit action definitions; they do not claim model behavior.

Before claiming a basketball improvement, compare actual JEV responses on reviewed clips: an available layup; an open in-range jumper; a tight perimeter defender without visible help; help arriving on a drive; and a heavily contested rim attempt. Include counterexamples such as a distant but open player and missed defenders. Judge the frozen decision using only earlier evidence, not whether the eventual shot went in. No real-footage accuracy evaluation or live JEV comparison was performed for this change.
