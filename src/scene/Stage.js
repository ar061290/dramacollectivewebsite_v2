// The stage: renderer, lights, statue, camera rig and the camera-locked Penrose ring.
//
// Camera rig: the camera orbits the statue (scroll arc + cursor parallax) and dollies in slightly.
// The ring rides on the camera, so its impossible-shape illusion is exact at every frame; it only
// ever turns about the camera's viewing axis. The statue stands on a turntable of its own (scroll,
// drag and a lean toward the cursor), independent of the ring. It is sized so that its bounding
// sphere, centred on the turning axis, stays inside the ring's hole at any spin and any turn, so the
// two never overlap on screen.
//
// GSAP writes plain numbers into `stage.state`; the render loop reads them.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRing, placeRing } from './ringStone.js';
import { loadStatue, prepareStatue } from './statue.js';
import { SilhouetteMask } from './silhouette.js';

const DEG = Math.PI / 180;
const DRAG_RAD_PER_PX = Math.PI / 420; // a 420 px drag turns the statue half way round
const MAX_FLING = 8; // rad/s; a hard flick coasts about half a turn
const FOLLOW = 14 * DEG; // how far the statue leans toward the cursor

export class Stage {
  /**
   * @param {object} o
   * @param {HTMLElement} o.container  element that receives the canvas (sized by CSS)
   * @param {object} o.colors          { warm, cool, rim, floor } CSS colour strings from the design tokens
   * @param {boolean} o.reducedMotion
   */
  constructor({ container, colors, reducedMotion }) {
    this.container = container;
    this.reducedMotion = reducedMotion;
    const white = new THREE.Color(1, 1, 1);
    this.colors = {
      // stage light = the token colour carried toward white, so marble stays white rather than khaki
      warm: new THREE.Color(colors.warm).lerp(white, 0.35),
      cool: new THREE.Color(colors.cool).lerp(white, 0.2),
      rim: new THREE.Color(colors.rim),
      floor: new THREE.Color(colors.floor),
    };
    this.state = {
      stageLight: 0, // intro: 0 = darkness, 1 = lit
      ringReveal: 0, // intro: ring opacity
      lightMix: 0, // 0 warm, 1 cool
      keyLevel: 1, // per-scene key light level
      ringLevel: 1, // per-scene ring brightness (eased back behind text)
      frameX: 0, frameY: 0, // composition offset, fractions of the viewport (right / up)
      spin: 0, // ring turn about the viewing axis (radians)
      statueSpin: 0, // statue turn about its own vertical axis (radians), driven by scroll
      arc: 0, // camera orbit around the statue (radians)
      dolly: 1, // camera distance multiplier (1 = hero, < 1 = closer)
      parX: 0, parY: 0, // smoothed cursor parallax, -1..1
      daylight: 0, // 0 = the dark theatre, 1 = house lights up (light theme)
    };
    // the statue's own turn on top of the scroll: drag (with fling), lean toward the cursor, hover
    this.turn = { drag: 0, vel: 0, held: false, follow: 0, hover: 0, hoverTarget: 0 };
    this.pointer = { x: 0, y: 0 };
    this.fill = 0.68; // statue height as a fraction of the viewport (hero, desktop)
    this.running = false;
    this.disposed = false;
    this._lastSig = '';
    this._maskDue = 0;
    this._shadowYaw = NaN;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // lights never move; the map is redrawn only when the statue turns
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(14, 1, 0.1, 400);
    this.scene.add(this.camera); // the ring is the camera's child

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0;

    this._buildLights();
    this._resize = this._resize.bind(this);
    this.resizeObserver = new ResizeObserver(this._resize);
    this.resizeObserver.observe(container);
    this._tick = this._tick.bind(this);
    this.clock = new THREE.Clock(false);
  }

