# Iteration log

Each entry: evidence (real screenshots / telemetry from automated runs), the biggest problems, changes, results, next.
Test environment for every run: Windows 11, RTX 3050 Laptop GPU (ANGLE/D3D11), Ryzen 7 7435HS, Chrome 155 via Playwright (headless, still GPU-accelerated; verified via `scripts/probe-gpu.mjs`).

---

## Iteration 1: first drivable build
**Evidence:** `scripts/explore.mjs` autopilot run, 40 s, with screenshots `.cache/explore/t005.png` and `t025.png`.
- It renders: sky, forest, cracked tan road, start arch, spectators. No console errors. 98 fps at 1280x720 with about 1.6 M triangles and 1092 draw calls.
- The car goes 0 → 114 mph and shifts gears correctly.

**Problems**
1. **Physics blew up to NaN** at s≈980 after an off-road excursion. Tracing (`scripts/debug-nan2.mjs`) showed the yaw rate climbing to −33 → −190 rad/s. Two causes:
   - The tree impulse used `-(r×n).y`, a sign error that *injects* spin.
   - The 2-D trunk test collided while the car was flying 8 m above the trees.
2. The autopilot ran wide on the 240 m sweeper at 112 mph and crashed. Then a tree hit compounded the spin.
3. Visuals:
   - The camera was too low and close, so the car hid the road.
   - Conifers were nearly black.
   - The sky was washed out by ACES.
   - No tyres were visible from behind.

**Changes**
- Fixed the sign in the impulse, including tangential friction through the yaw axis.
- Obstacles now carry a base height and a top height.
- Added an angular-velocity cap (9 rad/s), a speed cap, and a NaN failsafe that restores the last good pose.
- Camera raised and pitched down.
- Brighter conifer palette.
- Neutral tone mapping.
- Wider wheel track.

## Iteration 2: full-stage completion + dynamics bench
**Evidence:** full autopilot run (`explore.mjs 140`). Screenshots `t010`, `t020`, `t040` and `t050`.
- **All 20 gates and finish at 118.3 s.** 0 recoveries, 0 console errors.
- Vista, banked corner (13.7° roll from the road bank) and the uphill cut-bank straight look close to the reference.
- New `scripts/dynamics.mjs` bench on a debug flat plane:

| Test | Result |
|---|---|
| 0–60 mph | 4.05 s |
| 0–100 mph | 9.3 s |
| Top speed (gear-limited) | 152 mph |
| Steady-state lateral grip | 1.09–1.19 g from 12 to 50 m/s |
| Behaviour at full lock | Safe understeer |
| Lift-off oversteer | 3° → 16° slip |
| Handbrake flick at 20 m/s | 87° heading change |
| High-speed stability at 55 m/s | Fine |

**Problems**
1. Brake stabs and **mid-corner upshifts** made the autopilot crash in a few corners.
2. The car underside read as a black slab and the tyres were not readable.
3. The road's crack pattern looked like paving tiles, and square-pixel pebbles made "8-bit" speckle.
4. The autopilot could get pinned against a tree with the throttle held. That is a softlock.

**Changes**
- The gearbox holds gear above 0.55 g lateral.
- The limiter and shift torque cut are now partial (20–30%) instead of zero.
- Speed-dependent rear grip (0.97 → 1.05) so the car is playful at low speed and planted at 100+ mph.
- Countersteer assist now only acts on slip beyond 6°.
- Stuck detection auto-recovers after 5 s.
- Autopilot gets yaw-rate damping, a lateral-error term, signed bank in the speed plan, and smoother throttle.
- Car body raised 7 cm, red bumpers, and a smaller dark area underneath.
- Road cracks are subtler and pebbles are round.

**Result:** the autopilot run finished in 107.7 s with 1 auto-recovery (fast S-bend at 98 mph, and the off-camber right).

**Next:** autopilot reliability → a clean run; a dust/skid review in motion; a portrait capture; a HUD and camera comparison against the reference.

## Iteration 3: test suite, scenario captures, narrower road
**Evidence:**
- `scripts/capture.mjs` produced 16 named frames (`.cache/cap1`, `cap2`). I opened and reviewed every one.
- Playwright: first 6/9 passing, then 9/9.

**Problems found in the frames**
1. **Dust was invisible.** Particles only inherited 25% of the car's velocity, so they passed behind the chase camera within about 0.2 s.
2. The **TV cam** placed itself inside the forest and filmed tree trunks.
3. The **hood cam** sat inside the cabin, so 60% of the screen was black outline shells.
4. The **spawn** was right under the arch with the banner clipped, and the car was in reverse at the line because the settle loop held the brake.
5. Next to the reference ("Narrow Roads!") our road was about 14 m of tan surface, roughly 4 car widths. Too wide.

