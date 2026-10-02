/* The page's dot field: one fixed canvas behind the whole app.
 *
 * A physio's posture board is a field of dots with a plumb line hanging through
 * it. Here that field is the page itself:
 *  - dots near the cursor are pushed aside and lift, then spring back;
 *  - a click or tap sends a ripple through the field from where it landed;
 *  - the lattice drifts at a fraction of the scroll speed, so it reads as a
 *    surface behind the content rather than a pattern printed on it;
 *  - on the intro, a plumb line hangs through the field from [data-plumb-zone],
 *    follows the pointer on a spring and settles back to true vertical.
 *
 * Cost control: it draws only while something is moving, sleeps otherwise, and
 * draws every resting dot as one path. Under prefers-reduced-motion it draws one
 * still frame and listens for nothing but resizes. */

const GAP = 24;
const REST_RADIUS = 1.15;
const REST_ALPHA = 0.2;
const SCRUB = '31, 110, 140';
const INK = '#0E2230';
const MARKER = '#D6402A';

const CURSOR_RADIUS = 130;     // how far the cursor's push reaches
const CURSOR_PUSH = 16;        // px a dot right under the cursor is moved
const RIPPLE_SPEED = 900;      // px per second
const RIPPLE_LIFE = 1.1;       // seconds
const RIPPLE_WIDTH = 70;
const PARALLAX = 0.18;         // field drift as a fraction of scroll

const PLUMB_STIFFNESS = 34;
const PLUMB_DAMPING = 4.2;
const OFF_VERTICAL_DEG = 3.5;