  _buildLights() {
    // warm key spotlight from above right of the audience, soft shadows
    const key = new THREE.SpotLight(this.colors.warm, 0, 0, 0.36, 0.85, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 16;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    // a cool, faint rim from behind
    const rim = new THREE.SpotLight(this.colors.rim, 0, 0, 0.5, 1, 2);
    const hemi = new THREE.HemisphereLight(this.colors.rim, 0x000000, 0);
    this.lights = { key, rim, hemi };
    this.scene.add(key, key.target, rim, rim.target, hemi);
  }

  /** Load textures and the statue through one LoadingManager. onProgress(0..1). */
  async load({ statueUrl, textureUrls, yaw = Math.PI, onProgress = () => {} }) {
    const manager = new THREE.LoadingManager();
    let bytes = 0, items = 0, itemsTotal = 1;
    const report = () => onProgress(Math.min(0.99, 0.15 * (items / itemsTotal) + 0.85 * bytes));
    manager.onProgress = (_url, loaded, total) => { items = loaded; itemsTotal = total; report(); };
    const texLoader = new THREE.TextureLoader(manager);
    const loadTex = (url, srgb) => texLoader.loadAsync(url).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      return t;
    });
    const [albedo, normal, statue] = await Promise.all([
      loadTex(textureUrls.albedo, true),
      loadTex(textureUrls.normal, false),
      loadStatue(statueUrl, {
        manager,
        onBytes: (e) => { if (e.lengthComputable) { bytes = e.loaded / e.total; report(); } },
      }),
    ]);
    if (this.disposed) return;

    this.statue = prepareStatue(statue.object, { kind: statue.kind, yaw });
    // the turntable turns about the statue's vertical axis (x = z = 0, through the plinth)
    this.turntable = new THREE.Group();
    this.turntable.name = 'Turntable';
    this.turntable.add(this.statue.root);
    this.scene.add(this.turntable);

    this.ring = createRing({ albedo, normal });
    this.camera.add(this.ring.root);
    this.ringTint = this.statue.averageColor ?? new THREE.Color(0xe9e5de);

