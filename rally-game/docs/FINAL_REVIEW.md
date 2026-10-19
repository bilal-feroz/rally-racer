# Final review: Timberline Rally vertical slice

**Test machine:** Windows 11 Home, NVIDIA RTX 3050 Laptop GPU (4 GB), Ryzen 7 7435HS, Chrome 155 via Playwright (headless, GPU through ANGLE/D3D11, verified with `scripts/probe-gpu.mjs`).

**Reference:** `hardpack_rally_reference_pack/reference/rally_reference.mp4` (720×1280, 20.5 s). I studied it through extracted stills and dense contact sheets; see `docs/REFERENCE_BREAKDOWN.md`. Your 16:9 screenshot of the same game also informed the props.

## What was achieved (15 build → play → review iterations; see `docs/ITERATION_LOG.md`)
- **A real-time 3D rally game.**
  - One stage: "Black Pine Ridge". It is 3.1 km with 20 gates and a timed finish.
  - Features along it: a fast opening, a 240 m sweeper, a crest jump into a downhill vista over a lake, S-bends, a 15° banked 150° right-hander with a cut bank and a water-tower landmark, an uphill shadow-striped straight, a second crest with about 1 s of air, fast flowing bends, two tight hay-baled hairpins, an off-camber right and a fenced finish straight.
- **Custom vehicle physics** (`src/vehicle/VehicleSim.ts`).
  - Rigid body: 6-DOF at 240 Hz. Four raycast suspensions with bump/rebound damping, anti-roll bars and bump stops.
  - Tyres: load-sensitive, with a slip-angle curve and a friction ellipse with longitudinal priority. Grip depends on the surface (hardpack, shoulder, grass) and grass adds drag.
  - Drivetrain: AWD with a 36/64 split, torque curve, 5-speed auto box (holds gear mid-corner), launch clutch, soft limiter, engine braking and reverse.
  - Aero drag and downforce.
  - Contacts: body-ground penalty contacts and trunk/post impulse collisions with height checks.
  - Assists, switchable between *arcade* and *pro*: speed-sensitive steering, a countersteer bias, a drift stabiliser beyond 20° of slip, and a handbrake turn-in torque.
- **Art.** Everything is procedural and original:
  - The car is a lofted coupe with ink outlines, clear-coat paint reflecting the sky, inset glass, wing, tail-lamp bar, plate, flares, mud flaps, livery stripe, door numbers and steering/spinning wheels.
  - The forest is instanced and faceted, with 5 tree species plus bushes, tufts and rocks, and an LOD system with wind sway.
  - Terrain is flat-shaded with cut banks; the far ring has mountains.
  - The road shader draws domain-warped cracked hardpack with tyre lines, a gravel windrow and sandy shoulders.
  - The sky has a sun glow and clouds, plus aerial-perspective fog.
  - The lake reflects the sky.
  - Props: gates, start/finish arches, chevrons, fences, cabins, log piles, hay bales, wind-animated flags, and spectators (some waving) behind red/white tape.
