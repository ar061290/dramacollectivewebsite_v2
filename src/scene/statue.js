// Loading and preparing the statue: glTF/GLB (Draco or meshopt compressed, or plain), with an STL
// fallback that gets a procedural white-marble material.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createProceduralMarble } from './marble.js';

const DRACO_PATH = `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/libs/draco/gltf/`;

export const STATUE_LAYER = 1; // the statue alone, for the constellation's silhouette mask

/** Load a statue. Resolves { object, kind: 'gltf' | 'stl' }. */
export async function loadStatue(url, { manager, onBytes, dracoPath = DRACO_PATH } = {}) {
  const ext = url.split(/[?#]/)[0].split('.').pop().toLowerCase();
  if (ext === 'stl') {
    let geometry = await new STLLoader(manager).loadAsync(url, onBytes);
    geometry.deleteAttribute('normal');
    geometry = mergeVertices(geometry, 1e-4);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    // STL has no up-axis convention; a standing figure is tallest along its up axis
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    if (size.z > size.y && size.z > size.x) geometry.rotateX(-Math.PI / 2);
    geometry.computeBoundingBox();
    const h = geometry.boundingBox.getSize(new THREE.Vector3()).y;
    const mesh = new THREE.Mesh(geometry, createProceduralMarble({ height: h }));
    mesh.name = 'StatueSTL';
    return { object: mesh, kind: 'stl' };
  }
  const draco = new DRACOLoader(manager).setDecoderPath(dracoPath);
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync(url, onBytes);
    return { object: gltf.scene, kind: 'gltf' };
  } finally {
    draco.dispose();
  }
}

/**
 * Normalise the statue: turn it by `yaw`, scale it to `height`, stand its base on y = 0 centred on
 * the footprint, and make the stone read as stone (metalness 0, roughness ~0.45, Meshy maps kept).
 * Returns { root, center, radius, height, averageColor }. The footprint sits on the vertical axis
 * x = z = 0, which the stage turns the statue about. `center` and `radius` describe a sphere centred
 * on that axis that contains every vertex at any turn (used to keep the statue clear of the ring).
 */
export function prepareStatue(object, { kind, height = 2, yaw = Math.PI, roughness = 0.45 } = {}) {
  const spin = new THREE.Group();
  spin.rotation.y = yaw;
  spin.add(object);
  const root = new THREE.Group();
  root.name = 'Statue';
  root.add(spin);

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  root.scale.setScalar(height / (box.max.y - box.min.y));
  root.updateMatrixWorld(true);
  box.setFromObject(root, true);

  // centre on the plinth's footprint (lowest 4% of the model), not on the whole box
  const cut = box.min.y + 0.04 * (box.max.y - box.min.y);
  const base = new THREE.Box3();
  const v = new THREE.Vector3();
  forEachVertex(root, (p) => { if (p.y <= cut) base.expandByPoint(p); }, v);
  const foot = (base.isEmpty() ? box : base).getCenter(new THREE.Vector3());
  root.position.set(-foot.x, -box.min.y, -foot.z);
  root.updateMatrixWorld(true);

  // bounding sphere on the turning axis, at mid-height: turning about y keeps x² + z² per vertex,
  // so this sphere contains every vertex at any turn
  box.setFromObject(root, true);
  const center = new THREE.Vector3(0, box.getCenter(v).y, 0);
  let radius = 0;
  forEachVertex(root, (p) => { radius = Math.max(radius, p.distanceTo(center)); }, v);

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.layers.enable(STATUE_LAYER);
    for (const m of [].concat(o.material)) {
      if (kind === 'gltf' && m.isMeshStandardMaterial) {
        m.metalness = 0;
        m.roughness = roughness;
      }
      if (m.isMeshStandardMaterial) m.envMapIntensity = 0.45;
    }
  });

  return { root, center, radius, height, averageColor: averageStoneColor(root) };
}

function forEachVertex(root, fn, v) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
}

/** Average base colour of the statue (texture x colour) in sRGB, to tint the ring to match. */
function averageStoneColor(root) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let r = 0, g = 0, b = 0, n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      const tint = m.color ? m.color.clone().convertLinearToSRGB() : new THREE.Color(1, 1, 1);
      if (m.map?.image) {
        try { ctx.drawImage(m.map.image, 0, 0, 32, 32); } catch { continue; }
        const d = ctx.getImageData(0, 0, 32, 32).data;
        let sr = 0, sg = 0, sb = 0, k = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 8 || d[i] + d[i + 1] + d[i + 2] < 24) continue; // unused atlas space
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; k++;
        }
        if (k) { r += (sr / k / 255) * tint.r; g += (sg / k / 255) * tint.g; b += (sb / k / 255) * tint.b; n++; }
      } else if (m.color) {
        r += tint.r; g += tint.g; b += tint.b; n++;
      }
    }
  });
  return n ? new THREE.Color().setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace) : null;
}
