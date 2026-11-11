# Worml

A VR game for Meta Quest 3. Six elemental worlds circle one star; you fly between them, gather each world's essence, carry it to the world it overcomes, and unseal wormhole gates until the whole system is linked.

Worml is a WebXR game (three.js, no build step). It runs in the Meta Quest Browser straight from a URL, in any desktop browser with mouse and keyboard, and on phones and tablets with touch controls.

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

| Quest Touch | Desktop | Phone / tablet | Action |
| --- | --- | --- | --- |
| Trigger (either hand) | Mouse look + `W` / `S` | Drag to look + **FLY** | Fly where you point or look |
| Grip | `E` or left mouse | **GATHER** | Draw in essence orbs; release essence at a sealed gate |
| Left stick | `A` / `D` | Left thumb stick | Walk, strafe |
| Right stick | `Space` / `C` | **▲** / **▼** | Snap turn (VR); up / down |
| `A` / `X` | `F` | **GATE** | Change a wormhole's destination |

On a touch screen the stick appears wherever your left thumb lands; dragging anywhere else turns the view. Render resolution adapts automatically to hold frame rate on flat screens.

## Dev dashboard

Open it with the **DEV** button (top right while playing), the **Dev dashboard** button on the title screen, the `` ` `` key, or by adding `?dev` to the URL. It works on desktop, phones and the Quest Browser's 2D page.

- **Telemetry**: world, altitude, speed and speed limit, sun elevation, frame time, draw calls, triangles, terrain queue, render resolution.
- **Warp**: pick a world, then a place: gate, essence grove, shore, summit, sunset, night side, above the clouds, low orbit, far view. Also the sun, a system overview and deep space. To judge a spot in the headset, warp there and use "enter VR from here".
- **Control demos**: the game plays itself (take off and land, walk and hover, gather essence, unseal a gate, ride a wormhole, fly to another world) and names the control it is using on Quest, keyboard and touch.
- **Quest**: unseal the next gate or all of them, fill or empty essence, reset.
- **Look and flight tuning**: exposure, sun angle (lighting preview), cloud cover, render scale, flight speed constants, and toggles for clouds, atmosphere, scenery, markers and wireframe.
- **Controls and live input**: the mapping table plus live bars for what the game is receiving.

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

**Atmosphere and weather.** An analytic scattering shell per world gives the limb glow from orbit and the sky from the ground with one shader. Haze is height-aware (valleys fill, peaks stay clear) and sunlight warms and dims toward the horizon. Each world has a drifting cloud layer: coverage comes from a noise cube map baked once at startup, so clouds are seamless from orbit to ground, and the same lookup casts cloud shadows on terrain and scenery.

**Surfaces.** The worker bakes natural albedos per vertex (grass, wet sand, basalt, sandstone). The fragment shader adds what makes them read as real: rock breaking through on steep ground along a ragged per-pixel line, strata that follow true altitude, grain, damp sand and foam at the waterline, Fresnel sky reflection and a distance-aware sun glint on water, and crusted lava with glowing cracks. Scenery is built from noise-shaped lumps, tapered limbs and leaf strips with smooth normals, baked occlusion and light through foliage.

**Performance budget.** No post-processing, no shadow maps, no dynamic lights. The terrain fragment shader does six 2D texture reads and one cube read. A ground-level view is roughly 80 to 130 draw calls and 250k to 350k triangles. None of this has been profiled on a physical headset yet; the dashboard's toggles and render scale are there to find out what a device can afford.

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
src/sky.js            nebula, stars, sun, cloud noise bake
src/gates.js          wormhole gates and their seals
src/essence.js        essence orbs
src/props.js          per-world scenery
src/hud.js            wrist display, prompts, world markers
src/fx.js             speed streaks, wormhole tunnel
src/audio.js          synthesised sound
src/touch.js          on-screen stick and buttons
src/dev.js            developer dashboard: warps, demos, tuning
vendor/               three.js r170 (MIT)
tools/                dev server and tests
```

## Tests

```sh
npm install        # only needed for the tests (XR emulator)
npm test           # scripted playthrough: gather, fly, unseal, wormhole, win
npm run test:xr    # same game inside an emulated Quest 3 WebXR session
npm run test:ui    # phone touch controls, every dashboard warp, all control demos
```

All three run the real game in headless Chromium (Playwright must be available). `test:xr` uses IWER, Meta's WebXR emulator, to exercise session start, stereo rendering and Touch controller input.

## Known limits of this MVP

- Worlds do not rotate or orbit, so each gate sits in permanent daylight.
- You hover over liquids rather than swim; there are no hazards or enemies.
- Clouds cast shadows; terrain and scenery do not shadow each other. Clouds are a single thin layer, so flying through it shows no volume.
- The dev dashboard is a 2D page overlay and is not visible inside VR; warp first, then enter VR.
- Not yet profiled on a physical headset. If frame rate dips, try the dashboard toggles first (clouds, scenery), then lower `MAX_LEVEL` or `GRID` in `src/planet.js` / `src/cubesphere.js`.
