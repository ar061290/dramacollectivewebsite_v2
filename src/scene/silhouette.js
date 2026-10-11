// A low-resolution, screen-space mask of the statue, so the constellation never captures stars
// hidden behind it. The statue is rendered alone (its own layer) in flat white into a small target.

import * as THREE from 'three';
import { STATUE_LAYER } from './statue.js';

export class SilhouetteMask {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.data = new Uint8Array(4);
    this.w = 1; this.h = 1;
    this.cssW = 1; this.cssH = 1;
    this.ready = false;
    this._clear = new THREE.Color();
  }

  update(scene, camera, cssWidth, cssHeight) {
    const w = 128;
    const h = Math.max(1, Math.round((w * cssHeight) / cssWidth));
    if (w !== this.w || h !== this.h) {
      this.target.setSize(w, h);
      this.data = new Uint8Array(w * h * 4);
      this.w = w; this.h = h;
    }
    this.cssW = cssWidth; this.cssH = cssHeight;
    const r = this.renderer;
    const prevMask = camera.layers.mask;
    const prevOverride = scene.overrideMaterial;
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clear);
    const prevShadowAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    camera.layers.set(STATUE_LAYER);
    scene.overrideMaterial = this.material;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.readRenderTargetPixels(this.target, 0, 0, w, h, this.data);
    scene.overrideMaterial = prevOverride;
    camera.layers.mask = prevMask;
    r.setClearColor(this._clear, prevAlpha);
    r.shadowMap.autoUpdate = prevShadowAuto;
    this.ready = true;
  }

  /** True when the CSS pixel (x, y) lies on the statue (with a small dilation). */
  covers(x, y) {
    if (!this.ready) return false;
    const u = Math.floor((x / this.cssW) * this.w);
    const v = Math.floor((1 - y / this.cssH) * this.h);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const uu = u + dx, vv = v + dy;
        if (uu < 0 || vv < 0 || uu >= this.w || vv >= this.h) continue;
        if (this.data[(vv * this.w + uu) * 4 + 3] > 0) return true;
      }
    }
    return false;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
