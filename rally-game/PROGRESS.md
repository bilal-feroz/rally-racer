# PROGRESS: Timberline Rally (vertical slice)

## How to resume
- The project lives in `rally-game/`. Run `npm install` there. `npm run dev` serves on http://127.0.0.1:5173.
- `.claude/launch.json` at the repo root has a `rally-dev` config.
- Debug and test mode: `?test=1&seed=123` autostarts the race with no audio and exposes `window.__RALLY__` and `window.game`.
- Scripts in `scripts/`. They need the dev server running and use system Chrome on the real GPU.

| Script | What it does |
|---|---|
| `explore.mjs [secs] [shotEvery] [dir]` | Autopilot run with a telemetry log and screenshots |
| `segment.mjs s0 speed secs [dir]` | Teleports to a station and logs fine telemetry |
| `dynamics.mjs` | Flat-plane handling bench (accel, braking, ramp steer, step steer, lift-off, handbrake, power oversteer) |
| `debug-nan*.mjs` | Physics blow-up tracing |

- Logs and docs: `docs/ITERATION_LOG.md` (history) and `docs/REFERENCE_BREAKDOWN.md` (the reference checklist).

## Architecture (src/)
- `track/`
  - `stageDesign.ts`: turtle segments (straights and arcs with rise, bank, width, jumps).
  - `Track.ts`: smoothed curvature integration, 1 m stations, cross-section profile, spatial-grid projection.
- `world/`
  - `TerrainField.ts`: the analytic height function plus a 2.5 m grid. Physics samples the exact rendered triangles off-road and the analytic road profile on-road.
  - `TerrainMesh.ts`: chunks plus a far ring.
  - `RoadMesh.ts`: ribbon with a procedural hardpack shader.
  - `Vegetation.ts` and `TreeGeometry.ts`: instanced, chunked, LOD.
  - `Props.ts`: gates, arches, chevrons, spectators, fences, tower, cabins.
  - `Sky.ts` and `Atmosphere.ts`: sky dome, plus a global fog chunk override for aerial perspective.
- `vehicle/`
  - `VehicleSim.ts`: custom 6-DOF rigid body at 240 Hz with 4 raycast suspensions, ARBs, a load-sensitive tyre model with friction ellipse, drivetrain, auto gearbox, aero, body-ground penalty contacts, and trunk impulses.
  - `VehicleParams.ts`
  - `CarModel.ts`: lofted toon car with inverted-hull outlines.
- `camera/ChaseCamera.ts`: chase cam (velocity-weighted yaw), hood cam and TV cam.
- `vfx/Effects.ts`: dust billboards and skid marks.
- `audio/AudioEngine.ts`: worklet engine plus noise layers.
- `ui/`: HUD and menus.
- `testing/`: autopilot and test API.
- `game/`: game loop, state machine, input and storage.

## Current state
See the latest entry in `docs/ITERATION_LOG.md`.

## Next tasks (top first)
1. A clean autopilot full run (no recoveries) to use as the regression test.
2. Playwright specs: `tests/smoke.spec.ts` and `tests/drive.spec.ts`, plus `scripts/capture.mjs` for named screenshots.
3. Visual polish passes against the reference (car underside/tyres, dust density, grass tone).
4. Docs: README, FINAL_REVIEW.

## Known blockers
- None. Audio can't be verified by ear in this environment; levels are reasoned, not heard.
