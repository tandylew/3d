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

| | Quest Touch | Desktop | Phone / tablet |
| --- | --- | --- | --- |
| Fly | Trigger: fly where that hand points | `F` toggles flight, then `W` flies where you look | **FLY** toggles flight, then the left stick |
| Walk / strafe | Left stick | `W A S D` | Left stick |
| Look / turn | Head; right stick snap-turns | Mouse | Right stick |
| Super leap | `A` or `X` | `Space` | **LEAP** |
| Cast your element | Hold right grip to charge, release to throw | Hold left click (or `X`), release | Hold **CAST**, release |
| Use the time relic | Left grip, aimed with that hand | `E` or right click | **TIME** |
| Switch relic | `B` | `Q`, wheel, `1`-`4` | **⟳** |
| Objectives | `Y` (on the left wrist) | `H` | **◎** |

There is no gather button and no gate button: you gather essence by moving into it, and a gate's two faces decide where it leads. The objectives panel is hidden until you ask for it. A slim strip (health, essence carried, relic) appears only when something changes. Render resolution adapts to hold frame rate on flat screens.

With flight off you walk, and sink if you are in the air. With flight on you hover and "forward" means along where you look. A super leap is about six seconds of full climb leaning the way you look: one leap from the ground reaches a few kilometres, and each further leap in the air multiplies your height. Inside a world, a leap rides you up the shaft to the wellhead.

## The game

**Essence is your power.** Every world has eight essence deposits spread over the whole globe. Move into the orbs and they fly to you. You carry up to 12 of each element, and each cast spends one.

**Finding your way.** There is one beacon per world: the pillar of light over its wellhead. Everything else is found three ways:

- **Streams.** A glowing stream of essence runs from every deposit to the wellhead, and a pale gold one from the world's time anomaly. Follow any stream upstream from the well and you arrive at its source. They meander like rivers, widen with distance so you can follow them from the air, and from orbit they are bright threads converging on the well.
- **Radar.** A small disc (bottom centre on phones, top left on desktop, on the left wrist in VR) shows what lies around you. Up is the way you face and distance is logarithmic, so the far side of the world still fits. Ring: the well. Dots: deposits (hollow if buried, dim if spent), joined to the well by their streams. Diamond: the time anomaly. Red: guardians hunting you. A gold circle marks your current objective.
- **The world itself.** Each deposit sits in a ringed crater veined with light, the cloud deck opens in a clear eye above it (a ring of cloud from orbit), and guardians patrol it.

**Casting takes timing and aim.** Hold the cast control and a charge gathers at your hand. About 0.7 s in, the orb flashes white and a chime sounds: release inside that quarter-second window for a **perfect cast** (roughly three times the force of a tap, twice the speed, and it punches through its first target). Release early and you get a weaker bolt; hold past the flash and the charge sours. A bolt through a guardian's **head** hits 1.6 times as hard. A perfect cast at a seal counts double. Casts are not homing: you lead a moving target yourself.

**Guardians** are made of their world's element and walk on jointed legs (four or six, depending on the world), feet planted on the actual ground. They patrol their deposit, run you down, crouch and pounce, rear up to spit bolts, and may spring aside from a bolt they see coming, which is why the fast perfect cast matters. If you take to the air they launch after you, legs trailing. They have health bars and are weak to the element that overcomes theirs (water douses fire, fire melts metal, metal cuts wood, wood breaks earth, earth dams water); the right element is chosen for you if you carry it. A fallen guardian leaves a mote of its own element. If you fly away, up to six will chase you through open space under the same speed rule you fly by. Only a wormhole shakes them.

**Health.** You have 100. After five seconds without being hit you mend quickly. At zero you are unmade: half your essence scatters and you reform at the wellhead of the world you were on.

**Wells, seals and cores.** Each world's wormhole gate hangs at its very centre, in a hollow geode core. A wellhead on the surface marks the shaft down to it. Every well but Thalassa's is capped by a seal; cast the element that overcomes it at the seal to break it.

| World | Element | Well is sealed by | Broken with |
| --- | --- | --- | --- |
| Thalassa | Water | (home, already open) | |
| Pyra | Fire | an undying firestorm | 5 Water |
| Ferrum | Metal | an iron shell | 5 Fire |
| Sylva | Wood | iron-thorn vines | 5 Metal |
| Petra | Earth | living stone | 5 Wood |
| Arcana | Magic | a void seal | 2 of each of the other five |

Step into an open well and the shaft carries you down (fastest mid-shaft, gentle at both ends: the flight rule, mirrored). The linked worlds form a ring in the order you opened them. A gate's **front face leads onward** round that ring and its **back face leads back**; each face glows the colour of where it leads. You step out of the far gate's back face, so the door behind you always leads back. Linking all six worlds wins. Progress saves in the browser.

