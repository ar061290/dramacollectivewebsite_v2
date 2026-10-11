// The star cursor (and the constellation pen). Desktop, fine pointers only.
// The star itself is a native cursor image set in CSS (layout.css), so the system draws it with no
// lag and pixel-exact clicks. This module only switches it on and keeps the "Drag" hint beside it.

export function setupCursor() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  const root = document.documentElement;
  const el = document.querySelector('.cursor');
  root.classList.add('has-cursor');
  if (!el) return () => root.classList.remove('has-cursor');

  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    el.classList.add('is-visible');
    el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
  };
  const onLeave = () => el.classList.remove('is-visible');
  window.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', onLeave);
    root.classList.remove('has-cursor');
  };
}
