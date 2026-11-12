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
| Walk / strafe | Left stick | `W A S D` | Lower-left of the screen (a stick appears under your thumb) |
| Look / turn | Head; right stick snap-turns | Mouse | Lower-right of the screen |
| Super leap | `A` or `X` | `Space` | **Double-tap** the look side |
| Fly | Trigger: fly where that hand points | `W`, once a leap has put you in the air | Left stick, once a leap has put you in the air |
| Blade (free) | **Swing a controller** | `V` or middle click | **Swipe** across the open upper screen |
| Cast (spends essence) | Hold right grip to charge, release to throw | Hold left click (or `X`), release | **Tap** (quick) or **press and release** (charged) on the open upper screen |
| Use the time relic | Left grip, aimed with that hand | `E` or right click | **TIME** (appears once you own one) |
| Switch relic | `B` | `Q`, wheel, `1`-`4` | **⟳** |
| Objectives | `Y` (on the left wrist) | `H` | **◎** |

On a phone there are no move, fly, leap, cast or gather buttons. The lower half of the screen is two floating sticks; the upper half is open. With nothing to fight, dragging there looks around. When a guardian or a seal is near, it takes attack gestures instead (a faint frame and a line of text appear). A ring closes on your finger while you press: let go as it flashes white for a perfect cast.

**Flight looks after itself** on flat screens. A leap puts you in the air and flying; fly down to within a few metres of the ground and you land. Inside a world you always fly. (In VR the triggers fly, as before.)

## The game

Each world has exactly three places, all within a short flight of each other, joined to the wellhead by glowing streams and shown on the radar:

1. **The wellhead**, with the world's one beacon. Its shaft leads to the gate at the core.
2. **The trial ground**, where the world's element is won.
3. **A time anomaly**, where a relic waits.

**Elements are won, not found.** Each trial ground is a ringed pool of the world's own liquid with a dormant font on an islet: the Tidepool (water) on Thalassa, the Crucible (a lake of lava) on Pyra, the Foundry (quicksilver) on Ferrum, the Heartwood mire on Sylva, the Quarry pit on dry Petra, the Rift on Arcana. Step in and guardians rise out of it in three waves while the ground erupts under you: a ring closes on a spot, then a geyser, fire jet or rockfall bursts there, so you fight on the move. Clear the waves and the font wakes: your element fills to 12, and from then on standing by that font refills it.

**Two ways to strike.** A **blade** (swing a controller, swipe the screen) is free, short-ranged, and cuts every guardian it crosses; drawn through a head it hits far harder. It carries the most useful element you hold without spending it, so you can always fight, even with nothing. A **cast** spends one essence, reaches far and hits harder: hold to charge and release inside the quarter-second window after the flash for a perfect cast (about three times the force of a tap, twice the speed, punches through once, counts double on a seal). A head hit is 1.6x.

**Guardians** walk on jointed legs. They rise out of their element, run you down, crouch and pounce, rear up to spit, and may spring aside from a bolt they see coming. They only take to the air if you go well above them. They are weak to the element that overcomes theirs (water douses fire, fire melts metal, metal cuts wood, wood breaks earth, earth dams water), and the right element is chosen for you if you carry it. If you fly away, up to six chase you through open space; only a wormhole shakes them.

**Health.** You have 100. After five seconds without being hit you mend quickly. At zero you are unmade: half your essence scatters and you reform at the wellhead of the world you were on.

**Wells, seals and cores.** Each world's wormhole gate hangs at its centre, in a hollow geode core. Every well but Thalassa's is capped by a seal; cast the element that overcomes it at the seal to break it.

| World | Element | Well is sealed by | Broken with |
| --- | --- | --- | --- |
| Thalassa | Water | (home, already open) | |
| Pyra | Fire | an undying firestorm | 5 Water |
| Ferrum | Metal | an iron shell | 5 Fire |
| Sylva | Wood | iron-thorn vines | 5 Metal |
| Petra | Earth | living stone | 5 Wood |
| Arcana | Magic | a void seal | 2 of each of the other five |

Step into an open well and the shaft carries you down. A gate's **front face leads onward** round the ring of linked worlds and its **back face leads back**.

**Time relics.** Every world's anomaly is a lone mesa ringed with hour-stones where time already misbehaves in the relic's own way.

| Relic | Form | World | What it does |
| --- | --- | --- | --- |
| Stillwater Pearls | pills | Thalassa | **Slows** the world to a fifth for six seconds; you and your own attacks are unaffected. |
| The Rewinder | gun | Pyra | **Reverses**: a guardian retraces its path and is pacified; an eruption about to burst un-happens. |
| Tempered Mainspring | coil (passive) | Ferrum | Your other relics recharge twice as fast. |
| Quickening Seeds | grenade | Sylva | **Speeds** time where it lands: a tree grows in a breath and its roots seize guardians; beside a woken font it fruits with that element. |
| Mantle of the Held Moment | cape | Petra | **Freezes** the world and leaves an echo of you that draws fire and casts when you cast; use it again to step back into it. |
| Prism of Hours | prism (passive) | Arcana | Slow and freeze last longer, with a pearl and a seed to spare. |

