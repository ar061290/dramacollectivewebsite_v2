// The impossible ring as a carved-stone frame that travels with the camera.
//
// The illusion only holds from one point: the camera must sit at (0, 0, cameraDistance) in the
// ring's own frame (src/scene/ring/ring.js). So the ring is parented to the camera:
//   root     camera-space position (0, 0, -12k), uniform scale k   (any k gives the same image)
//   spinner  rotation about the camera's viewing axis only        (the clock-hand turn)
//   frame    the unchanged ring geometry
// Its stone shading comes from a matcap (view-space lighting), so the two face orientations keep
// their contrast at every spin angle and under any stage light. A second, softer matcap is used in
// daylight (light theme): shadows lift so the ring reads as pale stone, not a black frame.

import * as THREE from 'three';
import { buildRing, RING_DEFAULTS } from './ring/ring.js';

export const RING_EYE = RING_DEFAULTS.cameraDistance;

/**
 * A stone sphere lit from the upper left, drawn analytically: light comes from the viewer's side.
 * `ambient` and `diffuse` set the floor and the range of the shading (stage: deep shadows).
 */
export function makeStoneMatcap(size = 256, { ambient = 0.035, diffuse = 0.78, spec = 0.16 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const L = new THREE.Vector3(-0.55, 0.6, 0.58).normalize();
  const H = L.clone().add(new THREE.Vector3(0, 0, 1)).normalize();
  const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = 1 - (y + 0.5) / size * 2;
      const r2 = nx * nx + ny * ny;
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(r2, 1)));
      const ndl = Math.max(0, (nx * L.x + ny * L.y + nz * L.z + 0.12) / 1.12);
      const ndh = Math.max(0, nx * H.x + ny * H.y + nz * H.z);
      const rim = Math.pow(1 - nz, 3) * 0.06;
      const v = Math.min(1, ambient + diffuse * ndl + spec * Math.pow(ndh, 36) + rim);
      const s = Math.round(toSRGB(v) * 255);
      const i = (y * size + x) * 4;
      img.data[i] = s; img.data[i + 1] = s; img.data[i + 2] = s; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build the ring. `albedo` and `normal` are the baked stone maps (U along the sweep, V around the
 * profile; seamless through both joints). Returns the hierarchy plus `innerRadius`: the radius of
 * the largest circle, centred on the viewing axis, that fits inside the ring's hole, in
 * tan(angle) units. Anything whose silhouette stays inside it can never touch the ring, at any spin.
 */
export function createRing({ albedo, normal }) {
  const { ring, lower, upper } = buildRing();
  const matcap = makeStoneMatcap();
  const dayMatcap = makeStoneMatcap(256, { ambient: 0.34, diffuse: 0.6, spec: 0.08 });
  const material = new THREE.MeshMatcapMaterial({
    name: 'RingStone',
    matcap,
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    color: 0xffffff,
    transparent: true,
    opacity: 0,
  });

  const frame = new THREE.Group();
  frame.name = 'RingFrame';
  let innerRadius = Infinity;
  for (const [name, part] of [['RingLower', lower], ['RingUpper', upper]]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(part.indices, 1));
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    frame.add(mesh);
    // the hole, as seen from the ring's eye at (0, 0, RING_EYE)
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      const depth = RING_EYE - p[i + 2];
      const r = Math.hypot(p[i] / depth, p[i + 1] / depth);
      if (r < innerRadius) innerRadius = r;
    }
  }
  const spinner = new THREE.Group();
  spinner.name = 'RingSpinner';
  spinner.add(frame);
  const root = new THREE.Group();
  root.name = 'PenroseRing';
  root.add(spinner);

  return { root, spinner, frame, material, matcap, dayMatcap, innerRadius, meta: ring };
}

/** Place the ring behind a point at `distance` from the camera (keeps the image identical). */
export function placeRing(ringParts, distance) {
  const k = distance / RING_EYE;
  ringParts.root.position.set(0, 0, -distance);
  ringParts.root.scale.setScalar(k);
}
