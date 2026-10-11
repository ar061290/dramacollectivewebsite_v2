// Penrose ring: a square-section "torus" whose sweep is split into two half-rings that lie in
// perpendicular planes. From one camera position (the hero camera) both halves project onto the
// same ellipse, so the image reads as a single closed ring whose faces trade places: the broad
// face of the lower half becomes the rim of the upper half and vice versa, exactly like the
// faces of a Penrose triangle. No face is colored differently; it is all geometry.
//
// Construction (perspective-exact):
//   * Lower half = half of circle A (radius R, center O, vertical plane yawed by psi).
//   * The cone from the camera C through circle A has a second family of circular sections
//     (Apollonius' subcontrary sections). Circle B is the one through J, the right end of A's
//     horizontal diameter. It projects onto exactly the same curve as circle A.
//   * psi is solved so that plane B is perpendicular to plane A. Then the square cross-sections
//     coincide at J (a real, seamless joint) and, at the far-left end, the two tube ends lie on the
//     same camera rays with identical face normals (the "fake" joint).
//   * The upper tube is scaled along its sweep by the depth ratio, so its image thickness matches.
//   * The camera sits at the height of the joints, so the tube end caps are exactly edge-on.

import { sdRoundRect } from './sdf-lib.js';

export const RING_DEFAULTS = {
  R: 2.0,              // centerline radius of the lower half-ring (m)
  side: 0.26,          // square cross-section side (m)
  corner: 0.024,       // rounded edge radius (m)
  cameraDistance: 12,  // hero camera distance from the ring center along +Z (m)
  segments: 360,       // sweep segments per half
  cornerSegments: 6,   // segments per rounded edge
  uvTile: 1.25,        // approx. texture repeat length along the sweep (m); V repeats twice around the profile
};

export function solveRing(opts = {}) {
  const o = { ...RING_DEFAULTS, ...opts };
  const { R, cameraDistance: D } = o;

  const construct = (psi) => {
    const ux = Math.cos(psi), uz = -Math.sin(psi);
    const nx = Math.sin(psi), nz = Math.cos(psi);
    const Jx = R * ux, Jz = R * uz, Lx = -R * ux, Lz = -R * uz;
    const CJ = Math.hypot(Jx, Jz - D);
    const CL = Math.hypot(Lx, Lz - D);
    const t = (CJ * CJ) / CL; // subcontrary section: |C L_B| * |C L_A| = |C J|^2
    const LBx = (Lx / CL) * t, LBz = D + ((Lz - D) / CL) * t;
    return { ux, uz, nx, nz, Jx, Jz, Lx, Lz, LBx, LBz, CJ, CL };
  };
  const f = (psi) => {
    const c = construct(psi);
    return (c.LBx - c.Jx) * c.nz - (c.LBz - c.Jz) * c.nx; // chord J->L_B parallel to plane A normal
  };
  let lo = 0.2, hi = 1.4, flo = f(lo);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi), fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
  }
  const psi = 0.5 * (lo + hi);
  const c = construct(psi);

  const uA = [c.ux, 0, c.uz];
  const nA = [c.nx, 0, c.nz];
  const J = [c.Jx, 0, c.Jz];
  const LA = [c.Lx, 0, c.Lz];
  const LB = [c.LBx, 0, c.LBz];
  const OB = [(J[0] + LB[0]) / 2, 0, (J[2] + LB[2]) / 2];
  const RB = Math.hypot(LB[0] - J[0], LB[2] - J[2]) / 2;
  const e = [(J[0] - OB[0]) / RB, 0, (J[2] - OB[2]) / RB];
  let nB = [-e[2], 0, e[0]]; // horizontal, perpendicular to e
  if ((0 - OB[0]) * nB[0] + (D - OB[2]) * nB[2] < 0) nB = [-nB[0], 0, -nB[2]];

  return { ...o, psi, uA, nA, J, LA, LB, OB, RB, e, nB, camera: [0, 0, D] };
}

