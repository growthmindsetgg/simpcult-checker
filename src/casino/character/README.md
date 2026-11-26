# Keone (character)

An original, stylised vinyl-toy caricature, built entirely in code. Fan art, not affiliated with Monad.

- **Original, built in code.** Every shape is a three.js primitive made at runtime: lathe profiles, capsules, spheres, tori, an extruded heart. There are no downloaded models, rigs, textures or photos, so no third-party asset licences apply.
- **Neutral trait list** (all a reference was used for): a broad, round, full face; short, thick, jet-black spiky hair pushed up and forward, with short sides; smallish relaxed eyes; straight dark brows; a short, broad nose; a small closed half-smile; faint stubble; warm light-tan skin; a plain black crew-neck tee, dark jeans and dark sneakers; a slightly stocky build. No photo is used as a texture or traced.
- **Lighting:** a soft warm point-light fill sits in front of and above the face, with a faint cool rim behind on the high tier. Both are parented to the chest so he reads true in the neon room.
- Simp Cult tie-in: a small pink heart pin on the chest.

## Files
- `Keone.tsx`: the R3F component. It implements `CharacterHandle` from `../contract`. Mount it directly under the scene root, because `ANCHORS` are scene coordinates.
- `build.ts`: builds the rig hierarchy and its meshes. Geometry is shared per quality tier and materials are shared across all instances.
- `controller.ts`: the per-frame pose composer and the actions. GSAP tweens plain numbers, and `update()` turns them into joint rotations.
- `ik.ts`: analytic two-bone IK, used for the legs at all times and for the right arm on the lever.
- `dims.ts`: body measurements, plus `PULL_TIMING` for syncing the cabinet's lever.

## Pull timing (for the cabinet)
`PULL_TIMING` in `dims.ts` holds the times in seconds from the `pullLever()` call:

| event | time (s) |
| --- | --- |
| hand closes on the ball | 0.12 |
| rides it down | 0 to 0.34 |
| lets go | 0.42 |
| promise resolves | 0.80 |

The ride matches `Cabinet3D.pullLever()`, which swings its own arm from t = 0 (smoothstep over 0.34 s, 0.18 to 2.6 rad, ball 0.19 m from the pivot), so both calls should start together. The hand follows that exact arc (`LEVER_*` in `dims.ts`).

## Lab
`/lab/keone` is dev only. `window.__keone` exposes `{ handle, ctl, gsap }`, and `ctl.debug` reports the lever reach, stretch and miss, plus planted-foot drift.
