// Boot: loader, stage (lazy), constellation sky, scroll scenes, reveals, nav, cursor, theme,
// music, intro.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import { SplitText } from 'gsap/SplitText.js';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin.js';
import { CustomEase } from 'gsap/CustomEase.js';
import { reducedMotion, probeWebGL, prefersStatic, readToken } from './util/env.js';
import { ConstellationField } from './constellation/Constellation.js';
import { loadLottie, freeze } from './animations/lottie.js';
import { playIntro } from './animations/intro.js';
import { setupNav } from './animations/nav.js';
import { setupCursor } from './animations/cursor.js';
import { setupReveals } from './sections/reveals.js';
import { setupCounters } from './sections/counters.js';
import { setupScenes } from './sections/scenes.js';
import { setupTheme, skyTheme, currentTheme } from './ui/theme.js';
import { setupMusic } from './ui/music.js';

gsap.registerPlugin(ScrollTrigger, SplitText, ScrollToPlugin, CustomEase);
CustomEase.create('curtain', '.22,.61,.36,1'); // --ease-curtain from the design system

const ASSETS = {
  statue: new URL('../assets/models/statue.glb', import.meta.url).href,
  albedo: new URL('../assets/textures/ring-albedo.webp', import.meta.url).href,
  normal: new URL('../assets/textures/ring-normal.webp', import.meta.url).href,
};

const reduced = reducedMotion();
const cleanups = [];
let stage = null;
let sky = null;

