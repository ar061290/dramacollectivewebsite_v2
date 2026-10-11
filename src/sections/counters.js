// Figures count up once when they come into view. The HTML already holds the final values, so
// without JavaScript, or with reduced motion, the right numbers are simply there.
import gsap from 'gsap';

export function setupCounters({ reduced }) {
  if (reduced) return () => {};
  const fmt = new Intl.NumberFormat('en-IN');
  const tweens = [];
  for (const el of document.querySelectorAll('[data-count], [data-count-range]')) {
    const final = el.textContent.trim();
    el.setAttribute('aria-label', final); // screen readers get the value, not the ticking
    const scrollTrigger = { trigger: el, start: 'top 88%', once: true };
    if (el.dataset.countRange) {
      const [a, b] = el.dataset.countRange.split(',').map(Number);
      const o = { a: 0, b: 0 };
      el.textContent = '0–0';
      tweens.push(gsap.to(o, {
        a, b, duration: 1.2, ease: 'power2.out', scrollTrigger,
        onUpdate: () => { el.textContent = `${Math.round(o.a)}–${Math.round(o.b)}`; },
        onComplete: () => { el.textContent = final; },
      }));
    } else {
      const target = Number(el.dataset.count);
      const prefix = el.dataset.prefix || '';
      const o = { v: 0 };
      el.textContent = `${prefix}0`;
      tweens.push(gsap.to(o, {
        v: target, duration: target > 100 ? 1.6 : 1.0, ease: 'power2.out', scrollTrigger,
        onUpdate: () => { el.textContent = prefix + fmt.format(Math.round(o.v)); },
        onComplete: () => { el.textContent = final; },
      }));
    }
  }
  return () => tweens.forEach((t) => { t.scrollTrigger?.kill(); t.kill(); });
}
