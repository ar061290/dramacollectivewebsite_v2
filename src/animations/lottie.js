// lottie-web, light build (SVG renderer only, no expressions). Each file is under 50 KB.
import lottie from 'lottie-web/build/player/lottie_light.js';

const FILES = {
  loader: new URL('../../assets/lottie/loader.json', import.meta.url),
  'scroll-cue': new URL('../../assets/lottie/scroll-cue.json', import.meta.url),
  'mask-mark': new URL('../../assets/lottie/mask-mark.json', import.meta.url),
  'cta-flourish': new URL('../../assets/lottie/cta-flourish.json', import.meta.url),
};

/** Load a named animation into `container`. Resolves the lottie AnimationItem (or null). */
export async function loadLottie(container, name, { loop = false, autoplay = false } = {}) {
  if (!container || !FILES[name]) return null;
  try {
    const data = await (await fetch(FILES[name])).json();
    return lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop,
      autoplay,
      animationData: data,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    });
  } catch (err) {
    console.warn(`lottie ${name} failed`, err);
    return null;
  }
}

/** Stop an animation on a representative frame (reduced motion). */
export function freeze(anim, frame) {
  anim?.goToAndStop(frame ?? Math.floor(anim.totalFrames / 2), true);
}