/** Signed distance to the full torus that contains the lower half (used to seat the plinth). */
export function makeRingASdf(ring, inflate = 0) {
  const { uA, nA, R, side, corner } = ring;
  const h = side / 2 + inflate;
  return function (x, y, z) {
    const a1 = x * uA[0] + z * uA[2];
    const n = x * nA[0] + z * nA[2];
    const rho = Math.hypot(a1, y);
    return sdRoundRect(rho - R, n, h, h, corner + inflate);
  };
}

function makeProfile(side, corner, cornerSegments) {
  const h = side / 2, ci = h - corner;
  const pts = [];
  const centers = [[ci, ci], [-ci, ci], [-ci, -ci], [ci, -ci]];
  for (let q = 0; q < 4; q++) {
    for (let i = 0; i <= cornerSegments; i++) {
      const ang = (q + i / cornerSegments) * (Math.PI / 2);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      pts.push({ a: centers[q][0] + corner * ca, b: centers[q][1] + corner * sa, na: ca, nb: sa });
    }
  }
  let acc = 0;
  pts[0].v = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i].a - pts[i - 1].a, pts[i].b - pts[i - 1].b);
    pts[i].v = acc;
  }
  acc += Math.hypot(pts[0].a - pts[pts.length - 1].a, pts[0].b - pts[pts.length - 1].b);
  pts.push({ ...pts[0], v: acc }); // closing duplicate for UV continuity
  return pts;
}

/**
 * Sweep the rounded-square profile along a centerline.
 * sample(t) -> { p: centre, r: radial unit, n: plane normal unit, k: scale }
 */
// UVs: U = s.u (metres along circle A for the matching camera ray, so both halves show the same
// apparent texture density and meet exactly at both joints); V wraps around the profile via vMap.
function sweep(sample, t0, t1, segs, profile, uvTile, capAtEnd, vMap = (v) => v) {
  const positions = [], normals = [], uvs = [], indices = [];
  const np = profile.length;
  const perimeter = profile[np - 1].v;
  let arc = 0, prev = null;
  const frames = [];
  for (let i = 0; i <= segs; i++) {
    const t = t0 + ((t1 - t0) * i) / segs;
    const s = sample(t);
    if (prev) arc += Math.hypot(s.p[0] - prev.p[0], s.p[1] - prev.p[1], s.p[2] - prev.p[2]);
    prev = s;
    frames.push(s);
    for (let j = 0; j < np; j++) {
      const pr = profile[j];
      const a = pr.a * s.k, b = pr.b * s.k;
      positions.push(
        s.p[0] + a * s.r[0] + b * s.n[0],
        s.p[1] + a * s.r[1] + b * s.n[1],
        s.p[2] + a * s.r[2] + b * s.n[2]);
      normals.push(
        pr.na * s.r[0] + pr.nb * s.n[0],
        pr.na * s.r[1] + pr.nb * s.n[1],
        pr.na * s.r[2] + pr.nb * s.n[2]);
      uvs.push(s.u / uvTile, vMap(pr.v / perimeter));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < np - 1; j++) {
      const a = i * np + j, b = a + 1, c = a + np, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (capAtEnd) {
    const s = frames[capAtEnd === 'start' ? 0 : segs];
    const ring0 = capAtEnd === 'start' ? 0 : segs * np;
    const other = frames[capAtEnd === 'start' ? 1 : segs - 1];
    let tx = s.p[0] - other.p[0], ty = s.p[1] - other.p[1], tz = s.p[2] - other.p[2];
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const base = positions.length / 3;
    positions.push(s.p[0], s.p[1], s.p[2]); normals.push(tx, ty, tz); uvs.push(0, 0);
    for (let j = 0; j < np; j++) {
      const k = (ring0 + j) * 3;
      positions.push(positions[k], positions[k + 1], positions[k + 2]);
      normals.push(tx, ty, tz);
      uvs.push(profile[j].a / perimeter + 0.5, profile[j].b / perimeter + 0.5);
    }
    for (let j = 0; j < np - 1; j++) indices.push(base, base + 1 + j, base + 2 + j);
  }
  fixWinding(positions, normals, indices);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    arcLength: arc,
    uEnd: frames[segs].u,
  };
}

function fixWinding(P, N, I) {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const nx = N[a] + N[b] + N[c], ny = N[a + 1] + N[b + 1] + N[c + 1], nz = N[a + 2] + N[b + 2] + N[c + 2];
    if (fx * nx + fy * ny + fz * nz < 0) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  }
}

