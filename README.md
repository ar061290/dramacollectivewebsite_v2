# The Drama Collective · home page

The home page for the CHIREC Drama Collective. It is one page, a dark theatre before curtain-up. A marble statue holding a tragedy mask stands in a fixed three.js scene inside the Penrose ring, while five acts of real HTML scroll past it.

Built with Vite and vanilla JS, three.js 0.170, GSAP 3.13 (ScrollTrigger, SplitText, ScrollToPlugin, CustomEase) and lottie-web 5.12 (light SVG build).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve dist/
```

**No build step needed.** `index.html` carries an import map that points the same bare imports (`three`, `gsap/...`, `lottie-web/...`) at pinned jsDelivr URLs. So the folder also runs as-is from any static server, for example `npx serve .` or `python -m http.server`. Vite ignores the import map and bundles from `node_modules`.

Opening `index.html` directly from disk (`file://`) does not work, because module scripts and `fetch` need a server.

## Folders

```
index.html               all copy, all sections, the import map
src/
  main.js                boot: loader, stage, sky, scenes, nav, cursor, reveals, intro, teardown
  scene/                 three.js stage
    Stage.js             renderer, lights, camera rig, ring, render-on-change loop, dispose()
    statue.js            GLB/STL loading (meshopt + Draco), centring, marble material settings
    ringStone.js         the Penrose ring in the statue's stone, locked to the camera
    ring/                ring geometry (unchanged from the Penrose model)
    silhouette.js        low-res statue mask so the constellations never draw over it
    marble.js            procedural marble, used only for the STL fallback
  constellation/         cursor-trail star field (single 2D canvas, spatial grid, rAF)
  sections/              scroll choreography (scenes.js), line reveals, count-ups
  animations/            intro timeline, nav, star cursor, Lottie loader
  styles/                tokens.css (design system + extensions), components, layout
  util/env.js            reduced motion, WebGL probe, low-power check
assets/
  models/statue.glb      compressed statue (meshopt, WebP 2048, 4.2 MB)
  textures/              ring albedo and normal maps baked from the statue's stone
  lottie/                scroll cue, mask mark, loader flicker, CTA flourish (all under 50 KB)
  fallback/hero.png      still frame used when WebGL is missing or the device is low-power
  brand/                 Collective mark (gold, blush), CHIREC endorsement logo
  fonts/                 Raung, Lato, Open Sans
```

## Changing the copy

All of the text is in `index.html`; no copy lives in the JavaScript. Every section is a `<section>` with an id:

| Section | id | Notes |
|---|---|---|
| Hero | `#top` | Name, tagline, and a visually hidden description of the statue for screen readers |
| Act one · Who we are | `#about` | |
| Act two · Productions | `#productions` | Production card (venue, dates) and the programme list |
| Act three · Impact | `#impact` | Figures count up from `data-count`; a range uses `data-count-range="5,7"`; `data-prefix` adds ₹ |
| Act four · Leadership | `#leadership` | Person cards |
| Act five · Support us | `#support` | Tier cards, funds list, brand tags, and the sponsor button (`mailto:`) |
| Curtain call | `#contact` | Footer: contacts, event details, copyright |

Each scene also tells the stage how to light and place the statue:

- `data-frame`: where the statue sits, as a fraction of the viewport width (`0.24` = right, `-0.24` = left). Put the text column on the other side (`scene--text-right` moves it right).
- `data-light`: `0` is the warm spotlight and `1` is the cool one.
- `data-key`: the key light level.

To add a section, copy one, give it `data-scene` plus those three attributes, and add a link to the nav if it needs one. Anything marked `data-mask` keeps the constellations clear of it.

## Changing images

- **Brand marks**: `assets/brand/mark-gold.png` (nav fallback) and `mark-blush.png` (the large cropped mark in the footer). The animated nav mark is `assets/lottie/mask-mark.json`, which embeds a 96 px copy of the gold mark. Replace that image layer if the mark changes.
- **Endorsement**: `assets/brand/chirec.webp`.
- **Fallback still**: `assets/fallback/hero.png` is a transparent frame of the hero composition. To re-shoot it after changing the statue, open the page with `?live`, wait for the intro to finish, and run this in the console:

  ```js
  const st = dramaCollective.stage;
  st.stop();
  Object.assign(st.state, { frameX: 0, frameY: 0, spin: 0, arc: 0, dolly: 1, parX: 0, parY: 0, ringLevel: 1, lightMix: 0, keyLevel: 1 });
  st.floor.pool.visible = false; // the additive light pool cannot be stored in a transparent PNG
  open(URL.createObjectURL(await st.capture()));
  ```

## Replacing the statue

