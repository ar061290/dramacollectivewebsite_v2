// Deterministic gradient noise (3D Perlin for solid textures, periodic 2D Perlin for tileable maps).

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const perm = new Uint8Array(512);
{
  const rnd = mulberry32(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

function grad3(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

/** Classic improved Perlin noise, range roughly [-1, 1]. */
export function noise3(x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  X &= 255; Y &= 255; Z &= 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(grad3(perm[AA], x, y, z), grad3(perm[BA], x - 1, y, z), u),
         lerp(grad3(perm[AB], x, y - 1, z), grad3(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad3(perm[AA + 1], x, y, z - 1), grad3(perm[BA + 1], x - 1, y, z - 1), u),
         lerp(grad3(perm[AB + 1], x, y - 1, z - 1), grad3(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}

export function fbm3(x, y, z, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z);
    norm += amp;
    x = x * lacunarity + 17.1; y = y * lacunarity + 3.7; z = z * lacunarity + 9.3;
    amp *= gain;
  }
  return sum / norm;
}

// ---- periodic 2D gradient noise (tileable) ----

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pgrad(ix, iy, periodX, periodY, seed, x, y) {
  const px = ((ix % periodX) + periodX) % periodX;
  const py = ((iy % periodY) + periodY) % periodY;
  const a = hash2(px, py, seed) * Math.PI * 2;
  return Math.cos(a) * x + Math.sin(a) * y;
}

/** Perlin noise in 2D that tiles with integer periods (periodY defaults to periodX), range ~[-0.7, 0.7]. */
export function pnoise2(x, y, period, seed = 0, periodY = period) {
  const X = Math.floor(x), Y = Math.floor(y);
  const fx = x - X, fy = y - Y;
  const u = fade(fx), v = fade(fy);
  const n00 = pgrad(X, Y, period, periodY, seed, fx, fy);
  const n10 = pgrad(X + 1, Y, period, periodY, seed, fx - 1, fy);
  const n01 = pgrad(X, Y + 1, period, periodY, seed, fx, fy - 1);
  const n11 = pgrad(X + 1, Y + 1, period, periodY, seed, fx - 1, fy - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/** Tileable fBm on the unit square: u, v in [0, 1), base lattice period `period`. */
export function pfbm2(u, v, period, octaves = 5, seed = 0, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * pnoise2(u * p, v * p, p, seed + i * 101);
    norm += amp;
    p *= 2;
    amp *= gain;
  }
  return sum / norm;
}

export { mulberry32 };
