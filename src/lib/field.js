/* The page's dot field: one fixed canvas behind the whole app.
 *
 * A physio's posture board is a field of dots with a plumb line hanging through
 * it. Here that board is the page itself, and it is meant to feel physical:
 *  - every dot sits on a spring, so whatever moves it overshoots a little and
 *    wobbles home, like a pin on a board rather than a pixel;
 *  - the cursor is a lens: dots near it swell, darken to scrub blue and part
 *    around it, and a fast-moving cursor drags a wake through them;
 *  - a click or tap sends a shockwave out from where it landed;
 *  - scrolling sends a wave through the lattice, and the lattice drifts at a
 *    fraction of the scroll speed, so it reads as a surface behind the content;
 *  - a slow swell rolls across the field at rest, so the page is never dead;
 *  - on the intro, a spine stands in the field (from [data-plumb-zone]). The
 *    pointer bends it into the S-curve of a scoliosis, a plumb line drops from
 *    the top vertebra, and the curve's angle is read off live, turning red at
 *    10 degrees, the angle at which a curve is called scoliosis.
 *
 * Cost: one canvas, the dots batched into a handful of paths by shade, the frame
 * rate halved once nothing has been touched for a few seconds, and nothing at
 * all while the tab is hidden (requestAnimationFrame stops). Under
 * prefers-reduced-motion it draws one still frame, spine straight. */

const GAP = 22;
const DOT = 1.25;                       // resting radius
const SHADES = 8;                       // fill buckets, from resting slate to scrub
const REST_RGB = [86, 110, 126];
const ACTIVE_RGB = [31, 110, 140];
const INK = '#0E2230';
const MARKER = '#D6402A';
const MARKER_RGB = '214, 64, 42';
const SCRUB_RGB = '31, 110, 140';

const SPRING = 170;                     // dot spring stiffness
const DAMPING = 13;                     // under-damped on purpose: a small wobble

const LENS_RADIUS = 170;
const LENS_PUSH = 26;
const WAKE = 0.045;                     // wake offset per px/s of cursor speed
const WAKE_MAX = 22;

const RIPPLE_SPEED = 1100;
const RIPPLE_LIFE = 1.2;
const RIPPLE_WIDTH = 80;
const RIPPLE_PUSH = 18;

const PARALLAX = 0.18;
const SCROLL_WAVE = 0.014;              // px of sway per px/s of scroll speed
const SCROLL_WAVE_MAX = 20;

const IDLE_AFTER = 4000;                // ms without input before halving the frame rate

/* Spine. Proportions are a plain anatomical stack: 12 thoracic and 5 lumbar
   vertebrae, widening toward the base, on a sacrum. */
const VERTEBRAE = 17;
const SPINE_K = 26;
const SPINE_C = 4.6;
const SCOLIOSIS_DEG = 10;

