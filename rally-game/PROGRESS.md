# PROGRESS: Timberline Rally (vertical slice)

## Status (latest)
- Playable: showroom title → countdown → 20-gate timed stage → TV-shot finish → results with PB and splits. A PB ghost appears on later runs.
- 13/13 Playwright tests pass on the dev server and on the production build. The deterministic autopilot finishes in 91.605 s.
- 15 iterations are logged in `docs/ITERATION_LOG.md`.
- Final review: `docs/FINAL_REVIEW.md`. History: `docs/ITERATION_LOG.md`.
- Deliverables:
  - `screenshots/`: 23 real captures from the production build.
  - `demo.mp4`: about 94 s of real gameplay, local and git-ignored at 60 MB.
  - `docs/media/highlight.mp4`: 16 s clip.
  - `dist/`: after `npm run build`.

## How to resume
1. `cd rally-game && npm install && npm run dev`. The dev server runs on http://127.0.0.1:5173. Repo root `.claude/launch.json` has the `rally-dev` config.
2. `?test=1&seed=123` gives deterministic automation: autostart, no audio, `window.__RALLY__` and `window.game`.
3. The scripts in `scripts/` need the dev server. Set `RALLY_URL` to target `vite preview` on :4173.
   - Every change to physics: `node scripts/dynamics.mjs`, then `npm run test:drive`.
   - Every visual change: `node scripts/capture.mjs .cache/capN 1600 900`, then open and review the frames.
   - Before committing: `npm test` and `npm run build`.
4. Reference material is local only and git-ignored. The extracted frames are in `rally-game/reference/`. Regenerate them with ffmpeg from `hardpack_rally_reference_pack/reference/rally_reference.mp4`.

## Architecture (src/)
- `track/`
  - `stageDesign.ts`: turtle segments (straights and arcs with rise, bank, width, jumps).
  - `Track.ts`: smoothed curvature integration, 1 m stations, cross-section profile, spatial-grid projection.
- `world/`
  - `TerrainField.ts`: analytic height function plus a 2.5 m grid. Physics samples the exact rendered triangles off-road and the analytic road profile on-road. It also holds the lake.
  - `TerrainMesh.ts`: chunks plus a far ring.
  - `RoadMesh.ts`: ribbon with a procedural cracked-hardpack shader.
  - `Vegetation.ts` and `TreeGeometry.ts`: instanced, chunked, LOD, collision hash.
  - `Props.ts`: gates, arches, chevrons, spectators, fences, tower, cabins.
  - `Sky.ts`, `Atmosphere.ts` (global fog chunk override), `Water.ts`.
- `vehicle/`
  - `VehicleSim.ts`: physics.
  - `VehicleParams.ts`: all tuning.
  - `CarModel.ts`: procedural toon car with outlines.
- `camera/ChaseCamera.ts`: chase, bonnet and TV cameras.
- `vfx/Effects.ts`: dust and fading skid marks.
- `audio/AudioEngine.ts`: `createEngineVoice` worklet synth plus layers.
- `ui/`: HUD and menus.
- `game/`: Game loop and state machine, Input, Storage (PB, settings, quality).
- `testing/`: Autopilot (analog plus keyboard emulation), TestApi.

## Next tasks (top first)
See "Exact next 3 improvements" in `docs/FINAL_REVIEW.md`:
1. Human playtest tuning plus pace notes.
2. Car and crowd detail.
3. Cascaded shadows, fewer draw calls, worker-based generation.

## Known blockers
None. Audio can't be judged by ear here, only through offline analysis.