export function initField() {
  const canvas = document.querySelector('canvas.field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let cols = 0;
  let rows = 0;
  let dots = new Float32Array(0);   // per dot: dx, dy, lift (eased toward targets)
  let frame = 0;
  let last = 0;
  let lastActivity = 0;

  const pointer = { x: -9999, y: -9999, inside: false };
  const ripples = [];

  /* The plumb line lives in viewport coordinates of its zone. */
  const plumb = { zone: null, readout: null, x: 0, v: 0, active: false, primed: false };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* One spare row and column so the drifting lattice never shows an edge. */
    cols = Math.ceil(width / GAP) + 2;
    rows = Math.ceil(height / GAP) + 2;
    dots = new Float32Array(cols * rows * 3);
    wake();
  }

  /* -------------------------------------------------------------- plumb --- */

  function plumbGeometry() {
    if (!plumb.zone || !plumb.zone.offsetParent) return null;   // hidden screen
    const box = plumb.zone.getBoundingClientRect();
    if (box.bottom < 0 || box.top > height || !box.width) return null;
    const anchorX = box.left + box.width / 2;
    if (!plumb.primed) {
      /* Opens pulled to one side, so the first thing the page does is swing
         and settle: the whole idea in one gesture. */
      plumb.x = reduced ? anchorX : anchorX + Math.min(140, box.width * 0.3);
      plumb.primed = true;
    }
    return { anchorX, anchorY: box.top, bobY: box.top + box.height * 0.86, box };
  }

  function stepPlumb(geo, dt) {
    const inZone = pointer.inside
      && pointer.y >= geo.box.top && pointer.y <= geo.box.bottom
      && pointer.x >= geo.box.left - 120 && pointer.x <= geo.box.right + 40;
    plumb.active = inZone;
    const target = inZone ? Math.max(geo.box.left + 20, Math.min(geo.box.right - 20, pointer.x)) : geo.anchorX;
    plumb.v += (PLUMB_STIFFNESS * (target - plumb.x) - PLUMB_DAMPING * plumb.v) * dt;
    plumb.x += plumb.v * dt;
  }

  function plumbAngle(geo) {
    return (Math.atan2(plumb.x - geo.anchorX, geo.bobY - geo.anchorY) * 180) / Math.PI;
  }

  /* Distance from a point to the plumb string, for lifting dots along it. */
  function stringDistance(geo, px, py) {
    const ax = geo.anchorX; const ay = geo.anchorY;
    const dx = plumb.x - ax; const dy = geo.bobY - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* --------------------------------------------------------------- draw --- */

  function draw(dt) {
    ctx.clearRect(0, 0, width, height);
    const now = performance.now() / 1000;
    const drift = -((window.scrollY * PARALLAX) % GAP);
    const geo = plumbGeometry();
    if (geo && !reduced) stepPlumb(geo, dt);

    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      if (now - ripples[i].t > RIPPLE_LIFE) ripples.splice(i, 1);
    }

    let moving = false;
    const rest = new Path2D();
    const ease = reduced ? 1 : Math.min(1, dt * 12);

    for (let r = 0; r < rows; r += 1) {
      const baseY = (r - 1) * GAP + drift + GAP / 2;
      for (let c = 0; c < cols; c += 1) {
        const k = (r * cols + c) * 3;
        const baseX = (c - 1) * GAP + GAP / 2;

        let tx = 0; let ty = 0; let lift = 0;

        if (pointer.inside && !reduced) {
          const ddx = baseX - pointer.x; const ddy = baseY - pointer.y;
          const dist = Math.hypot(ddx, ddy);
          if (dist < CURSOR_RADIUS && dist > 0.01) {
            const f = (1 - dist / CURSOR_RADIUS) ** 2;
            tx += (ddx / dist) * f * CURSOR_PUSH;
            ty += (ddy / dist) * f * CURSOR_PUSH;
            lift = Math.max(lift, f);
          }
        }

        for (const ripple of ripples) {
          const age = now - ripple.t;
          const front = age * RIPPLE_SPEED;
          const ddx = baseX - ripple.x; const ddy = baseY - ripple.y;
          const dist = Math.hypot(ddx, ddy);
          const band = 1 - Math.abs(dist - front) / RIPPLE_WIDTH;
          if (band > 0 && dist > 0.01) {
            const strength = band * (1 - age / RIPPLE_LIFE);
            tx += (ddx / dist) * strength * 10;
            ty += (ddy / dist) * strength * 10;
            lift = Math.max(lift, strength);
          }
        }

        if (geo) {
          const near = Math.exp(-((stringDistance(geo, baseX, baseY) / 34) ** 2));
          lift = Math.max(lift, near * 0.95);
        }

        dots[k] += (tx - dots[k]) * ease;
        dots[k + 1] += (ty - dots[k + 1]) * ease;
        dots[k + 2] += (lift - dots[k + 2]) * ease;
        if (Math.abs(tx - dots[k]) > 0.05 || Math.abs(lift - dots[k + 2]) > 0.01) moving = true;

        const x = baseX + dots[k];
        const y = baseY + dots[k + 1];
        const l = dots[k + 2];
        if (l < 0.02) {
          rest.moveTo(x + REST_RADIUS, y);
          rest.arc(x, y, REST_RADIUS, 0, Math.PI * 2);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, REST_RADIUS + l * 2.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${SCRUB}, ${REST_ALPHA + l * 0.6})`;
          ctx.fill();
        }
      }
    }
    ctx.fillStyle = `rgba(${SCRUB}, ${REST_ALPHA})`;
    ctx.fill(rest);

    if (geo) {
      drawPlumb(geo);
      if (!reduced && (Math.abs(plumb.v) > 0.02 || Math.abs(plumb.x - geo.anchorX) > 0.05 || plumb.active)) moving = true;
    }

    return moving || ripples.length > 0;
  }

  function drawPlumb(geo) {
    const angle = plumbAngle(geo);

    /* True vertical, faint and dashed: the reference the string is read against. */
    ctx.save();
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = 'rgba(14, 34, 48, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(geo.anchorX, geo.anchorY);
    ctx.lineTo(geo.anchorX, geo.box.bottom);
    ctx.stroke();
    ctx.restore();

    if (Math.abs(angle) > 0.4) {
      const start = Math.PI / 2;
      const end = Math.PI / 2 - (angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(geo.anchorX, geo.anchorY, 70, Math.min(start, end), Math.max(start, end));
      ctx.strokeStyle = `rgba(${SCRUB}, 0.85)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(geo.anchorX, geo.anchorY);
    ctx.lineTo(plumb.x, geo.bobY);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    /* The bob, a diamond as in the wordmark. */
    ctx.save();
    ctx.translate(plumb.x, geo.bobY);
    ctx.rotate((-angle * Math.PI) / 180);
    ctx.shadowColor = 'rgba(214, 64, 42, 0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.moveTo(0, -3); ctx.lineTo(12, 13); ctx.lineTo(0, 29); ctx.lineTo(-12, 13);
    ctx.closePath();
    ctx.fillStyle = MARKER;
    ctx.fill();
    ctx.restore();

    if (plumb.readout) {
      const off = Math.abs(angle);
      plumb.readout.textContent = `${off.toFixed(1)}° off vertical`;
      plumb.readout.toggleAttribute('data-off', off >= OFF_VERTICAL_DEG);
      /* The chip rides beside the bob on a solid background, so it reads over
         anything. Positioned relative to its zone. */
      const left = plumb.x - geo.box.left + 22;
      const top = geo.bobY - geo.box.top + 2;
      plumb.readout.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    }
  }

  /* --------------------------------------------------------------- loop --- */

  function tick(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    const busy = draw(dt);
    /* Keep running briefly after the last input so springs finish settling. */
    if (busy || now - lastActivity < 400) frame = requestAnimationFrame(tick);
    else frame = 0;
  }

  function wake() {
    lastActivity = performance.now();
    if (reduced) { draw(1); return; }
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------- inputs --- */

  window.addEventListener('resize', resize);
  window.addEventListener('scroll', wake, { passive: true });

  if (!reduced) {
    window.addEventListener('pointermove', (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.inside = event.pointerType === 'mouse' || event.pointerType === 'pen' || event.buttons > 0;
      wake();
    }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer.inside = false; wake(); });
    window.addEventListener('blur', () => { pointer.inside = false; wake(); });
    window.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'mouse') { pointer.inside = false; wake(); }
    });
    window.addEventListener('pointerdown', (event) => {
      ripples.push({ x: event.clientX, y: event.clientY, t: performance.now() / 1000 });
      if (ripples.length > 6) ripples.shift();
      wake();
    }, { passive: true });
  }

  /* The plumb zone exists only on the intro; re-find it when screens change. */
  const findPlumb = () => {
    plumb.zone = document.querySelector('[data-plumb-zone]');
    plumb.readout = document.querySelector('[data-plumb-readout]');
    wake();
  };
  document.addEventListener('screenchange', findPlumb);
  findPlumb();

  resize();
}