export function initField() {
  const canvas = document.querySelector('canvas.field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  /* The spine gets a canvas of its own, above the dots: the dot layer fades out
     toward the masthead (a CSS mask), and the spine must not fade with it. */
  const front = document.createElement('canvas');
  front.className = 'field field--front';
  front.setAttribute('aria-hidden', 'true');
  canvas.after(front);
  const fx = front.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fills = Array.from({ length: SHADES }, (_, i) => {
    const t = i / (SHADES - 1);
    const mix = (a, b) => Math.round(a + (b - a) * t);
    const alpha = (0.3 + 0.62 * t).toFixed(2);
    return `rgba(${mix(REST_RGB[0], ACTIVE_RGB[0])}, ${mix(REST_RGB[1], ACTIVE_RGB[1])}, ${mix(REST_RGB[2], ACTIVE_RGB[2])}, ${alpha})`;
  });

  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let dots = new Float32Array(0);   // per dot: ox, oy, vx, vy, lift
  let last = 0;
  let lastInput = 0;
  let skip = false;

  const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, inside: false, t: 0 };
  const ripples = [];
  const scroll = { y: window.scrollY, v: 0 };
  const spine = { zone: null, readout: null, amp: 0, vel: 0, primed: false };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    front.width = canvas.width;
    front.height = canvas.height;
    front.style.width = `${width}px`;
    front.style.height = `${height}px`;
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* One spare row and column so the drifting lattice never shows an edge. */
    cols = Math.ceil(width / GAP) + 2;
    rows = Math.ceil(height / GAP) + 2;
    dots = new Float32Array(cols * rows * 5);
    if (reduced) draw(0, 0);
  }

  /* -------------------------------------------------------------- spine --- */

  function spineGeometry() {
    if (!spine.zone || !spine.zone.offsetParent) return null;   // hidden screen
    const box = spine.zone.getBoundingClientRect();
    if (box.bottom < 0 || box.top > height || !box.width) return null;
    const top = box.top + box.height * 0.06;
    const length = box.height * 0.66;
    const scale = Math.max(0.5, Math.min(1.15, length / 560));
    const maxAmp = length * 0.058;   // a curve of about 40 degrees at full reach
    if (!spine.primed) {
      /* Opens bent, so the first thing the page does is straighten itself:
         the whole subject in one gesture. */
      spine.amp = reduced ? 0 : maxAmp * 0.9;
      spine.primed = true;
    }
    return { box, cx: box.left + box.width / 2, top, length, scale, maxAmp };
  }

  /* Lateral offset and tilt of the spine at t (0 top, 1 base). A compensated
     S: the thoracic curve one way, the lumbar the other, both ends on the
     plumb line, as a typical double curve sits. */
  const spineX = (geo, t) => geo.cx + spine.amp * Math.sin(Math.PI * 2 * t);
  const spineTilt = (geo, t) => Math.atan((spine.amp * Math.PI * 2 * Math.cos(Math.PI * 2 * t)) / geo.length);
  const halfWidth = (geo, t) => (19 + 13 * t) * geo.scale;

  /* The Cobb angle of the thoracic curve: the angle between the end vertebrae
     at its top and bottom, which for this curve is twice the tilt at the top. */
  const cobb = (geo) => Math.abs((2 * Math.atan((spine.amp * Math.PI * 2) / geo.length) * 180) / Math.PI);

  function stepSpine(geo, dt, now) {
    const reach = geo.box.width * 0.5;
    const over = pointer.inside
      && pointer.y >= geo.box.top - 40 && pointer.y <= geo.box.bottom + 40
      && pointer.x >= geo.box.left - 80 && pointer.x <= geo.box.right + 40;
    /* At rest it breathes, staying under the threshold; under the pointer it
       follows how far off centre the pointer is. */
    const target = over
      ? Math.max(-1, Math.min(1, (pointer.x - geo.cx) / reach)) * geo.maxAmp
      : Math.sin(now * 0.9) * geo.maxAmp * 0.16;
    spine.vel += (SPINE_K * (target - spine.amp) - SPINE_C * spine.vel) * dt;
    spine.amp += spine.vel * dt;
  }

  function drawSpine(geo) {
    const angle = cobb(geo);
    const alarm = Math.max(0, Math.min(1, (angle - SCOLIOSIS_DEG + 3) / 4));
    const spacing = geo.length / (VERTEBRAE - 1);
    const base = geo.top + geo.length;

    /* The plumb line, dropped from the top vertebra past the sacrum. */
    fx.save();
    fx.setLineDash([5, 7]);
    fx.strokeStyle = 'rgba(14, 34, 48, 0.35)';
    fx.lineWidth = 1.25;
    fx.beginPath();
    fx.moveTo(geo.cx, geo.top - spacing);
    fx.lineTo(geo.cx, base + spacing * 2.5);
    fx.stroke();
    fx.restore();

    /* Cobb lines: along the end plates at the top and the bottom of the upper
       curve, extended to where they would be measured. */
    if (angle > 2) {
      const side = spine.amp >= 0 ? -1 : 1;
      fx.save();
      fx.strokeStyle = `rgba(${alarm > 0.5 ? MARKER_RGB : SCRUB_RGB}, ${Math.min(0.9, angle / 12)})`;
      fx.lineWidth = 1.5;
      for (const t of [0, 0.5]) {
        const x = spineX(geo, t);
        const y = geo.top + t * geo.length;
        /* An end plate lies across the spine, perpendicular to its tangent. */
        const ux = Math.cos(spineTilt(geo, t));
        const uy = -Math.sin(spineTilt(geo, t));
        const hw = halfWidth(geo, t);
        const run = hw + 70 * geo.scale;
        fx.beginPath();
        fx.moveTo(x - ux * hw * side, y - uy * hw * side);
        fx.lineTo(x + ux * run * side, y + uy * run * side);
        fx.stroke();
      }
      fx.restore();
    }

    /* Sacrum: a rounded wedge under the last vertebra. */
    const sx = spineX(geo, 1);
    const sw = halfWidth(geo, 1) * 0.95;
    const sy = base + spacing * 0.55;
    fx.beginPath();
    fx.moveTo(sx - sw, sy - spacing * 0.1);
    fx.quadraticCurveTo(sx, sy - spacing * 0.3, sx + sw, sy - spacing * 0.1);
    fx.quadraticCurveTo(sx + sw * 0.45, sy + spacing * 1.2, sx, sy + spacing * 1.35);
    fx.quadraticCurveTo(sx - sw * 0.45, sy + spacing * 1.2, sx - sw, sy - spacing * 0.1);
    fx.fillStyle = '#FFFFFF';
    fx.lineWidth = 1.5;
    fx.strokeStyle = INK;
    fx.fill();
    fx.stroke();

    /* Vertebrae, rotated with the curve. Those around the apex of each curve
       tint toward marker red as the angle passes the threshold. */
    for (let i = 0; i < VERTEBRAE; i += 1) {
      const t = i / (VERTEBRAE - 1);
      const x = spineX(geo, t);
      const y = geo.top + t * geo.length;
      const hw = halfWidth(geo, t);
      const hh = spacing * 0.36;
      const apex = Math.abs(Math.sin(Math.PI * 2 * t)) ** 4;
      const heat = alarm * apex;

      fx.save();
      fx.translate(x, y);
      fx.rotate(-spineTilt(geo, t));
      /* Transverse processes, the wings either side, behind the body. */
      const wing = hw * (1.55 - 0.25 * t);
      fx.beginPath();
      fx.roundRect(-wing, -hh * 0.32, wing * 2, hh * 0.64, hh * 0.32);
      fx.fillStyle = '#FFFFFF';
      fx.fill();
      fx.lineWidth = 1.25;
      fx.strokeStyle = heat > 0.5 ? MARKER : 'rgba(14, 34, 48, 0.55)';
      fx.stroke();
      fx.beginPath();
      fx.roundRect(-hw, -hh, hw * 2, hh * 2, Math.min(hh, 7 * geo.scale));
      fx.fillStyle = heat > 0.05 ? `rgba(${MARKER_RGB}, ${0.1 + heat * 0.14})` : '#FFFFFF';
      fx.fill();
      fx.lineWidth = 1.5;
      fx.strokeStyle = heat > 0.5 ? MARKER : INK;
      fx.stroke();
      /* The spinous process, the bump you can feel down a back. */
      fx.beginPath();
      fx.arc(0, 0, 2.2 * geo.scale + 0.6, 0, Math.PI * 2);
      fx.fillStyle = heat > 0.5 ? MARKER : INK;
      fx.fill();
      fx.restore();
    }

    /* The bob, a diamond as in the wordmark. */
    fx.save();
    fx.translate(geo.cx, base + spacing * 2.5);
    fx.shadowColor = 'rgba(214, 64, 42, 0.35)';
    fx.shadowBlur = 14;
    fx.shadowOffsetY = 4;
    fx.beginPath();
    fx.moveTo(0, -2); fx.lineTo(10, 12); fx.lineTo(0, 26); fx.lineTo(-10, 12);
    fx.closePath();
    fx.fillStyle = MARKER;
    fx.fill();
    fx.restore();

    if (spine.readout) {
      spine.readout.textContent = `${angle.toFixed(1)}° curve`;
      spine.readout.toggleAttribute('data-off', angle >= SCOLIOSIS_DEG);
      /* The chip rides beside the apex of the upper curve, on the convex side,
         on a solid background so it reads over anything. */
      const t = 0.25;
      const right = spine.amp >= 0;
      const ax = spineX(geo, t) + (right ? 1 : -1) * (halfWidth(geo, t) + 18);
      const ay = geo.top + t * geo.length - 12;
      const chip = spine.readout.offsetWidth || 110;
      const left = (right ? ax : ax - chip) - geo.box.left;
      spine.readout.style.transform = `translate(${left.toFixed(1)}px, ${(ay - geo.box.top).toFixed(1)}px)`;
    }
  }

  /* --------------------------------------------------------------- draw --- */

  function draw(dt, now) {
    ctx.clearRect(0, 0, width, height);
    fx.clearRect(0, 0, width, height);
    const drift = reduced ? 0 : -((window.scrollY * PARALLAX) % GAP);
    const geo = spineGeometry();
    if (geo && !reduced) stepSpine(geo, dt, now);

    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      if (now - ripples[i].t > RIPPLE_LIFE) ripples.splice(i, 1);
    }

    const paths = Array.from({ length: SHADES }, () => new Path2D());
    const wakeX = Math.max(-WAKE_MAX, Math.min(WAKE_MAX, pointer.vx * WAKE));
    const wakeY = Math.max(-WAKE_MAX, Math.min(WAKE_MAX, pointer.vy * WAKE));
    const sway = Math.max(-SCROLL_WAVE_MAX, Math.min(SCROLL_WAVE_MAX, -scroll.v * SCROLL_WAVE));
    const liftEase = Math.min(1, dt * 10);
    const spacing = geo ? geo.length / (VERTEBRAE - 1) : 0;

    for (let r = 0; r < rows; r += 1) {
      const baseY = (r - 1) * GAP + drift + GAP / 2;
      for (let c = 0; c < cols; c += 1) {
        const k = (r * cols + c) * 5;
        const baseX = (c - 1) * GAP + GAP / 2;

        let tx = 0; let ty = 0; let lift = 0;

        if (!reduced) {
          if (pointer.inside) {
            const ddx = baseX - pointer.x; const ddy = baseY - pointer.y;
            const dist = Math.hypot(ddx, ddy);
            if (dist < LENS_RADIUS && dist > 0.01) {
              const f = (1 - dist / LENS_RADIUS) ** 2;
              tx += (ddx / dist) * f * LENS_PUSH + wakeX * f;
              ty += (ddy / dist) * f * LENS_PUSH + wakeY * f;
              lift = f;
            }
          }

          for (const ripple of ripples) {
            const age = now - ripple.t;
            const ddx = baseX - ripple.x; const ddy = baseY - ripple.y;
            const dist = Math.hypot(ddx, ddy);
            const band = 1 - Math.abs(dist - age * RIPPLE_SPEED) / RIPPLE_WIDTH;
            if (band > 0 && dist > 0.01) {
              const strength = band * (1 - age / RIPPLE_LIFE);
              tx += (ddx / dist) * strength * RIPPLE_PUSH;
              ty += (ddy / dist) * strength * RIPPLE_PUSH;
              lift = Math.max(lift, strength * 0.9);
            }
          }

          /* Scroll speed, as a wave across the columns rather than a slab. */
          if (sway) ty += sway * (0.55 + 0.45 * Math.sin(c * 0.38 + r * 0.11));
        }

        /* Dots part around the spine, as pins would around something laid on
           the board. */
        if (geo && baseY > geo.top - spacing && baseY < geo.top + geo.length + spacing * 2.6) {
          const t = Math.max(0, Math.min(1, (baseY - geo.top) / geo.length));
          const away = baseX - spineX(geo, t);
          const clear = halfWidth(geo, t) * 1.5 + 8;
          if (Math.abs(away) < clear + 26) {
            tx += Math.sign(away || 1) * Math.max(0, clear - Math.abs(away)) * 1.05;
            lift = Math.max(lift, 0.35 * (1 - Math.max(0, Math.abs(away) - clear) / 26));
          }
        }

        if (reduced) {
          dots[k] = tx; dots[k + 1] = ty; dots[k + 4] = lift;
        } else {
          dots[k + 2] += (SPRING * (tx - dots[k]) - DAMPING * dots[k + 2]) * dt;
          dots[k + 3] += (SPRING * (ty - dots[k + 1]) - DAMPING * dots[k + 3]) * dt;
          dots[k] += dots[k + 2] * dt;
          dots[k + 1] += dots[k + 3] * dt;
          dots[k + 4] += (lift - dots[k + 4]) * liftEase;
        }

        const l = dots[k + 4];
        /* The resting swell: a slow diagonal wave in dot size and shade. */
        const swell = reduced ? 0 : (0.5 + 0.5 * Math.sin(baseX * 0.011 + (baseY - drift) * 0.007 - now * 0.9)) ** 3;
        const radius = DOT * (0.85 + 0.55 * swell) + l * 3.3;
        const shade = Math.min(SHADES - 1, Math.floor((l * 0.9 + swell * 0.16) * SHADES));
        const x = baseX + dots[k];
        const y = baseY + dots[k + 1];
        paths[shade].moveTo(x + radius, y);
        paths[shade].arc(x, y, radius, 0, Math.PI * 2);
      }
    }

    for (let i = 0; i < SHADES; i += 1) {
      ctx.fillStyle = fills[i];
      ctx.fill(paths[i]);
    }

    if (geo) drawSpine(geo);
  }

  /* --------------------------------------------------------------- loop --- */

  function tick(nowMs) {
    requestAnimationFrame(tick);
    /* Half rate once the page has been left alone; the swell is slow enough
       that nobody sees the difference, and the battery does. */
    const idle = nowMs - lastInput > IDLE_AFTER && !ripples.length;
    skip = idle ? !skip : false;
    if (skip) return;

    const dt = Math.min(1 / 24, (nowMs - last) / 1000 || 1 / 60);
    last = nowMs;

    const y = window.scrollY;
    const v = (y - scroll.y) / dt;
    scroll.y = y;
    scroll.v += (v - scroll.v) * Math.min(1, dt * 8);
    pointer.vx *= Math.max(0, 1 - dt * 6);
    pointer.vy *= Math.max(0, 1 - dt * 6);

    draw(dt, nowMs / 1000);
  }

  /* ------------------------------------------------------------- inputs --- */

  window.addEventListener('resize', resize);

  /* Reduced motion: no loop, so the spine is redrawn where its box has
     scrolled to, one frame per scroll. */
  let pending = 0;
  if (reduced) {
    window.addEventListener('scroll', () => {
      if (!pending) pending = requestAnimationFrame(() => { pending = 0; draw(0, 0); });
    }, { passive: true });
  }

  if (!reduced) {
    window.addEventListener('scroll', () => { lastInput = performance.now(); }, { passive: true });
    window.addEventListener('pointermove', (event) => {
      const now = performance.now();
      const dt = Math.max(8, now - pointer.t) / 1000;
      if (pointer.inside) {
        /* Smoothed cursor velocity, for the wake. */
        pointer.vx += ((event.clientX - pointer.x) / dt - pointer.vx) * 0.35;
        pointer.vy += ((event.clientY - pointer.y) / dt - pointer.vy) * 0.35;
      }
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.t = now;
      pointer.inside = event.pointerType === 'mouse' || event.pointerType === 'pen' || event.buttons > 0;
      lastInput = now;
    }, { passive: true });
    const leave = () => { pointer.inside = false; pointer.vx = 0; pointer.vy = 0; };
    document.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    window.addEventListener('pointerup', (event) => { if (event.pointerType !== 'mouse') leave(); });
    window.addEventListener('pointercancel', leave);
    window.addEventListener('pointerdown', (event) => {
      ripples.push({ x: event.clientX, y: event.clientY, t: performance.now() / 1000 });
      if (ripples.length > 6) ripples.shift();
      lastInput = performance.now();
    }, { passive: true });
  }

  /* The spine exists only on the intro; re-find it when screens change. */
  const findSpine = () => {
    spine.zone = document.querySelector('[data-plumb-zone]');
    spine.readout = document.querySelector('[data-plumb-readout]');
    if (reduced) draw(0, 0);
  };
  document.addEventListener('screenchange', findSpine);
  findSpine();

  resize();
  if (!reduced) {
    lastInput = performance.now();
    requestAnimationFrame((now) => { last = now; tick(now); });
  }
}
