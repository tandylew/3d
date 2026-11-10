# Worml

A VR game for Meta Quest 3. Six elemental worlds circle one star; you fly between them, gather each world's essence, carry it to the world it overcomes, and unseal wormhole gates until the whole system is linked.

Worml is a WebXR game (three.js, no build step). It runs in the Meta Quest Browser straight from a URL, and in any desktop browser with mouse and keyboard.

## Play on a Quest 3

**From a URL (easiest).** Host this folder on any HTTPS static host, open the page in the Meta Quest Browser and press **Enter VR**. This repo's `gh-pages` branch is a static site, so once this folder is on that branch the game is at `https://<user>.github.io/<repo>/worml/`.

**From your computer over USB.** WebXR needs a secure origin, and `localhost` counts:

```sh
cd worml
npm start                          # serves http://localhost:8080
adb reverse tcp:8080 tcp:8080      # headset in developer mode, USB connected
```

Then open `http://localhost:8080/` in the Quest Browser.

**As an installed app.** The page ships a web app manifest, so it can be installed from the browser menu, or wrapped for the Meta Horizon Store with Meta's PWA tooling (Bubblewrap) later.

## Controls

| Quest Touch | Desktop | Action |
| --- | --- | --- |
| Trigger (either hand) | Mouse look + `W` / `S` | Fly where that hand points |
| Grip | `E` or left mouse | Draw in essence orbs; release essence at a sealed gate |
| Left stick | `A` / `D` | Walk, strafe |
| Right stick | `Space` / `C` | Snap turn; up / down |
| `A` / `X` | `F` | Change a wormhole's destination |

## The game

| World | Element | Gate is sealed by | Unsealed with |
| --- | --- | --- | --- |
| Thalassa | Water | (home gate, already open) | |
| Pyra | Fire | an undying firestorm | 5 Water |
| Ferrum | Metal | an iron shell | 5 Fire |
| Sylva | Wood | iron-thorn vines | 5 Metal |
| Petra | Earth | living stone | 5 Wood |
| Arcana | Magic | a void seal | 2 of each of the other five |

Every unsealed gate joins the wormhole network: step through a ring to arrive at another linked world instantly. Arcana needs all five elements, so the last leg is a tour of the network you built. Linking all six worlds wins. Progress saves in the browser.

## How the main pieces work

**Logarithmic flight** (`src/player.js`). Top speed is proportional to altitude above the nearest surface: `v = 26 m/s + 0.8/s × altitude`. Leaving a world you accelerate exponentially; arriving you decelerate the same way, so remaining distance shrinks by a constant ratio each second. Thalassa to Pyra is about 1,300 km and takes about 40 seconds, peaking near 400 km/s, and you still touch down at walking pace. Near a world the play space rolls upright so you land on your feet. A light aim assist bends your heading toward a far world you are roughly pointing at.

**One terrain system from orbit to ground** (`src/planet.js`, `src/terrainWorker.js`). Each world is a cube-sphere quadtree, 24 to 34 km in radius, refined down to about one-metre cells under your feet. Patches are generated in web workers from seeded simplex noise and swapped in only when ready, so there is no loading screen between space and surface and no frame hitching. The same height function runs on the main thread for collision (`src/worlds.js`).

**Floating origin.** The player's position is kept in double precision and the whole solar system is drawn relative to it, so the GPU only sees small numbers near the camera. That is what lets a 5,000 km wide system and a 3 cm controller coexist without jitter.

**Atmosphere.** An analytic scattering shell per world gives the limb glow from orbit and the sky from the ground with one shader, and the terrain shares its colour for aerial perspective, so descent is one continuous transition.

**Quest performance budget.** No post-processing, no shadows, no dynamic lights. Surface colour, glow and shine are baked per vertex by the worker; the terrain fragment shader does five texture reads. A ground-level view is roughly 100 to 140 draw calls and 180k to 240k triangles.

## Project layout

```
index.html            landing page, import map
src/main.js           renderer, XR session, main loop
src/game.js           quest logic, wormhole transits, save data
src/player.js         flight model
src/input.js          Touch controllers and desktop input
src/worlds.js         world definitions + terrain/colour functions
src/noise.js          seeded simplex noise
src/planet.js         quadtree LOD and patch streaming
src/terrainWorker.js  patch mesh generation
src/cubesphere.js     cube-sphere mapping shared with the worker
src/shaders.js        all GLSL
src/sky.js            nebula, stars, sun
src/gates.js          wormhole gates and their seals
src/essence.js        essence orbs
src/props.js          per-world scenery
src/hud.js            wrist display, prompts, world markers
src/fx.js             speed streaks, wormhole tunnel
src/audio.js          synthesised sound
vendor/               three.js r170 (MIT)
tools/                dev server and tests
```

## Tests

```sh
npm install        # only needed for the tests (XR emulator)
npm test           # scripted playthrough: gather, fly, unseal, wormhole, win
npm run test:xr    # same game inside an emulated Quest 3 WebXR session
```

Both run the real game in headless Chromium (Playwright must be available). `test:xr` uses IWER, Meta's WebXR emulator, to exercise session start, stereo rendering and Touch controller input.

## Known limits of this MVP

- Worlds do not rotate or orbit, so each gate sits in permanent daylight.
- You hover over liquids rather than swim; there are no hazards or enemies.
- Scenery is stylised low-poly, and there are no shadows.
- Not yet profiled on a physical headset. If frame rate dips, lower `MAX_LEVEL` or `GRID` in `src/planet.js` / `src/cubesphere.js` first.