**Changes**
- Dust inherits 62–84% of car velocity and is thrown outward, so plumes linger near the wheels. They show clearly in `drift.png`.
- TV cam scores candidate spots by trunk clearance and corner curvature.
- Bonnet cam moved outside the cabin shell.
- Spawn is 16 m behind the arch with handbrake-only hold.
- Road narrowed to 7.8 m plus 2 m shoulders, with denser roadside trees.
- Car paint is now a clear-coat MeshPhysical reflecting a PMREM sky env map.

**Tests:**
- 9/9 pass. The test bugs were an ambiguous locator, too short a jump window, and a steering test that drove into a tree.
- Full drive: 90.9 s clean.

## Iteration 4: keyboard drivability + high-speed stability
**Evidence:** a keyboard-emulating bot (`DIGITAL=1`, on/off keys) spun at 94 mph.
- Trace (`scripts/trace-digital.mjs`): a full-lock tap still gave **8.8° of front-wheel angle at 100 mph**, about 12× what the corner needed.
- The countersteer assist then snapped the car back hard.

**Changes**
- High-speed lock falls to about 4.2° (smoothstep 18 → 50 m/s), and the steering rate slows 40% at speed.
- Drift stabiliser: yaw torque beyond 20° body slip.
- Softer countersteer assist (gain 0.5, max 16°).
- Yaw inertia raised to 2000, and high-speed rear grip to 1.10.
- Smaller first jump. It was about 1 s of air at 70 mph, against about 0.5 s in the reference.

**Bench (keyboard tests, flat plane)**
- Full lock held 1.2 s at 25 / 35 / 45 m/s: peak slip 10° / 9° / 7.6°. It settles 1.55 / 0.9 / 0.55 s after release.
- Left-right flick at 40 m/s: 7° peak, no spin.
- Low-speed fun is kept: lift-off 12.6°, handbrake flick 83°, power oversteer 11°.

**Result:**
- The keyboard bot completed the stage in **105.8 s with 0 recoveries**.
- The analog autopilot ran 90.7 s clean.

## Iteration 5: lake vista, fading skid marks, audio + perf evidence
- **Lake:** fills the designed valley below the downhill vista. PBR water reflects the sky env map, with ripple normals and a shore band. Trees are kept out.
  - The first two attempts were invisible in captures. The lake was hidden behind roadside forest and then capped too low by the road-height clamp.
  - I re-centred it on the bowl and opened the right side of the vista, so it is now glimpsed from the jump crest (`jump.png`).
- **Skid marks** now fade over about 40 s.
- **Audio:** `scripts/audio-check.mjs` renders the real worklet and filter graph offline.
  - No NaN, peak 0.68, RMS −20 dB (idle) to −13 dB (load).
  - Zero-crossing rate follows RPM (62 Hz at idle = 2× the 31.7 Hz firing rate).
  - A spectrogram shows the harmonic stack rising with RPM, dips on gear changes and crackle bursts on lift-off. I then reduced the combustion noise floor.
  - **Caveat:** I can't listen in this environment. The WAV is at `docs/audio/engine-sweep.wav` for a human ear.
- **Performance** (`scripts/perf.mjs`, 1920×1080, real-time loop, autopilot driving, RTX 3050 Laptop):
  - Frame rate: **125 fps average, 8.0 ms mean, 8.4 ms p95**, 15.8 ms p99.
  - One 84 ms first-view hitch. Textures are now pre-uploaded at load to avoid it.
  - About 940 draw calls and 2.0 M triangles per frame.
  - JS heap flat (122 → 118 MB) over 30 s.

## Iteration 6: presets, gamepad + 9:16 tests, camera look-ahead, UI review
- High / Medium / Low presets (pixel ratio, shadow map 4096/2048/1536, vegetation LOD 420/330/240 m). There is a one-step automatic downgrade under 42 fps.
- The camera glances into corners using yaw rate.
- Tests 10 and 11:
  - **Mocked gamepad**: a stick and triggers injected via `navigator.getGamepads` drive, steer and brake.
  - **9:16 preview**: canvas, buffer and camera aspect all equal 0.5625, so there is no stretching.
- UI captures from the normal boot path. The title screen is ready 4.8 s after navigation. Generation itself: terrain 1.07 s, meshes 0.9 s, forest 0.68 s.
- The backfire was a cone that read as a yellow map pin. It is now a flickering fireball sprite.

