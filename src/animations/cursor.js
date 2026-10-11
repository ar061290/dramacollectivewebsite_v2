// A small star as the cursor (and the constellation pen). Desktop, fine pointers only.
import gsap from 'gsap';

export function setupCursor({ reduced }) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  const el = document.querySelector('.cursor');
  if (!el) return () => {};
  document.documentElement.classList.add('has-cursor');
  const xTo = gsap.quickTo(el, 'x', { duration: reduced ? 0.01 : 0.16, ease: 'power3' });
  const yTo = gsap.quickTo(el, 'y', { duration: reduced ? 0.01 : 0.16, ease: 'power3' });
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    el.classList.add('is-visible');
    xTo(e.clientX);
    yTo(e.clientY);
    el.classList.toggle('is-over-link', !!e.target.closest?.('a, button'));
  };
  const onLeave = () => el.classList.remove('is-visible');
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    document.documentElement.classList.remove('has-cursor');
  };
}
