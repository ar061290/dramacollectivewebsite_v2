// The statue answers the cursor: it leans toward it (Stage), the key light leans in when the cursor
// is over it, and a horizontal drag turns it, with a fling on release. On touch, a sideways drag
// that starts on the statue turns it; vertical drags scroll the page as usual.
//
// The statue sits on the fixed stage under the scrolling content, so hits are tested against the
// stage's silhouette mask rather than DOM targets. Text, links and controls always win.

const BLOCKERS = 'a, button, input, select, textarea, label, [data-mask], .topbar, .curtain';

export function setupStatueInteraction({ stage, sky }) {
  const root = document.documentElement;
  let drag = null; // { id, type, x0, y0, x, t, v, mode }

  const onStatue = (e) => !e.target?.closest?.(BLOCKERS) && stage.covers(e.clientX, e.clientY);

  const setHover = (on) => {
    stage.setHover(on);
    root.classList.toggle('is-over-statue', on);
  };

  const begin = (e) => {
    drag = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, t: performance.now(), v: 0, mode: null };
  };

  const end = () => {
    if (!drag) return;
    if (drag.mode === 'turn') {
      // no fling if the hand stopped before letting go
      const still = performance.now() - drag.t > 90;
      stage.release(still ? 0 : drag.v);
      if (sky) sky.suspended = false;
    }
    drag = null;
    root.classList.remove('is-grabbing');
  };

  const onDown = (e) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0) || !onStatue(e)) return;
    begin(e);
    if (e.pointerType === 'mouse') {
      e.preventDefault(); // no text selection while turning the statue
      startTurn();
    }
  };

  const startTurn = () => {
    drag.mode = 'turn';
    stage.grab();
    if (sky) sky.suspended = true;
    root.classList.add('is-grabbing');
  };

  const onMove = (e) => {
    if (!drag) {
      if (e.pointerType === 'mouse') setHover(onStatue(e));
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (!drag.mode) {
      // touch: decide between turning the statue (sideways) and scrolling the page (vertical)
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) startTurn();
      else if (Math.abs(dy) > 8) { drag = null; return; }
      else return;
    }
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dt = Math.max(1, now - drag.t) / 1000;
    stage.dragBy(dx);
    drag.v = drag.v * 0.6 + (dx / dt) * 0.4; // smoothed release speed, px/s
    drag.x = e.clientX;
    drag.t = now;
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    end();
    if (e.pointerType === 'mouse') setHover(onStatue(e));
  };
  const onLeave = () => { if (!drag) setHover(false); };

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onUp, { passive: true });
  window.addEventListener('blur', end);
  root.addEventListener('pointerleave', onLeave, { passive: true });

  return () => {
    end();
    setHover(false);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', end);
    root.removeEventListener('pointerleave', onLeave);
  };
}
