# Final review: Timberline Rally vertical slice

**Test machine:** Windows 11 Home, NVIDIA RTX 3050 Laptop GPU (4 GB), Ryzen 7 7435HS, Chrome 155 via Playwright (headless, GPU through ANGLE/D3D11, verified with `scripts/probe-gpu.mjs`).

**Reference:** `hardpack_rally_reference_pack/reference/rally_reference.mp4` (720×1280, 20.5 s). I studied it through extracted stills and dense contact sheets; see `docs/REFERENCE_BREAKDOWN.md`.

## What was achieved
- **A real-time 3D rally game.**
  - One stage: "Black Pine Ridge". It is 3.1 km with 20 gates and a timed finish.
  - Features along it: a fast opening, a 240 m sweeper, a crest jump into a downhill vista over a lake, S-bends, a 15° banked 150° right-hander with a cut bank, an uphill shadow-striped straight, a second crest, fast flowing bends, two tight hairpins, an off-camber right and a fenced finish straight.
- **Custom vehicle physics** (`src/vehicle/VehicleSim.ts`).
  - Rigid body: 6-DOF at 240 Hz. Four raycast suspensions with bump/rebound damping, anti-roll bars and bump stops.
  - Tyres: load-sensitive, with a slip-angle curve and a friction ellipse with longitudinal priority. Grip depends on the surface (hardpack, shoulder, grass) and grass adds drag.
  - Drivetrain: AWD with a 36/64 split, torque curve, 5-speed auto box (holds gear mid-corner), launch clutch, rev limiter, engine braking and reverse.
  - Aero drag and downforce.
  - Contacts: body-ground penalty contacts and trunk/post impulse collisions with height checks.
  - Arcade assists: speed-sensitive steering, a countersteer bias and a drift stabiliser beyond 20° of slip.
- **Art.** Everything is procedural and original:
  - The car is a lofted cel-shaded coupe with ink outlines, clear-coat paint reflecting the sky, inset glass, wing, tail-lamp bar, plate, flares, mud flaps and steering/spinning wheels.
  - The forest is instanced and faceted, with 5 tree species plus bushes, tufts and rocks, and an LOD system.
  - Terrain is flat-shaded with cut banks; the far ring has mountains.
  - The road shader draws domain-warped cracked hardpack with tyre lines, a gravel windrow and sandy shoulders.
  - The sky has a sun glow and clouds, plus aerial-perspective fog.
  - The lake reflects the sky.
  - Props: gates, start/finish arches, chevrons, fences, cabins, a water tower and spectators.