1. Export the model from Meshy (or anywhere) as GLB with its PBR textures.
2. Compress it to under 5 MB. Put the raw export at `assets/models/statue.source.glb` (it is never referenced, so it is never bundled; keep it out of git), then run:

   ```bash
   npm run compress:statue
   ```

   which is:

   ```bash
   npx @gltf-transform/cli optimize assets/models/statue.source.glb assets/models/statue.glb --compress meshopt --texture-compress webp --texture-size 2048 --simplify-ratio 0.5 --simplify-error 0.0004
   ```

   Drop `--simplify-ratio` / `--simplify-error` if the model is already light. Draco-compressed files also load, because the Draco decoder comes from jsDelivr on demand.
3. Overwrite `assets/models/statue.glb`.

Framing is automatic. The statue is centred on its plinth footprint and scaled to a fixed height. The camera distance and field of view are then solved so the statue's bounding sphere always fits inside the ring's opening, at every point of the scroll, so the ring never crosses the statue.

The material is forced to metalness 0 and roughness 0.45, while the model's own colour and normal maps are kept. The ring's stone tint is taken from the statue's average texture colour.

If the new model faces a different way, pass `yaw` (radians) in `src/main.js`:

```js
await stage.load({ statueUrl: ASSETS.statue, textureUrls: { ... }, yaw: Math.PI, onProgress });
```

The default is `Math.PI`, which shows the figure from behind with the mask raised towards the camera. An `.stl` URL also works: it gets the procedural marble and is turned Z-up to Y-up automatically.

## Behaviour

- **Intro** (about 2.5 s): darkness, then the spotlight, the ring, the name letter by letter, the tagline and the scroll cue. Any key, click, wheel or touch skips it.
- **Scroll**:
  - the ring turns once about the viewing axis over the whole page (scrub 1.2);
  - the camera arcs 22° and moves closer;
  - the light moves warm, cool, warm by section;
  - the statue steps left and right so the text sits in empty space;
  - the statue itself never spins.
- **Pointer**: a ±3° camera parallax with heavy damping, for mouse only.
- **Constellations**: drag the star cursor through the star field to link up to 12 stars. Rest for 1.2 s and the constellation pulses, then fades. The browser is never stopped from scrolling vertically on touch; only horizontal drags draw.
- **Nav**: hides on scroll down and returns on scroll up. Anchor links glide with ScrollToPlugin and move keyboard focus to the section.

## Performance and fallbacks

- **Loading**: three.js and the statue load lazily behind the loader, which shows real `LoadingManager` progress.
- **Rendering**:
  - DPR is capped at 2;
  - a frame is rendered only when something changed;
  - the shadow map is drawn once;
  - both canvases pause when the tab is hidden or the footer covers the stage.
- **Static fallback**: no WebGL, a software renderer, Save-Data, 2 cores or fewer, or 2 GB of memory or less all get the still picture, with the star field kept.
- **Reduced motion**:
  - no intro and no parallax;
  - the ring does not turn;
  - scene changes happen in steps instead of tweens;
  - text appears without movement;
  - constellations appear without the draw-on animation.
- **Teardown**: `dramaCollective.destroy()` (also called on `pagehide`) frees GPU memory, ScrollTriggers, SplitTexts, Lotties and listeners.

QA flags: `?static` forces the still picture and `?live` forces WebGL.

## Design system extensions

Everything else comes from the Drama Collective design system as written: colours, type scale, fonts, spacing, radii, shadows, motion tokens, and the Button, Tag, Eyebrow, Rule, Card, SectionHeading, Stat, Quote and TopBar components.

These were added because the system has no dark-stage page. They are built from existing tokens in its own style (see the end of `tokens.css`):

- `--border-on-dark`: the hairline at 14%, taken from plum-100, for ink surfaces.
- `--topbar-h` (56px, from the TopBar spec), `--stage-gutter` (space-6 on small screens, space-8 from 768px), and a z-index scale for the stage layers.
- The gold (inverse) button's hover and press states use gold-300 and gold-600. Links on dark grounds are gold-500, turning gold-300 on hover.
- A secondary button for dark grounds: a plum-100 outline whose hover fills ink and turns the edge gold.
- The mobile text scrim: a fade from transparent to plum-900, so text never sits on the statue.
- The design system says "no parallax or looping motion". The brief overrides that for the stage, so the overrides are confined to the canvas, the scroll cue and the loader.

## Content notes

Every fact on the page comes from the Collective's sponsorship document; nothing is invented and nothing is a placeholder. Where the document is silent, the page leaves the subject out:

- no founding year, history, past productions, production title, photographs or social links;
- the Impact act shows only figures the document states.