async function boot() {
  // the theme and music switches work from the first moment, before the stage has loaded
  cleanups.push(setupMusic({ reduced }));
  cleanups.push(setupTheme({
    reduced,
    onChange: (theme) => {
      sky?.setTheme(skyTheme());
      if (stage) gsap.to(stage.state, { daylight: theme === 'light' ? 1 : 0, duration: reduced ? 0 : 0.7, ease: 'sine.inOut', overwrite: 'auto' });
    },
  }));

  const loader = document.querySelector('.loader');
  const status = document.querySelector('[data-loader-status]');
  const loaderAnim = await loadLottie(document.querySelector('[data-lottie="loader"]'), 'loader', { loop: !reduced, autoplay: !reduced });
  if (reduced) freeze(loaderAnim, 60);

  // the sky works everywhere, even without WebGL
  sky = new ConstellationField({
    canvas: document.querySelector('.stage__stars'),
    theme: skyTheme(),
    reducedMotion: reduced,
    covers: (x, y) => (stage ? stage.covers(x, y) : false),
  });

  // live scene or the still picture
  const gl = probeWebGL();
  if (gl.ok && !prefersStatic(gl.renderer)) {
    try {
      const [{ Stage }, { setupStatueInteraction }] = await Promise.all([
        import('./scene/Stage.js'),
        import('./scene/interaction.js'),
      ]);
      app.setupStatueInteraction = setupStatueInteraction;
      stage = new Stage({
        container: document.querySelector('.stage__gl'),
        reducedMotion: reduced,
        colors: {
          warm: readToken('--gold-300'),
          cool: readToken('--slate-200'),
          rim: readToken('--slate-300'),
          floor: readToken('--plum-800'),
        },
      });
      stage.state.daylight = currentTheme() === 'light' ? 1 : 0;
      await stage.load({
        statueUrl: ASSETS.statue,
        textureUrls: { albedo: ASSETS.albedo, normal: ASSETS.normal },
        onProgress: (p) => { status.textContent = `Lighting the stage · ${Math.round(p * 100)}%`; },
      });
    } catch (err) {
      console.error('Stage failed, showing the still picture instead.', err);
      stage?.dispose();
      stage = null;
    }
  }
  const still = document.querySelector('.stage__fallback');
  if (!stage) {
    still.hidden = false;
    // never let a stalled decode hold the curtain
    await Promise.race([still.decode().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  }

  await document.fonts.ready;

  // curtain: loader out
  loaderAnim?.stop();
  await gsap.to(loader, { autoAlpha: 0, duration: reduced ? 0 : 0.45, ease: 'curtain' });
  loader.classList.add('is-done');
  loaderAnim?.destroy();

  if (stage) {
    stage.renderOnce();
    stage.start();
    cleanups.push(setupScenes({ stage }));
    cleanups.push(app.setupStatueInteraction({ stage, sky }));
    const onPointer = (e) => {
      if (e.pointerType !== 'mouse' || reduced) return;
      stage.setPointer((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    cleanups.push(() => window.removeEventListener('pointermove', onPointer));
  }
  sky.start();

  cleanups.push(setupNav({ reduced }));
  cleanups.push(setupCursor({ reduced }));
  cleanups.push(setupReveals({ reduced }));
  cleanups.push(setupCounters({ reduced }));
  await setupLotties();

  // what the intro animates: the live lights, or the still picture's opacity
  const light = stage
    ? {
        set: (s, r) => Object.assign(stage.state, { stageLight: s, ringReveal: r }),
        tween: (vars) => gsap.to(stage.state, vars),
      }
    : {
        set: () => gsap.set(still, { autoAlpha: 1 }),
        tween: (vars) => gsap.fromTo(still, { autoAlpha: 0 }, { autoAlpha: 1, duration: vars.duration, ease: vars.ease }),
      };
  if (!stage && !reduced) gsap.set(still, { autoAlpha: 0 });
  playIntro({
    hero: document.querySelector('.hero'),
    light,
    scrollCue: app.scrollCue,
    reduced,
    onComplete: () => ScrollTrigger.refresh(),
  });

  watchVisibility();
}

const app = { scrollCue: null, setupStatueInteraction: null };

async function setupLotties() {
  // nav mark: the curtain rises on the mark once, and again on hover
  const markHost = document.querySelector('[data-lottie="mask-mark"]');
  const mark = await loadLottie(markHost, 'mask-mark');
  if (mark) {
    markHost.querySelector('img')?.remove();
    if (reduced) freeze(mark, mark.totalFrames - 1);
    else mark.play();
    const replay = () => { if (!reduced) mark.goToAndPlay(0, true); };
    const brand = markHost.closest('a');
    brand.addEventListener('mouseenter', replay);
    cleanups.push(() => { brand.removeEventListener('mouseenter', replay); mark.destroy(); });
  }

  // scroll cue: a slow descending dot (static frame with reduced motion)
  const cue = await loadLottie(document.querySelector('[data-lottie="scroll-cue"]'), 'scroll-cue', { loop: !reduced });
  if (cue) {
    if (reduced) freeze(cue, 60);
    app.scrollCue = reduced ? null : cue;
    cleanups.push(() => cue.destroy());
  }

  // CTA flourish: a gold rule draws under the button, then a small star
  const ctaHost = document.querySelector('[data-lottie="cta-flourish"]');
  const flourish = await loadLottie(ctaHost, 'cta-flourish');
  if (flourish) {
    const button = document.querySelector('[data-cta]');
    const on = () => { if (reduced) freeze(flourish, flourish.totalFrames - 1); else { flourish.setDirection(1); flourish.play(); } };
    const off = () => { if (reduced) freeze(flourish, 0); else { flourish.setDirection(-1); flourish.play(); } };
    button.addEventListener('mouseenter', on);
    button.addEventListener('focus', on);
    button.addEventListener('mouseleave', off);
    button.addEventListener('blur', off);
    cleanups.push(() => {
      button.removeEventListener('mouseenter', on);
      button.removeEventListener('focus', on);
      button.removeEventListener('mouseleave', off);
      button.removeEventListener('blur', off);
      flourish.destroy();
    });
  }
}

// Pause both canvases when the tab is hidden or the stage is covered by the footer.
function watchVisibility() {
  let stageInView = true;
  const apply = () => {
    const run = !document.hidden && stageInView;
    if (run) { stage?.start(); sky?.start(); } else { stage?.stop(); sky?.stop(); }
  };
  const io = new IntersectionObserver(([entry]) => { stageInView = entry.isIntersecting; apply(); });
  io.observe(document.querySelector('main'));
  document.addEventListener('visibilitychange', apply);
  cleanups.push(() => { io.disconnect(); document.removeEventListener('visibilitychange', apply); });
}

/** Tear everything down: GPU resources, listeners, ScrollTriggers, SplitTexts, Lotties. */
export function destroy() {
  while (cleanups.length) {
    try { cleanups.pop()?.(); } catch (err) { console.warn(err); }
  }
  ScrollTrigger.getAll().forEach((t) => t.kill());
  sky?.dispose();
  stage?.dispose();
  sky = null;
  stage = null;
}

window.addEventListener('pagehide', (e) => { if (!e.persisted) destroy(); });
window.dramaCollective = { destroy, get stage() { return stage; }, get sky() { return sky; } };

boot();