- **Feel and presentation.**
  - Chase camera with velocity-weighted yaw (drifts show the car's flank), corner look-ahead, airborne lag, speed FOV and impact shake. Bonnet and TV cameras are also available.
  - Dust plumes, fading tyre marks, brake lights and a backfire flash.
  - Procedural AudioWorklet engine (firing-pulse model) plus gravel, scrub, wind, impacts and UI tones.
  - Compact HUD: timer, gate X OF 20, route preview, split popups with deltas to PB, tach arc with gear, MPH, odometer and input bars.
  - Title, countdown, pause (with quality setting), results with splits, and a saved personal best.
  - 9:16 preview mode. Gamepad support.
- **Automation.**
  - Deterministic test API (`?test=1`).
  - Autopilot through the player input path, including a keyboard-emulation mode.
  - 11 Playwright tests.
  - Scenario capture, demo recorder, dynamics bench, perf probe and offline audio render.

## Quality gates (with evidence)
| Gate | Status | Evidence |
|---|---|---|
| Starts reliably | **Pass** | `smoke › title screen`. `capture-ui.mjs` reaches the title in 4.8 s with 0 console errors |
| Natural movement, both steering directions, braking, handbrake | **Pass** | `smoke › throttle, steering both ways, braking and handbrake`; bench: 0–60 4.0 s, 1.1–1.2 g lateral, 60–0 in 2.6 s |
| Drift and recovery | **Pass** | Scripted handbrake entry holds 22–24° slip (`screenshots/drift*.png`). Keyboard full-lock tests settle 0.55–1.55 s after release with no spins |
| Suspension follows terrain; jump and landing | **Pass** | `drive › jump`: airborne more than 0.3 s and lands upright. Full run max air 0.76 s, min clearance +0.38 m |
| Banked corners without clipping | **Pass** | `drive › banked corner`: car rolls more than 9° with the 15° bank, clearance stays above −0.2 m, holds the line within 5 m |
| Meaningful off-road | **Pass** | `smoke › off-road grass`: grass reported and decelerates at least 1.3× harder than road (grip 0.78 vs 1.18, plus drag) |
| Recovery | **Pass** | `smoke › recovery` (manual R). Auto-recovery covers off-stage beyond 38 m for 3 s, upside-down, and stuck for 5 s |
| 20 functional gates in order, timed finish | **Pass** | `drive › autopilot completes all 20 gates`: gates only ever advance by one. Finish 90.716 s, identical on dev and prod builds |
| Forest richness, shoulders, background, sun and shadows | **Pass** | `screenshots/*.png`, reference side-by-side (local `screenshots/reference-comparison.jpg`) |
| No obvious seams | **Pass (visual)** | None seen in 23 reviewed captures. The near/far terrain boundary is 300 m from the road and hidden by skirts |
| Car modelled convincingly | **Pass** | `car-rear34.png`, `car-side.png`, `car-front34.png` |
| Camera like the reference | **Pass** | Portrait comparison: horizon about 45%, car centre about 60%, car about 33% of frame width (reference about 46% / 59% / 33%) |
| Skid and dust | **Pass** | `drift.png`, `offroad.png` |
| HUD: speed, gear, time, gates; pause, restart, finish usable | **Pass** | `ui-*.png`, `finish.png` (results with 20 splits), `smoke › pause, resume and restart` |
| Automation: smoke + full-stage drive, screenshots in motion, console checked | **Pass** | 11/11 Playwright tests on the dev server and on `vite preview` of `dist/`. Every spec asserts zero console errors |
| Performance | **Pass (measured)** | `perf.mjs` at 1920×1080: **122 fps average, 8.2 ms mean, p95 14.9 ms, p99 15.9 ms**, about 940 draw calls and 1.9 M triangles. Heap flat over 30 s |
| 9:16 preview, undistorted | **Pass** | `smoke › 9:16 preview`: canvas, buffer and camera aspect are all 0.5625. `portrait-preview.png`, `portrait-banked.png` |
| Production build | **Pass** | `npm run build` (tsc + vite) gives `dist/` (678 kB JS, 182 kB gzipped). The test suite passes against the served build |
| Audio | **Partial** | It renders and is analysed offline: no NaN or clipping, and the harmonics follow RPM (`docs/audio/engine-sweep.wav`). **Not verified by ear**: I can't listen in this environment |

## Tests run (final)
- `npx playwright test`: **11 passed** on the dev server and on the production build.
  - The full-stage drive finishes in 90.716 s with 0 recoveries, max lateral 4.27 m and 0.76 s max air.
- Keyboard-emulation bot: completes the stage in 105.8 s with 0 recoveries.
- `scripts/dynamics.mjs`: see the iteration 4 numbers in `docs/ITERATION_LOG.md`.

## Rough self-assessment
Weighted by the brief's rubric. These are my estimates, not a measurement:
- Visual resemblance: about 70% of the reference's polish.
- Driving feel: about 70%. The bench and bot data are good, but **no human has played it yet**.
- Track: about 70%.
- Camera, HUD and sound: about 75%.
- Stability and performance: about 90%.

**Overall roughly 72/100 against a finished commercial reference.**

## Known limitations (candid)
1. **Handling has not been tuned by a human hand.** Every number comes from benches and bots. Real players may want a different steering speed or assist strength. These are all in `src/vehicle/VehicleParams.ts`.
2. **Audio is unheard.** It is a physically motivated synth and analyses as plausible, but it may sound buzzy or synthetic. There is no tyre-squeal sample, and the gravel noise is generic.
3. The car is simpler than the reference's. There are no livery stickers or panel lines, and the wheel and tyre detail is basic.
4. Spectators are blocky figures.
5. The lake is only glimpsed from the vista.
6. The stage is about 90 s long, while the reference's appears longer. There are no pace notes or co-driver calls.
7. Shadows reach only about 85 m (one 4096 map, no cascades). About 940 draw calls could be reduced by merging vegetation chunks.
8. World generation (about 2.7 s) runs on the main thread behind a loading bar, with no Web Worker.

## Exact next 3 improvements
1. **Human playtest pass + co-driver pace notes.** Tune `steerRate`, `countersteerGain`, `stabiliseSlip` and `rearGripHigh` with real players. Add audio/visual calls ("6 left over crest") generated from track curvature, which also helps readability at 100+ mph.
2. **Car and crowd detail.** Livery decals (canvas texture), panel-line outlines, proper tyre sidewalls and rim dish, headlight pods. Articulated low-poly spectators who react to the car.
3. **Rendering efficiency and reach.** Two-cascade shadows, merging vegetation per chunk into a single multi-draw, and moving world generation into a Web Worker to cut load time and draw calls.
