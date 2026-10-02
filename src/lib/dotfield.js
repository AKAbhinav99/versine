/* The posture board on the intro screen.
 *
 * A physio assesses posture against a board of dots with a plumb line hanging
 * through it. This is that board, live: the line's bob follows the pointer on a
 * spring, swings, and settles back to true vertical when the pointer leaves,
 * and the dots nearest the line and the pointer lift toward them. The readout
 * underneath reports how far off vertical the line is, in the same units the
 * app measures shoulders in.
 *
 * It only animates while something is moving and the board is on screen, and it
 * draws a single still frame under prefers-reduced-motion. */

const GAP = 18;                 // dot spacing, matching --dot-gap
const SCRUB = [31, 110, 140];
const INK = '#0E2230';
const MARKER = '#D6402A';
const STIFFNESS = 34;           // spring pull toward the target
const DAMPING = 4.2;            // low enough to swing a few times before settling
const OFF_VERTICAL_DEG = 3.5;   // the readout turns red past the app's refer band

export function initDotfield() {
  const canvas = document.querySelector('[data-dotfield]');
  if (!canvas) return;
  const readout = document.querySelector('[data-dotfield-readout]');
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0;
  let height = 0;
  let dots = [];
  let frame = 0;
  let last = 0;
  let visible = true;
  const pointer = { x: 0, y: 0, active: false };
  const bob = { x: 0, v: 0 };

  const anchorX = () => width / 2;
  const bobY = () => height * 0.82;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const wasCentred = !width;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Centre the lattice so the plumb line runs down a column of dots. */
    const cols = Math.floor(width / GAP);
    const rows = Math.floor(height / GAP);
    const offsetX = (width - (cols - 1) * GAP) / 2;
    const offsetY = (height - (rows - 1) * GAP) / 2;
    dots = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) dots.push({ x: offsetX + c * GAP, y: offsetY + r * GAP, lift: 0 });
    }

    /* First layout: start the bob pulled to one side so the board opens with a
       swing that settles, which is the whole idea in one gesture. */
    if (wasCentred) bob.x = reduced ? anchorX() : anchorX() + width * 0.2;
    wake();
  }

  /* Distance from a point to the plumb string, for lifting dots near it. */
  function distanceToString(px, py) {
    const ax = anchorX(); const ay = 0;
    const bx = bob.x; const by = bobY();
    const dx = bx - ax; const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function angleDeg() {
    return (Math.atan2(bob.x - anchorX(), bobY()) * 180) / Math.PI;
  }

  function step(dt) {
    const target = pointer.active ? Math.max(24, Math.min(width - 24, pointer.x)) : anchorX();
    const accel = STIFFNESS * (target - bob.x) - DAMPING * bob.v;
    bob.v += accel * dt;
    bob.x += bob.v * dt;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const by = bobY();

    for (const dot of dots) {
      const nearString = Math.exp(-((distanceToString(dot.x, dot.y) / 30) ** 2));
      const nearPointer = pointer.active
        ? Math.exp(-((Math.hypot(dot.x - pointer.x, dot.y - pointer.y) / 64) ** 2))
        : 0;
      const goal = Math.max(nearString, nearPointer * 0.85);
      dot.lift += (goal - dot.lift) * (reduced ? 1 : 0.18);

      const radius = 1.1 + dot.lift * 2.1;
      const alpha = 0.2 + dot.lift * 0.62;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${SCRUB[0]}, ${SCRUB[1]}, ${SCRUB[2]}, ${alpha})`;
      ctx.fill();
    }

    /* True vertical, faint and dashed: what the string is measured against. */
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(14, 34, 48, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(anchorX(), 0);
    ctx.lineTo(anchorX(), height);
    ctx.stroke();
    ctx.restore();

    /* The angle between them, as an arc at the anchor once it is visible. */
    const angle = angleDeg();
    if (Math.abs(angle) > 0.4) {
      const start = Math.PI / 2;
      const end = Math.PI / 2 - (angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(anchorX(), 0, 54, Math.min(start, end), Math.max(start, end));
      ctx.strokeStyle = `rgba(${SCRUB.join(',')}, 0.8)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    /* The string. */
    ctx.beginPath();
    ctx.moveTo(anchorX(), 0);
    ctx.lineTo(bob.x, by);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    /* The bob: a diamond, as in the wordmark. */
    ctx.save();
    ctx.translate(bob.x, by);
    ctx.rotate((-angle * Math.PI) / 180);
    ctx.shadowColor = 'rgba(214, 64, 42, 0.35)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(0, -2); ctx.lineTo(9, 10); ctx.lineTo(0, 22); ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fillStyle = MARKER;
    ctx.fill();
    ctx.restore();

    if (readout) {
      const off = Math.abs(angle);
      readout.textContent = `${off.toFixed(1)}° off vertical`;
      readout.toggleAttribute('data-off', off >= OFF_VERTICAL_DEG);
    }
  }

  function settled() {
    if (pointer.active) return false;
    const still = Math.abs(bob.v) < 0.02 && Math.abs(bob.x - anchorX()) < 0.05;
    return still && dots.every((dot) => Math.abs(dot.lift - Math.exp(-((distanceToString(dot.x, dot.y) / 30) ** 2))) < 0.01);
  }

  function tick(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    step(dt);
    draw();
    if (visible && !settled()) frame = requestAnimationFrame(tick);
    else frame = 0;
  }

  function wake() {
    if (reduced) { bob.x = anchorX(); bob.v = 0; draw(); return; }
    if (frame || !visible) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  const toLocal = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
  };

  if (!reduced) {
    canvas.addEventListener('pointermove', (event) => { toLocal(event); pointer.active = true; wake(); });
    canvas.addEventListener('pointerdown', (event) => { toLocal(event); pointer.active = true; wake(); });
    canvas.addEventListener('pointerleave', () => { pointer.active = false; wake(); });
    canvas.addEventListener('pointerup', (event) => { if (event.pointerType !== 'mouse') { pointer.active = false; wake(); } });
    canvas.addEventListener('pointercancel', () => { pointer.active = false; wake(); });

    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
    }).observe(canvas);
  }

  new ResizeObserver(resize).observe(canvas);
}
