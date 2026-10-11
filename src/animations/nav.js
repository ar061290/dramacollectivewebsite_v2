// Top bar: hides on scroll down, returns on scroll up, gains the blurred ground once scrolled.
// Anchor links scroll smoothly (ScrollToPlugin) and move focus to their target.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';

export function setupNav({ reduced }) {
  const bar = document.querySelector('[data-topbar]');
  const toggle = bar.querySelector('[data-menu-toggle]');
  const sheet = bar.querySelector('[data-menu-sheet]');
  let menuOpen = false;

  const setMenu = (open) => {
    menuOpen = open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
    sheet.classList.toggle('is-open', open);
    if (open) bar.classList.remove('is-hidden');
  };
  const onToggle = () => setMenu(!menuOpen);
  const onKey = (e) => { if (e.key === 'Escape' && menuOpen) { setMenu(false); toggle.focus(); } };
  toggle.addEventListener('click', onToggle);
  window.addEventListener('keydown', onKey);

  const scrollWatch = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate(self) {
      const y = self.scroll();
      bar.classList.toggle('is-scrolled', y > 24);
      if (menuOpen) return;
      if (self.direction === 1 && y > 160) bar.classList.add('is-hidden');
      else if (self.direction === -1) bar.classList.remove('is-hidden');
    },
  });
  const onFocusIn = () => bar.classList.remove('is-hidden');
  bar.addEventListener('focusin', onFocusIn);

  // current section in the nav
  const links = [...bar.querySelectorAll('.topbar__links a')];
  const sectionTriggers = links.map((a) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return null;
    return ScrollTrigger.create({
      trigger: target,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle: (self) => {
        if (self.isActive) links.forEach((l) => l.toggleAttribute('aria-current', l === a));
        else a.removeAttribute('aria-current');
      },
    });
  }).filter(Boolean);

  const onClick = (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const target = id === '#' ? null : document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    setMenu(false);
    gsap.to(window, {
      duration: reduced ? 0 : 1.2,
      ease: 'power2.inOut',
      scrollTo: { y: target, autoKill: true },
      onComplete: () => {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        history.replaceState(null, '', id);
      },
    });
  };
  document.addEventListener('click', onClick);

  return () => {
    scrollWatch.kill();
    sectionTriggers.forEach((t) => t.kill());
    toggle.removeEventListener('click', onToggle);
    window.removeEventListener('keydown', onKey);
    bar.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('click', onClick);
  };
}