    this._buildFloor();
    this._aimLights();
    this._frameStatue();
    this.mask = new SilhouetteMask(this.renderer);
    this.renderer.shadowMap.needsUpdate = true;
    this._resize();
    onProgress(1);
  }

  _buildFloor() {
    // No visible floor: only what the spotlight puts on it. A shadow-catcher gives the soft
    // contact shadow under the plinth, and an additive pool of warm light falls off into the
    // page ground, so nothing here can darken the background.
    const H = this.statue.height;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(H * 1.4, 48),
      new THREE.ShadowMaterial({ opacity: 0.5, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    shadow.receiveShadow = true;

    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const poolTex = new THREE.CanvasTexture(c);
    poolTex.colorSpace = THREE.SRGBColorSpace;
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 1.5, H * 1.5),
      new THREE.MeshBasicMaterial({ map: poolTex, color: this.colors.warm, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.001;
    this.floor = { shadow, pool };
    this.scene.add(shadow, pool);
  }

  _aimLights() {
    const { key, rim, hemi } = this.lights;
    const H = this.statue.height;
    const c = this.statue.center;
    key.position.set(1.35 * H, 2.9 * H, 1.6 * H);
    key.target.position.set(c.x, c.y * 0.9, c.z);
    key.shadow.camera.far = 6 * H;
    rim.position.set(-1.4 * H, 2.1 * H, -1.8 * H);
    rim.target.position.copy(c);
    hemi.position.set(0, 4 * H, 0);
    this.keyPower = 26 * H * H; // candela-ish, tuned for decay 2 at ~3.5H
    this.rimPower = 9 * H * H;
  }

  /**
   * Choose the camera distance and field of view.
   * The statue's bounding sphere (seen from the closest camera position) must fit inside the ring's
   * hole with a margin, at any spin; the field of view then sets the statue to `fill` of the height.
   */
  _frameStatue() {
    const { radius, height } = this.statue;
    const tanMax = this.ring.innerRadius * 0.95;
    const closest = radius * Math.sqrt(1 + 1 / (tanMax * tanMax));
    this.dollyMin = 0.93; // the camera ends 7% closer than in the hero
    this.distance = closest / this.dollyMin;
    this.pitch = -3 * DEG;
    this.statueTan = height / this.distance; // projected height (tan units) at the hero distance
    this._applyFov();
  }

  _applyFov() {
    if (!this.statue) return;
    const tanHalf = this.statueTan / (2 * this.fill);
    this.camera.fov = 2 * Math.atan(tanHalf) / DEG;
    this.camera.updateProjectionMatrix();
  }

  /** Statue fill for the current layout (smaller on phones, where text sits below it). */
  setFill(fill) {
    this.fill = fill;
    this._applyFov();
    this._lastSig = '';
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._lastSig = '';
    this._maskDue = 0;
    if (!this.running && this.statue) this.renderOnce();
  }

  setPointer(nx, ny) {
    this.pointer.x = nx;
    this.pointer.y = ny;
  }

  // ---- statue interaction (see src/scene/interaction.js) ----

  /** The cursor is over the statue: the key light leans in a little. */
  setHover(on) {
    this.turn.hoverTarget = on ? 1 : 0;
  }

  /** Start a drag: any fling still running stops under the hand. */
  grab() {
    this.turn.held = true;
    this.turn.vel = 0;
  }

  /** Turn the statue by a horizontal drag of `dx` CSS pixels. */
  dragBy(dx) {
    this.turn.drag += dx * DRAG_RAD_PER_PX;
  }

  /** End a drag; `pxPerSec` is the release speed, carried on as a fling that slows to rest. */
  release(pxPerSec = 0) {
    this.turn.held = false;
    const v = pxPerSec * DRAG_RAD_PER_PX;
    this.turn.vel = this.reducedMotion ? 0 : Math.max(-MAX_FLING, Math.min(MAX_FLING, v));
  }

  _updateRig(dt) {
    const s = this.state;
    const t = this.turn;
    if (!this.reducedMotion) {
      const k = 1 - Math.exp(-dt * 1.6); // heavy damping
      s.parX += (this.pointer.x - s.parX) * k;
      s.parY += (this.pointer.y - s.parY) * k;
      if (!t.held && t.vel) {
        t.drag += t.vel * dt;
        t.vel *= Math.exp(-dt * 2.6);
        if (Math.abs(t.vel) < 0.01) t.vel = 0;
      }
      // the statue turns its head toward the cursor, a little more slowly than the camera follows
      t.follow += (this.pointer.x * FOLLOW - t.follow) * (1 - Math.exp(-dt * 1.2));
    } else {
      s.parX = s.parY = 0;
      t.follow = 0;
    }
    t.hover += (t.hoverTarget - t.hover) * (dt ? 1 - Math.exp(-dt * 6) : 1);

    // statue: its own turn, independent of the ring
    const statueYaw = s.statueSpin + t.drag + t.follow;
    this.turntable.rotation.y = statueYaw;
    if (Math.abs(statueYaw - this._shadowYaw) > 0.001 || Number.isNaN(this._shadowYaw)) {
      this._shadowYaw = statueYaw;
      this.renderer.shadowMap.needsUpdate = true;
    }

    const c = this.statue.center;
    const yaw = s.arc + s.parX * 3 * DEG;
    const pitch = this.pitch - s.parY * 2 * DEG;
    const d = this.distance * s.dolly;
    const cam = this.camera;
    cam.position.set(
      c.x + d * Math.sin(yaw) * Math.cos(pitch),
      c.y - d * Math.sin(pitch),
      c.z + d * Math.cos(yaw) * Math.cos(pitch),
    );
    cam.lookAt(c);
    // composition: shift the whole picture; the centre of projection does not move
    const w = this.width, h = this.height;
    cam.setViewOffset(w, h, -s.frameX * w, s.frameY * h, w, h);
    // ring: behind the statue, turned only about the viewing axis
    placeRing(this.ring, d + this.statue.radius * 1.4);
    this.ring.spinner.rotation.z = s.spin;
  }

  _updateLights() {
    const s = this.state;
    const { key, rim, hemi } = this.lights;
    const lit = s.stageLight;
    const day = s.daylight;
    const hover = this.turn.hover;
    key.color.copy(this.colors.warm).lerp(this.colors.cool, s.lightMix);
    key.intensity = this.keyPower * s.keyLevel * lit * (1 + 0.22 * hover) * (1 - 0.25 * day);
    rim.intensity = this.rimPower * (0.6 + 0.4 * s.lightMix) * lit * (1 + 0.8 * hover);
    // house lights: an even sky fill that does not depend on the spotlight, so the statue reads as
    // stone in daylight rather than a silhouette on a pale ground
    hemi.intensity = 0.06 * lit + 1.1 * day;
    this.scene.environmentIntensity = 0.16 * lit + 0.3 * day;
    this.renderer.toneMappingExposure = 1 - 0.12 * day;
    const pool = this.floor.pool.material;
    pool.color.copy(key.color);
    pool.opacity = 0.16 * lit * s.keyLevel * (1 - day);
    this.floor.shadow.material.opacity = 0.5 - 0.2 * day;
    const m = this.ring.material;
    m.opacity = s.ringReveal;
    m.transparent = s.ringReveal < 0.999;
    m.depthWrite = !m.transparent;
    // the ring is a supporting frame: lit, but kept below the statue's brightness; in daylight it
    // turns to pale stone under the softer matcap
    m.matcap = day > 0.5 ? this.ring.dayMatcap : this.ring.matcap;
    const stageRing = 0.56 * s.ringLevel * (0.55 + 0.45 * lit);
    const ringLight = stageRing + (0.86 + 0.1 * s.ringLevel - stageRing) * day;
    m.color.copy(this.ringTint).multiplyScalar(ringLight).multiply(
      this._tmpColor.copy(key.color).lerp(this._white, 0.6 + 0.4 * day),
    );
  }

  _signature() {
    const s = this.state;
    const t = this.turn;
    const r = (v) => Math.round(v * 1e4);
    return [s.stageLight, s.ringReveal, s.lightMix, s.keyLevel, s.ringLevel, s.frameX, s.frameY, s.spin, s.statueSpin, s.arc, s.dolly,
      s.parX, s.parY, s.daylight, t.drag, t.follow, t.hover, this.width, this.height, this.camera.fov].map(r).join(',');
  }

  _tick() {
    const dt = Math.min(0.1, this.clock.getDelta());
    this._updateRig(dt);
    const sig = this._signature();
    if (sig === this._lastSig) return; // nothing moved: skip the frame
    this._lastSig = sig;
    this._updateLights();
    this.renderer.render(this.scene, this.camera);
    const now = performance.now();
    if (now >= this._maskDue) {
      this._maskDue = now + 140;
      this.mask.update(this.scene, this.camera, this.width, this.height);
    }
  }

  renderOnce() {
    if (!this.statue) return;
    this._updateRig(0);
    this._updateLights();
    this.renderer.render(this.scene, this.camera);
    this.mask?.update(this.scene, this.camera, this.width, this.height);
  }

  start() {
    if (this.running || this.disposed || !this.statue) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this._tick);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.clock.stop();
    this.renderer.setAnimationLoop(null);
  }

  /** True if the CSS pixel (x, y) is covered by the statue. */
  covers(x, y) {
    return this.mask ? this.mask.covers(x, y) : false;
  }

  /** PNG of the current frame (transparent background). */
  capture() {
    this.renderOnce();
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
        m.dispose();
      }
    });
    for (const l of Object.values(this.lights)) l.dispose?.();
    this.mask?.dispose();
    this.ring?.matcap.dispose();
    this.ring?.dayMatcap.dispose();
    this.scene.environment = null;
    this.envTarget.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

Stage.prototype._tmpColor = new THREE.Color();
Stage.prototype._white = new THREE.Color(1, 1, 1);