export function buildRing(opts = {}) {
  const ring = solveRing(opts);
  const { R, side, corner, cornerSegments, segments, uvTile, uA, nA, OB, RB, e, nB, camera } = ring;
  const profile = makeProfile(side, corner, cornerSegments);
  const P = profile[profile.length - 1].v;

  // Texture continuity. U: an even number of repeats per full (image-equivalent) circle, so U
  // matches at J and again at the far end. V: two repeats around the profile, because the upper
  // tube's cross-section is rotated by 90 degrees at J and by a further 180 degrees at the fake
  // joint relative to the lower tube.
  const repeats = Math.max(2, 2 * Math.round((2 * Math.PI * R) / uvTile / 2));
  const uTile = (2 * Math.PI * R) / repeats;
  const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const M = [dotv(e, uA), dotv(nB, uA), dotv(e, nA), dotv(nB, nA)]; // upper (a,b) -> lower (a,b) at J
  const det = M[0] * M[3] - M[1] * M[2];
  const a0 = profile[0].a, b0 = profile[0].b;
  const aL = M[0] * a0 + M[1] * b0, bL = M[2] * a0 + M[3] * b0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < profile.length - 1; i++) {
    const dd = (profile[i].a - aL) ** 2 + (profile[i].b - bL) ** 2;
    if (dd < bestD) { bestD = dd; best = i; }
  }
  const v0 = profile[best].v / P, dir = det > 0 ? 1 : -1;
  const vLower = (vn) => 2 * vn;
  const vUpper = (vn) => 2 * (v0 + dir * vn);

  // Lower half: circle A, theta in [pi, 2pi] (from the fake joint L_A round the bottom to J).
  const lower = sweep((th) => {
    const c = Math.cos(th), s = Math.sin(th);
    const r = [c * uA[0], s, c * uA[2]];
    return { p: [R * r[0], R * r[1], R * r[2]], r, n: nA, k: 1, u: R * (th - Math.PI) };
  }, Math.PI, 2 * Math.PI, segments, profile, uTile, 'start', vLower);

  // Upper half: circle B, phi in [0, pi] (from J over the top to the far end L_B).
  const C = camera;
  const depthRatio = (q) => {
    // Ray from the camera through q meets plane A at the matching point of circle A.
    const dx = q[0] - C[0], dy = q[1] - C[1], dz = q[2] - C[2];
    const t = -(C[0] * nA[0] + C[2] * nA[2]) / (dx * nA[0] + dz * nA[2]);
    return 1 / t; // |C q| / |C qA|
  };
  let maxRadiusError = 0;
  const upper = sweep((ph) => {
    const c = Math.cos(ph), s = Math.sin(ph);
    const r = [c * e[0], s, c * e[2]];
    const p = [OB[0] + RB * r[0], RB * r[1], OB[2] + RB * r[2]];
    const k = depthRatio(p);
    // sanity: the matching point must lie on circle A
    const qa = [C[0] + (p[0] - C[0]) / k, C[1] + (p[1] - C[1]) / k, C[2] + (p[2] - C[2]) / k];
    maxRadiusError = Math.max(maxRadiusError, Math.abs(Math.hypot(qa[0], qa[1], qa[2]) - R));
    let thA = Math.atan2(qa[1], qa[0] * uA[0] + qa[2] * uA[2]); // angle of the matching point on A
    if (thA < 0) thA = ph > Math.PI / 2 ? Math.PI : 0; // numerical -0 at the ends
    return { p, r, n: nB, k, u: Math.PI * R + R * thA };
  }, 0, Math.PI, segments, profile, uTile, 'end', vUpper);

  const uvCheck = { uAtFakeJoint: [0, upper.uEnd / uTile], uAtJ: [lower.uEnd / uTile, Math.PI * R / uTile], profileMapDet: det };
  return { ring, lower, upper, maxRadiusError, uvCheck };
}