**The finale.** When all six worlds are linked, the star wakes. A ring of stone hangs before the Sun (a marker leads you there, and you slow to a fighting pace as you reach it). Guardians of every element pour out of the flares in two waves while solar flares burst around you; five braziers on the ring each refill one element when you fly through them. Then the Heliarch: four times the size of a guardian, calling reinforcements, and wearing one element after another, so it must be answered with each overcoming element in turn. Felling it completes the game and shows your time.

**Length.** The run is built to take about 20 to 30 minutes: five short trials, five seals, the flights between, and the finale. That figure is an estimate from the pacing of each part, not a measured playthrough by a person.

## Dev dashboard

Open it with the **DEV** button (top right while playing), the **Dev dashboard** button on the title screen, the `` ` `` key, or by adding `?dev` to the URL. It works on desktop, phones and the Quest Browser's 2D page.

- **Telemetry**: world, altitude, speed and speed limit, sun elevation, frame time, draw calls, triangles, terrain queue, render resolution.
- **Warp**: pick a world, then a place: wellhead, core gate, element trial, time anomaly, shore, summit, sunset, night side, above the clouds, low orbit, far view. Also the Sun arena, the sun, a system overview and deep space. To judge a spot in the headset, warp there and use "enter VR from here".
- **Control demos**: the game plays itself (take off and land; walk and super leap; win an element trial; blade and cast; all four wielded relics; break a seal; fall to the core, pass the gate and ride back up; fly to another world) and names the control it is using on Quest, keyboard and touch.
- **Spells and relics**: pick the element your casts spend (or Auto); throw a quick, perfect or overheld cast on demand; give and fire each of the four relics; recharge them; summon or dismiss guardians. A live meter shows the charge against the perfect window, and a readout shows the last cast, the last hit (damage, multiplier, perfect, eye strike) and the world's time scale.
- **Quest**: unseal the next gate or all of them, fill or empty essence, give all relics, summon guardians, heal or take damage, master all trials, go to the finale, skip to the Heliarch, reset.
- **Look and flight tuning**: exposure, sun angle (lighting preview), cloud cover, render scale, flight speed constants, and toggles for clouds, atmosphere, scenery, markers and wireframe.
- **Controls and live input**: the mapping table plus live bars for what the game is receiving.

## How the main pieces work

**Logarithmic flight** (`src/player.js`). Top speed is proportional to altitude above the nearest surface: `v = 26 m/s + 0.8/s × altitude`. Leaving a world you accelerate exponentially; arriving you decelerate the same way, so remaining distance shrinks by a constant ratio each second. Thalassa to Pyra is about 1,300 km and takes about 40 seconds, peaking near 400 km/s, and you still touch down at walking pace. Near a world the play space rolls upright so you land on your feet. A light aim assist bends your heading toward a far world you are roughly pointing at.

**One terrain system from orbit to ground** (`src/planet.js`, `src/terrainWorker.js`). Each world is a cube-sphere quadtree, 12 to 17 km in radius, refined down to about one-metre cells under your feet. Patches are generated in web workers from seeded simplex noise and swapped in only when ready, so there is no loading screen between space and surface and no frame hitching. The same height function runs on the main thread for collision (`src/worlds.js`).

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
src/essence.js        the font at each trial ground
src/props.js          per-world scenery
src/hud.js            wrist display, prompts, world markers
src/fx.js             speed streaks, wormhole tunnel
src/audio.js          synthesised sound
src/touch.js          on-screen stick and buttons
src/dev.js            developer dashboard: warps, demos, tuning
src/combat.js         guardians, bolts, pursuit
src/timeworks.js      time relics and their anomalies
src/trials.js         element trials, hazards and the Sun finale
vendor/               three.js r170 (MIT)
tools/                dev server and tests
```

## Tests

```sh
npm install        # only needed for the tests (XR emulator)
npm test           # scripted playthrough: trial, blade and cast, leap, pursuit, seals, cores, wormholes, relics, finale, death
npm run test:xr    # same game inside an emulated Quest 3 WebXR session
npm run test:ui    # touch sticks and gestures, every dashboard warp, all control demos
```

All three run the real game in headless Chromium (Playwright must be available). `test:xr` uses IWER, Meta's WebXR emulator, to exercise session start, stereo rendering and Touch controller input.

## Known limits

- Worlds do not rotate or orbit, so each wellhead sits in permanent daylight.
- You hover over liquids rather than swim.
- Guardians share one skeleton and one set of behaviours in six elemental bodies. The Heliarch is the same creature scaled up, changing body with its element. Feet follow the ground under the body, not each footfall.
- The finale arena is weightless: guardians there fly rather than walk.
- Clouds cast shadows; terrain and scenery do not shadow each other. Clouds are a single thin layer, so flying through it shows no volume.
- The dev dashboard is a 2D page overlay and is not visible inside VR; warp first, then enter VR.
- Not yet profiled on a physical headset. If frame rate dips, try the dashboard toggles first (clouds, scenery), then lower `MAX_LEVEL` or `GRID` in `src/planet.js` / `src/cubesphere.js`.