## Iteration 7: reference side-by-side and art-direction pass
**Evidence:** `screenshots/reference-comparison.jpg` (local only, git-ignored) puts four reference frames next to ours.

**Differences I observed**
1. Our foliage was a saturated kelly green. The reference is olive and grey-green.
2. **Our road shadows were dark brown, about 0.45× the lit road. The reference's are a light lavender-grey, about 0.7×.**
3. Distant forest was too crisp. The reference has stronger haze.
4. Our paint was slightly maroon with thin outlines.
5. The portrait camera pitched down 11°, putting the horizon at 37%. The reference is nearly level, with the horizon at about 46%.
6. Our road was too orange, and its crack cells looked like a regular tile grid.

**Changes**
- Olive palette for trees and grass.
- Hemisphere fill 1.55 → 2.2 with a lavender sky colour, and the sun 2.9 → 2.6.
- Fog density 0.00052 → 0.00068.
- Brighter red paint, outline width +30%.
- Computed a new portrait rig: 2.2 m high, 7 m back, aimed 7.5 m ahead at roof height.
- Creamier road palette, plus domain-warped two-scale Voronoi cracks.
- Taller broadleaf trees with long dark trunks.
- CSS transitions are disabled in test mode, so captures no longer ghost "GO!".

**Result**
- `portrait-compare` now matches the reference: horizon at about 45%, car centre at about 60%, about 33% of frame width.
- The banked-corner portrait reads like the reference's "banked corners" frame.
- 11/11 tests pass on both the dev server and the production build. The deterministic finish was 90.716 s on both.

## Iteration 8: dramatic jump, readable airtime, real spectators, livery
- **Evidence:** in `jump.png` the car didn't read as airborne. The chase cam rose with it.
- **Changes**
  - The second jump is bigger: about 1 s of air and 1.3 m clearance, measured.
  - The camera's vertical follow slows to k=0.7 on take-off and catches up after landing. The car now visibly climbs in frame (`.cache/jump2-test.png`).
  - The longer segment shifted downstream geometry, and the autopilot spun in flow2. I opened flow2 to R=230; it is still taken at 101 mph. The clean run is now 91.6 s.
- **Spectators**
  - The first version was broken: legs half underground and heads floating, because the helper treated `y` as the centre.
  - Rebuilt base-anchored: legs, jacket torso, shoulder-pivot arms (35% wave), heads and caps, all facing the road.
- **Livery:** a white/orange belt stripe and door number roundels. The roundel was half-buried in the body bulge, so I moved it out to x=0.892.
- **Tab handling:** the game auto-pauses when the tab is hidden.

## Iteration 9: rally set dressing (from the user's 16:9 screenshot + reference)
- Red/white spectator tape on posts in front of every crowd.
- Round hay bales on the outside of both hairpins.
- Log piles.
- The water tower moved inside the banked hairpin.
- All footprints are reserved before tree scattering.
- **Verified in close-ups:** tape sag, bales at the apex, logs by the start.

## Iteration 10: flags + title showroom
- The brief asked for "occasional flags". These are wind-animated cloth flags (vertex shader on the shared wind uniform): chequered at the finish, orange/white at the start, and coloured at alternate gates.
- **Title showroom**
  - The camera slowly orbits the parked car, with the menu card on the left and the car framed in the right half.
  - The first attempt aimed the wrong way (my perpendicular sign was flipped) and hid the car behind the card. Fixed, verified in `screenshots/ui-title.png`.
- 11/11 tests pass. The clean autopilot run is 91.6 s.

## Iteration 11: personal-best ghost
- Each run records its pose at 20 Hz from the physics state. A new PB stores it in localStorage as a base64 Float32Array, about 70 KB.
- The next attempt replays it as a translucent toon car (no outlines, no shadow) driven by race time. G toggles it.
- **Test:** `drive › personal best is saved and replayed as a ghost`. The ghost and the re-driven car are within 3 m at t=12 s.
- **Test-API bugs found on the way**
  - Autostart idle frames offset the first recording. The test now restarts first.
  - `setAutopilot(aggression)` didn't rebuild the speed plan. Fixed.
- Visual: `.cache/ghost.png` shows the ghost pulling ahead of a slower run, with the split delta +0.01 at gate 2.

## Iteration 12: quality-of-life
- U toggles MPH ↔ KM/H, persisted. Your 16:9 screenshot uses km/h, the reel uses MPH.
- F toggles fullscreen.
- The cursor is hidden while racing.
- After the finish line the camera cuts to a trackside TV shot while the car brakes, and is restored on restart or quitting to the title.
- New test: U toggles the speedometer unit. 13/13 pass.
