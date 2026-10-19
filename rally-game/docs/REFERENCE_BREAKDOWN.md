# Reference breakdown — Hardpack Rally clip

Source: `hardpack_rally_reference_pack/reference/rally_reference.mp4`. The same file is in the user's Downloads folder, also 7,017,825 bytes. The clip is 720x1280 portrait, 30 fps, 20.48 s and H.264.

Method: I extracted stills at 0, 2, 4 … 18 s (`rally-game/reference/frames/ref_tXX.jpg`) and a 4 fps sequence (`reference/dense/`, tiled into `reference/dense_sheet_a.jpg` and `_b.jpg`). I opened and viewed all of them. I also viewed the user's 16:9 screenshot from the same game, a golden-hour scene with tape barriers. Reference media stays local and is git-ignored because it is third-party footage.

Everything below is an observation from those frames. "→" lines are what we build from it, using original assets.

## Timeline of the clip (from the dense sheets)
| Clip time | In-game time | What happens | Speed |
|---|---|---|---|
| 0–1.5 s | 0:39.2–0:40.7 | Long fast straight. A gate: tall striped pillars on both road edges | 128→133 mph, 5th |
| 1.5–2.5 s | 0:40.7–0:41.7 | Hard braking: brake lights flare, exhaust backfire flame | 133→106 |
| 2.5–3.2 s | 0:41.7–0:42.4 | **Crest jump while turning in.** Car is clearly airborne and already yawed | ~99 |
| 3.2–5 s | 0:42.4–0:44.2 | Left-hand drift. Body slip angle is roughly 20–30°. The camera keeps looking down the road, so the car's flank shows | 92→63, 3rd |
| 5–7 s | 0:44.2–0:46.0 | Power-out along a gentle curve, light sideways | 63→96 |
| 7–10 s | 0:46–0:49.3 | Long straight with tree shadows striping the road | 100→127, 4th |
| 10–11.5 s | 0:49.3–0:50.5 | Braking, then a left kink at about 95 mph. Another gate with spectators | 127→94 |
| 12–14 s | 0:51.8–0:53.8 | Uphill straight. A tan dirt cut-bank (berm) on the right | 107→128 |
| 14–17 s | 0:54–0:56.5 | **Banked right-hander.** The road surface visibly tilts. Yellow chevron boards on posts | ~100 |
| 17–19 s | 0:56.5–0:58.3 | Straight, accelerating | 100→113 |
Odometer: 1.21 → 1.73 mi over 19 s, about 46 m/s or 104 mph average. **The game is fast.** Typical speed is 95–130 mph and slow corners are about 60–70 mph.
→ The track design needs long straights and fast sweepers, plus 3–4 braking zones down to about 60 mph.

## Car
- Boxy late-80s 2-door coupe/hatch in deep red, with a "HAYAI TURBO AWD" badge (we don't copy the name).
- From behind: a wide black rear panel with two horizontal orange-red tail-lamp blocks, a white plate in the middle, and a chrome tow hook / exhaust below. A tall rear wing on two struts has a white trailing edge.
- Dark navy tinted glass. Pillars are thin. A small white number roundel sits at the front of the roof.
- **Cel-shaded with dark ink outlines** on the silhouette and panel edges. Red is a flat two-tone (lit and shade).
- The car looks heavy. Body roll is visible in drifts, and the tail squats and lifts.
- Wheels are dark. The tyres look wide.
→ Original lofted low-poly coupe with an inverted-hull outline, toon-ramp paint, emissive lamps that brighten under braking, and a backfire flame on lift-off.

## Camera (portrait)
- Chase cam behind and above. The car's rear sits at about 55–68% of frame height, the horizon at about 45%, and the car spans about 35% of the portrait width.
- In drifts the camera follows the **velocity direction**, not the car's nose, so the car is shown at an angle.
- Over the jump the camera stays smooth with no harsh shake. FOV looks wide, about 75° vertical in portrait.
- The 16:9 screenshot (same game) puts the car at about 22% of frame width, the horizon at about 33% from the top, and the car in the lower-centre third.
→ A spring chase camera with velocity-weighted yaw, look-ahead, FOV that widens with speed, and portrait/landscape presets.

## World / art direction
- **Low-poly, faceted, flat-shaded** terrain. Triangles are visible on the shoulders and banks.
- Sky: saturated blue that gets lighter at the horizon, with large soft white clouds. The sun is visible high on the left (frame 4 s).
- Trees:
  - Conifers: stacked faceted cone tiers, dark green.
  - Broadleaf: big chunky faceted canopy clusters, olive / yellow-green, lit tops and darker undersides.
  - Tall dark red-brown trunks. Dense forest walls on both sides of the road, with trees often 3–8 m from the edge.
- Grass is mid green with a yellow tint. Pale tall grass tufts cluster near road edges.
- Distant hills are pale blue-grey haze with tree silhouettes. There is strong aerial perspective.
- Props: a water tower, wooden post-and-rail fences, yellow chevron boards with black arrows, small groups of low-poly spectators at gates, and banners.
- Gates: a pair of tall pillars, one on each road edge. Each is a white/orange illuminated panel with down-chevrons on a pole and base.
- Shadows: crisp, cool blue-grey, long tree shadows across the road. Sunlit surfaces are warm.

## Road
- Wide tan/peach hardpack, roughly 3.5–4 car widths and 7–9 m (the "narrow" section is about 6 m).
- The surface has a faint **cracked-earth cell pattern** and many **dark grey tyre tracks** (soft-edged, 0.3–0.5 m wide) running along it.
- Shoulders are a paler sandy strip blending into grass. Cut banks of exposed tan earth appear on some sides.
- Elevation: crests, an uphill straight, and a jump crest. The banked corner tilts the whole road surface.

## HUD (layout only, our art is original)
- Top centre: a dark box with the big time `0:43.133` and `GATE 5 OF 20` under it. A thin orange accent line sits on top.
- Under it: a small translucent blue box with a **route preview**, a white line curving ahead from a marker.
- A gate split popup: an orange pill reading "GATE 4  0:40.417".
- Bottom right: a semicircle tach arc (orange to red) with the gear in the middle. Small HANDBRAKE and CLUTCH indicators sit above it. A dark box shows the big speed in **MPH**.
- Bottom left: an odometer box (`1.30 mi`) and STEER / THROTTLE / BRAKE input bars.
- **Yellow speech bubbles are social-video overlays, not game UI. Not implemented.**

## Motion / feel
- Fast and floaty-but-planted arcade handling, with long drifts at high speed (95 mph kinks taken with slip).
- Braking is strong. The car turns in under braking, and the drift starts from weight transfer plus a lift.
- Jumps are short with modest air time (about 0.4 s) and a soft landing.
- Dust is light: small puffs behind the wheels and brief plumes when sliding.

## Checklist we evaluate screenshots against
1. A red cel-shaded coupe reads instantly from behind (wing, tail-lamp bar, plate, outline).
2. The car sits in the lower-centre third. The horizon is at about 33–40% (16:9) or about 45% (9:16).
3. Bright blue sky, white clouds, hazy pale hills.
4. Dense mixed conifer and broadleaf forest close to the road, with tall trunks.
5. Tan cracked hardpack road with dark tyre tracks and paler shoulders.
6. Crisp cool shadows across the road.
7. Faceted, flat-shaded terrain with visible elevation (crests, cut banks).
8. A banked corner whose tilt you can see, with chevron boards.
9. A compact HUD: time + gate (top), route preview, MPH + gear arc (bottom right), inputs (bottom left).
10. Speed sensation: 100+ mph straights, drifts where the camera follows velocity.
