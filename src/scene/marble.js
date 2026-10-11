// Procedural white marble for models that arrive without textures (the STL fallback).
// Object-space 3D noise veins, so no UVs are needed.

import * as THREE from 'three';

export function createProceduralMarble({ height = 1, color = 0xf1eee8, veinColor = 0x8b8d92, roughness = 0.45 } = {}) {
  const material = new THREE.MeshStandardMaterial({ name: 'ProceduralMarble', color, roughness, metalness: 0 });
  const uniforms = {
    uVeinColor: { value: new THREE.Color(veinColor) },
    uScale: { value: 4.0 / height },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMarblePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarblePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMarblePos;
uniform vec3 uVeinColor;
uniform float uScale;
float mHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i), mHash(i + vec3(1, 0, 0)), f.x), mix(mHash(i + vec3(0, 1, 0)), mHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0, 0, 1)), mHash(i + vec3(1, 0, 1)), f.x), mix(mHash(i + vec3(0, 1, 1)), mHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float mFbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * mNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vMarblePos * uScale;
  float t = p.x * 0.55 + p.y * 0.8 - p.z * 0.25 + mFbm(p * 0.9) * 4.0;
  float vein = pow(1.0 - smoothstep(0.0, 0.12, abs(sin(t * 3.14159))), 1.6) * smoothstep(0.35, 0.65, mFbm(p * 1.7 + 3.0));
  float fine = (1.0 - smoothstep(0.0, 0.06, abs(sin((p.y * 1.3 - p.x * 0.7 + mFbm(p * 2.3) * 3.0) * 6.0)))) * 0.35;
  diffuseColor.rgb *= 1.0 + (mFbm(p * 2.5) - 0.5) * 0.08;
  diffuseColor.rgb = mix(diffuseColor.rgb, uVeinColor, clamp(vein * 0.45 + fine * 0.25, 0.0, 0.6));
}`);
  };
  material.customProgramCacheKey = () => 'dc-procedural-marble';
  return material;
}