- **Feel and presentation.**
  - Chase camera with velocity-weighted yaw (drifts show the car's flank), corner look-ahead, take-off lag so jumps read, foliage avoidance, speed FOV and impact shake. Bonnet and TV cameras are also available, and the finish line cuts to a TV shot.
  - Dust plumes and landing bursts, fading tyre marks, brake lights and backfire flashes.
  - Procedural AudioWorklet engine (firing-pulse model) plus a turbo spool and blow-off, gravel, scrub, wind, impacts and UI tones.
  - Compact HUD: timer, gate X OF 20, route preview, split popups with deltas to PB, tach arc with gear, MPH or KM/H, odometer and input bars.
  - Showroom title screen, countdown, pause menu (quality, assists, camera, mute), results with 20 splits, saved personal best, a **local top-5 leaderboard** and a **PB ghost car**.
  - 9:16 preview mode. Gamepad support. Auto-pause when the tab is hidden.
- **Automation.**
  - Deterministic test API (`?test=1`).
  - Autopilot through the player input path, including a keyboard-emulation mode.
  - **13 Playwright tests.**
  - Scenario capture, demo recorder, dynamics bench, perf probe and offline audio render.

## Quality gates (with evidence)
| Gate | Status | Evidence |
|---|---|---|
| Starts reliably | **Pass** | `smoke › title screen`. The normal boot reaches the title in about 5 s. A full keyboard session sweep showed 0 errors (the only warning was a benign ANGLE HLSL note from Three.js's own shadow shader; shader logs are now off outside debug) |
| Natural movement, both steering directions, braking, handbrake | **Pass** | `smoke › throttle, steering both ways, braking and handbrake`; bench: 0–60 4.0 s, 1.1–1.2 g lateral, 60–0 in 2.6 s |
| Drift and recovery | **Pass** | Scripted handbrake entry holds 22–24° slip (`screenshots/drift*.png`). Handbrake flicks give 25° at 67 mph and 23° at 90 mph with no spins. Keyboard full-lock tests settle 0.5–1.5 s after release |
| Suspension follows terrain; jump and landing | **Pass** | `drive › jump`: airborne more than 0.3 s and lands upright. Full run max air 0.97 s, min clearance +0.30 m (`jump-2.png`) |
| Banked corners without clipping | **Pass** | `drive › banked corner`: rolls more than 9° with the 15° bank, clearance stays above −0.2 m, holds the line within 5 m |
| Meaningful off-road | **Pass** | `smoke › off-road grass`: grass reported and decelerates at least 1.3× harder than road (grip 0.78 vs 1.18, plus drag) |
| Recovery | **Pass** | `smoke › recovery` (manual R). Auto-recovery covers off-stage beyond 38 m for 3 s, upside-down, and stuck for 5 s |
| 20 functional gates in order, timed finish | **Pass** | `drive › autopilot completes all 20 gates`: gates only ever advance by one. Finish 91.605 s, identical on dev and prod builds |
| Forest richness, shoulders, background, sun and shadows | **Pass** | `screenshots/*.png`, reference side-by-side (local, git-ignored `screenshots/reference-comparison.jpg`) |
| No obvious seams | **Pass (visual)** | None seen in the 23 final captures or about 150 review frames |
| Car modelled convincingly | **Pass** | `car-rear34.png`, `car-side.png`, `car-front34.png`, `ui-title.png` |
| Camera like the reference | **Pass** | Portrait comparison: horizon about 45%, car centre about 60%, car about 33% of frame width (reference about 46% / 59% / 33%) |
| Skid and dust | **Pass** | `drift.png`, `offroad.png` |
| HUD: speed, gear, time, gates; pause, restart, finish usable | **Pass** | `ui-*.png`, `finish.png`, `smoke › pause, resume and restart`, `smoke › U toggles MPH / KM/H` |
| Automation: smoke + full-stage drive, screenshots in motion, console checked | **Pass** | **13/13** on the dev server and on `vite preview` of `dist/`. Every spec asserts zero console errors |
| Performance | **Pass (measured)** | `perf.mjs`, production build, 1920×1080, real-time loop with the autopilot driving: **121 fps average, 8.2 ms mean, p95 15.1 ms, p99 16.0 ms**, about 980 draw calls and 1.9 M triangles. Heap flat. Presets plus auto-downgrade cover weaker GPUs (untested on one) |
| 9:16 preview, undistorted | **Pass** | `smoke › 9:16 preview`: canvas, buffer and camera aspect are all 0.5625. `portrait-preview.png`, `portrait-banked.png` |
| Production build | **Pass** | `npm run build` (tsc + vite) gives `dist/` (692 kB JS, 186 kB gzipped). The suite passes against the served build |
| Audio | **Partial** | It renders and is analysed offline: no NaN or clipping, and the harmonics follow RPM (`docs/audio/engine-sweep.wav`). **Not verified by ear**: I can't listen in this environment |

## Tests run (final)
- `npx playwright test`: **13 passed** on the dev server and on the production build.
  - The full-stage drive finishes in 91.605 s with 0 recoveries, max lateral 4.54 m and 0.97 s max air.
  - The PB ghost replays within 3 m of a deterministic re-run.
- Keyboard-emulation bot (bang-bang keys, no handbrake): completes in 116.0 s with 0 recoveries.
- `scripts/dynamics.mjs` and the high-speed drift bench: numbers are in `docs/ITERATION_LOG.md` iterations 2, 4 and 13.

## Rough self-assessment
Weighted by the brief's rubric. These are my estimates, not a measurement:
- Visual resemblance: about 72% of the reference's polish.
- Driving feel: about 72%. The bench and bot data are good, but **no human has played it yet**.
- Track: about 72%.
- Camera, HUD and sound: about 78%.
- Stability and performance: about 90%.

**Overall roughly 75/100 against a finished commercial reference.**

## Known limitations (candid)
1. **Handling has not been tuned by a human hand.** Every number comes from benches and bots. All tuning is in `src/vehicle/VehicleParams.ts`, and the pause menu offers *pro* assists for players who want a raw car.
2. **Audio is unheard.** It is a physically motivated synth and analyses as plausible, but it may sound buzzy or synthetic. There is no tyre-squeal sample, and the gravel noise is generic.
3. The car is simpler than the reference's (no panel lines or sponsor decals; basic tyres), and the spectators are simple low-poly figures.
4. The lake is a glimpse from the vista rather than a centrepiece.
5. The stage is about 92 s long, while the reference's appears longer. There are no pace notes or co-driver calls.
6. Shadows reach only about 85 m (one 4096 map, no cascades). About 980 draw calls could be reduced by merging vegetation chunks.
7. World generation (about 2.7 s) runs on the main thread behind a loading bar.
8. The full `demo.mp4` (61 MB) is local only. The repo has `docs/media/highlight.mp4`.

## Exact next 3 improvements
1. **Human playtest pass + co-driver pace notes.** Tune `steerRate`, `countersteerGain`, `stabiliseSlip`, `rearGripHigh` and `handbrakeYaw` with real players. Add audio/visual calls ("6 left over crest") generated from track curvature, which helps readability at 100+ mph.
2. **Car detail and audio realism.** Panel lines and sponsor decals, proper tyre sidewalls and rim dish. A sampled or granular engine layer and gravel-crunch transients, judged by ear.
3. **Rendering efficiency and reach.** Two-cascade shadows, merging vegetation per chunk into a single multi-draw, and moving world generation into a Web Worker to cut load time and draw calls.