**Time relics.** Four worlds each hide one relic on a lone mesa ringed with hour-stones, where time already misbehaves in the relic's own way.

| Relic | Form | Found on | The sign | What it does |
| --- | --- | --- | --- | --- |
| Stillwater Pearls | pills | Thalassa | rain hanging in the air, barely falling | **Slows** the world to a fifth for six seconds: guardians run, think, wind up and dodge at a fifth speed and their bolts crawl, while you and your own bolts move normally. Their eyes turn pale blue while it lasts. Three pearls, each regrows. |
| The Rewinder | gun | Pyra | embers flying backward into the fire | **Reverses**: a guardian retraces its path home, healed and pacified (a pursuer from another world unravels entirely). It also un-falls the rubble on buried deposits. |
| Quickening Seeds | grenade | Sylva | a tree living its whole life every few seconds | **Speeds** time where it lands: a great tree grows in a breath, its roots seize and age guardians, and spent essence nearby regrows at once. |
| Mantle of the Held Moment | cape | Petra | a dust storm frozen in mid-air | **Freezes** the world for five seconds and leaves an echo of you behind. When time resumes the echo draws the guardians' fire and casts whenever you cast; use the mantle again to step back into it. |

On worlds after Thalassa, some deposits lie buried under a collapse and need the Rewinder.

## Dev dashboard

Open it with the **DEV** button (top right while playing), the **Dev dashboard** button on the title screen, the `` ` `` key, or by adding `?dev` to the URL. It works on desktop, phones and the Quest Browser's 2D page.

- **Telemetry**: world, altitude, speed and speed limit, sun elevation, frame time, draw calls, triangles, terrain queue, render resolution.
- **Warp**: pick a world, then a place: wellhead, core gate, essence deposit, time anomaly, shore, summit, sunset, night side, above the clouds, low orbit, far view. Also the sun, a system overview and deep space. To judge a spot in the headset, warp there and use "enter VR from here".
- **Control demos**: the game plays itself (take off and land; walk and super leap; gather essence; fight guardians; all four time relics; break a seal; fall to the core, pass the gate and ride back up; fly to another world) and names the control it is using on Quest, keyboard and touch.
- **Spells and relics**: pick the element your casts spend (or Auto); throw a quick, perfect or overheld cast on demand; give and fire each of the four relics; recharge them; summon or dismiss guardians. A live meter shows the charge against the perfect window, and a readout shows the last cast, the last hit (damage, multiplier, perfect, eye strike) and the world's time scale.
- **Quest**: unseal the next gate or all of them, fill or empty essence, give all relics, summon guardians, heal or take damage, reset.
- **Look and flight tuning**: exposure, sun angle (lighting preview), cloud cover, render scale, flight speed constants, and toggles for clouds, atmosphere, scenery, markers and wireframe.
- **Controls and live input**: the mapping table plus live bars for what the game is receiving.

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
src/gates.js          wellheads, seals and the core gates
src/essence.js        essence deposits
src/props.js          per-world scenery
src/hud.js            wrist display, prompts, world markers
src/fx.js             speed streaks, wormhole tunnel
src/audio.js          synthesised sound
src/touch.js          on-screen stick and buttons
src/dev.js            developer dashboard: warps, demos, tuning
src/combat.js         guardians, bolts, pursuit
src/timeworks.js      time relics and their anomalies
vendor/               three.js r170 (MIT)
tools/                dev server and tests
```

## Tests

```sh
npm install        # only needed for the tests (XR emulator)
npm test           # scripted playthrough: gather, fight, leap, pursuit, seals, cores, wormholes, relics, death, win
npm run test:xr    # same game inside an emulated Quest 3 WebXR session
npm run test:ui    # twin-stick touch controls, every dashboard warp, all control demos
```

All three run the real game in headless Chromium (Playwright must be available). `test:xr` uses IWER, Meta's WebXR emulator, to exercise session start, stereo rendering and Touch controller input.

## Known limits

- Worlds do not rotate or orbit, so each wellhead sits in permanent daylight.
- You hover over liquids rather than swim.
- Guardians share one skeleton and one set of behaviours in six elemental bodies; there are no bosses. Their feet follow the ground under the body, not each footfall.
- Clouds cast shadows; terrain and scenery do not shadow each other. Clouds are a single thin layer, so flying through it shows no volume.
- The dev dashboard is a 2D page overlay and is not visible inside VR; warp first, then enter VR.
- Not yet profiled on a physical headset. If frame rate dips, try the dashboard toggles first (clouds, scenery), then lower `MAX_LEVEL` or `GRID` in `src/planet.js` / `src/cubesphere.js`.
