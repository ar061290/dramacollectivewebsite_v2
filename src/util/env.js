// Capability and preference checks, read once at boot.

const query = new URLSearchParams(location.search);

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
export const isMobileLayout = () => matchMedia('(max-width: 767px)').matches;

/** Probe WebGL once; returns { ok, renderer } where renderer is the unmasked GPU string if exposed. */
export function probeWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { ok: false, renderer: '' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer };
  } catch {
    return { ok: false, renderer: '' };
  }
}

/**
 * Low-power heuristic: software rasterisers, data-saver, or very small devices get the static
 * picture instead of the live scene. `?static` forces the picture, `?live` forces WebGL.
 */
export function prefersStatic(rendererString) {
  if (query.has('static')) return true;
  if (query.has('live')) return false;
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererString || '');
  const saveData = navigator.connection?.saveData === true;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  return software || saveData || cores <= 2 || memory <= 2;
}

/** Read a design token from :root (e.g. readToken('--gold-500')). */
export function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
