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
