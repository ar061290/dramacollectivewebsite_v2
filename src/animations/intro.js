// Curtain-up: darkness, the spotlight fades up, the ring appears, the name rises letter by letter,
// then the tagline and the scroll cue. About 2.5 s; any input skips to the end.
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText.js';

const SKIP_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

export function playIntro({ hero, light, scrollCue, reduced, onComplete }) {
  const q = (name) => hero.querySelector(`[data-intro="${name}"]`);
  const eyebrow = q('eyebrow'), title = q('title'), rule = q('rule'), tagline = q('tagline'), cue = q('cue');
  const finish = () => {
    document.documentElement.classList.remove('is-intro');
    scrollCue?.play();
    onComplete?.();
  };

  if (reduced) {
    // no sequence: everything is simply there
    light.set(1, 1);
    gsap.set([eyebrow, title, rule, tagline, cue], { autoAlpha: 1, clearProps: 'transform' });
    finish();
    return null;
  }

  const split = SplitText.create(title, { type: 'words,chars', mask: 'chars', aria: 'auto' });
  const tl = gsap.timeline({
    defaults: { ease: 'curtain' },
    onComplete: () => {
      split.revert();
      removeSkip();
      finish();
    },
  });
  tl.set(title, { autoAlpha: 1 }, 0)
    .add(light.tween({ stageLight: 1, duration: 1.0, ease: 'power2.out' }), 0)
    .add(light.tween({ ringReveal: 1, duration: 0.7, ease: 'power1.out' }), 0.7)
    .fromTo(eyebrow, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 0.9)
    .from(split.chars, { yPercent: 115, duration: 0.7, stagger: 0.03 }, 1.0)
    .fromTo(rule, { autoAlpha: 1, scaleX: 0 }, { scaleX: 1, duration: 0.5 }, 1.55)
    .fromTo(tagline, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.6 }, 1.7)
    .fromTo(cue, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 2.1);

  const skip = () => tl.progress(1);
  const removeSkip = () => SKIP_EVENTS.forEach((e) => window.removeEventListener(e, skip));
  SKIP_EVENTS.forEach((e) => window.addEventListener(e, skip, { once: true, passive: true }));
  return tl;
}
