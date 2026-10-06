/* Scroll-driven scenes, built with GSAP + ScrollTrigger (+ SplitText, Lenis).
 *
 * Where the big motion goes, and why there: the intro and the Learn article are
 * read once, top to bottom, so they get storytelling (a kinetic hero, a pinned
 * sequence that draws how a reading is made, a progress bar, diagrams that draw
 * as you reach them). The screens used again and again (capture, the clinic
 * list, the log) stay crisp, and get their motion from motion.js instead.
 *
 * Every scene is built per screen inside a gsap.context, and reverted when that
 * screen is left, so a hidden screen never keeps a pin or a trigger alive.
 *
 * All of it is optional. The markup is the finished state; with GSAP missing
 * (blocked CDN) or prefers-reduced-motion, nothing here runs and the page is
 * simply static and complete. */

const SCREENS = {
  intro: buildIntro,
  resources: buildLearn,
};

let lenis = null;
let current = null;   // { name, ctx }
/* Teardown for things a gsap.context cannot revert on its own (a WebGL
   canvas, async loads still in flight), run when the screen is left. */
let cleanups = [];
const onRevert = (fn) => cleanups.push(fn);

export function initScenes() {
  const { gsap, ScrollTrigger } = window;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!gsap || !ScrollTrigger || reduced) {
    document.documentElement.classList.remove('anim-pending');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(window.SplitText);
  document.documentElement.classList.add('gsap');

  initSmoothScroll(gsap, ScrollTrigger);

  document.addEventListener('screenchange', ({ detail }) => {
    if (current) { current.ctx.revert(); current = null; }
    cleanups.forEach((fn) => fn());
    cleanups = [];
    lenis?.scrollTo(0, { immediate: true });

    const build = SCREENS[detail.name];
    if (!build) {
      document.documentElement.classList.remove('anim-pending');
      return;
    }
    /* The screen has just become display:block; measure after it lays out.
       anim-pending comes off only once the starting states are applied, or
       the finished layout would flash for a frame first. */
    requestAnimationFrame(() => {
      const ctx = gsap.context(() => build(gsap, ScrollTrigger));
      current = { name: detail.name, ctx };
      ScrollTrigger.refresh();
      document.documentElement.classList.remove('anim-pending');
    });
  });

  /* Late layout shifts (web fonts, lazy screens rendering) move trigger points. */
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/* Lenis gives the wheel weight on a desktop pointer. Touch keeps native
   scrolling, which is already smooth and which people expect. Anything marked
   data-lenis-prevent (the map) keeps its own wheel behaviour. */
function initSmoothScroll(gsap, ScrollTrigger) {
  if (!window.Lenis || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  lenis = new window.Lenis({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ------------------------------------------------------------------ intro --- */

function buildIntro(gsap, ScrollTrigger) {
  const hero = document.querySelector('[data-gsap="hero"]');
  if (!hero) return;

  /* Entrance: the headline rises word by word out of its own lines, then the
     lede, the button and the cue follow. */
  const title = hero.querySelector('.hero__title');
  const entrance = gsap.timeline({ defaults: { ease: 'expo.out' } });

  if (window.SplitText && title) {
    const split = window.SplitText.create(title, { type: 'lines,words', mask: 'lines', linesClass: 'split-line' });
    entrance.from(split.words, { yPercent: 115, duration: 1.1, stagger: 0.06 }, 0.1);
  } else if (title) {
    entrance.from(title, { y: 30, autoAlpha: 0, duration: 1 }, 0.1);
  }

  entrance
    .from(hero.querySelector('.hero__lede'), { y: 22, autoAlpha: 0, duration: 1 }, 0.45)
    .from(hero.querySelector('.hero__cta'), { y: 22, autoAlpha: 0, duration: 1 }, 0.6)
    .from(hero.querySelector('.hero__cue'), { autoAlpha: 0, duration: 1 }, 1.1);

  /* Scrolling away, the copy drifts up and fades a little faster than the page. */
  gsap.to(hero.querySelector('.hero__copy'), {
    yPercent: -18,
    autoAlpha: 0.15,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });

  /* The spine sinks a little slower than the page as the hero leaves, for
     depth. The field draws it from this box, so the canvas follows. */
  gsap.to(hero.querySelector('.hero__plumb'), {
    yPercent: 16,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });

  /* Each line of the headline sits at its own depth. Scrolling away, the
     lines rise at different speeds and pull apart; the lede lags behind them.
     yPercent here, so the pointer below can use x and y on the same lines
     without the two fighting. */
  const lines = title ? [...title.querySelectorAll('.split-line-mask')] : [];
  lines.forEach((line, i) => {
    /* The top line rises fastest, so the gaps open as it goes rather than the
       lower lines riding up into the ones above. */
    gsap.to(line, {
      yPercent: -45 - (lines.length - 1 - i) * 70,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.4 },
    });
  });
  gsap.to(hero.querySelector('.hero__lede'), {
    y: 60, ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.4 },
  });

  /* The headline turns toward the pointer in perspective, and its lines slide
     with it by depth, the front line furthest, as if the type were standing
     off the page in layers. */
  if (title && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    gsap.set(title, { transformPerspective: 900, transformOrigin: '30% 50%' });
    const turnX = gsap.quickTo(title, 'rotationX', { duration: 0.8, ease: 'power3' });
    const turnY = gsap.quickTo(title, 'rotationY', { duration: 0.8, ease: 'power3' });
    const shifts = lines.map((line) => ({
      x: gsap.quickTo(line, 'x', { duration: 1, ease: 'power3' }),
      y: gsap.quickTo(line, 'y', { duration: 1, ease: 'power3' }),
    }));
    const onMove = (event) => {
      const nx = (event.clientX / window.innerWidth) - 0.5;
      const ny = (event.clientY / window.innerHeight) - 0.5;
      turnY(nx * 16);
      turnX(ny * -12);
      shifts.forEach((shift, i) => {
        const depth = 1 + i * 0.9;
        shift.x(nx * 22 * depth);
        shift.y(ny * 10 * depth);
      });
    };
    hero.addEventListener('pointermove', onMove);
    hero.addEventListener('pointerleave', () => {
      turnX(0); turnY(0);
      shifts.forEach((shift) => { shift.x(0); shift.y(0); });
    });
  }

  buildBand(gsap, ScrollTrigger);
  buildHow(gsap, ScrollTrigger);
  buildJourney(gsap, ScrollTrigger);
  buildStats(gsap);
  buildLimits(gsap);
  buildCloser(gsap, ScrollTrigger);
}

/* Two rows of type travelling in opposite directions with the scroll, leaning
   into it in proportion to how fast the page is moving. */
function buildBand(gsap, ScrollTrigger) {
  const band = document.querySelector('[data-gsap="band"]');
  if (!band) return;
  const rows = [...band.querySelectorAll('.band__row')];
  const scroll = { trigger: band, start: 'top bottom', end: 'bottom top', scrub: 0.4 };
  gsap.fromTo(rows[0], { xPercent: 0 }, { xPercent: -32, ease: 'none', scrollTrigger: scroll });
  if (rows[1]) gsap.fromTo(rows[1], { xPercent: -36 }, { xPercent: -4, ease: 'none', scrollTrigger: { ...scroll } });

  const lean = gsap.quickTo(rows, 'skewX', { duration: 0.5, ease: 'power3' });
  ScrollTrigger.create({
    trigger: band,
    start: 'top bottom',
    end: 'bottom top',
    onUpdate: (self) => lean(gsap.utils.clamp(-14, 14, self.getVelocity() / -260)),
    onLeave: () => lean(0),
    onLeaveBack: () => lean(0),
  });
}

/* The journey: pinned, its track of cards driven sideways by the vertical
   scroll. Each card turns on its vertical axis by how far it sits from the
   middle of the window, like a carousel seen from the front, and the one in
   the middle is marked so its illustration plays. */
function buildJourney(gsap, ScrollTrigger) {
  const section = document.querySelector('[data-gsap="journey"]');
  if (!section) return;
  const pin = section.querySelector('.journey__pin');
  const viewport = section.querySelector('.journey__viewport');
  const track = section.querySelector('.journey__track');
  const cards = [...track.children];
  const bar = section.querySelector('.journey__progress span');
  const index = section.querySelector('[data-journey-index]');
  /* Far enough that the last card ends centred. */
  const distance = () => {
    const last = cards[cards.length - 1];
    return Math.max(0, last.offsetLeft + last.offsetWidth / 2 - viewport.clientWidth / 2);
  };
  const setters = cards.map((card) => ({
    rotationY: gsap.quickSetter(card, 'rotationY', 'deg'),
    z: gsap.quickSetter(card, 'z', 'px'),
    opacity: gsap.quickSetter(card, 'opacity'),
  }));
  gsap.set(cards, { transformPerspective: 1400 });
  let active = -1;

  const turn = () => {
    const middle = window.innerWidth / 2;
    let nearest = 0;
    let nearestGap = Infinity;
    cards.forEach((card, i) => {
      const box = card.getBoundingClientRect();
      const offset = (box.left + box.width / 2 - middle) / window.innerWidth;
      const clamped = gsap.utils.clamp(-1, 1, offset * 1.6);
      setters[i].rotationY(clamped * -32);
      setters[i].z(Math.abs(clamped) * -180);
      setters[i].opacity(1 - Math.abs(clamped) * 0.35);
      if (Math.abs(offset) < nearestGap) { nearestGap = Math.abs(offset); nearest = i; }
    });
    if (nearest !== active) {
      cards[active]?.toggleAttribute('data-active', false);
      if (active >= 0) cards[active].setAttribute('data-played', '');
      active = nearest;
      cards[active].toggleAttribute('data-active', true);
      index.textContent = String(active + 1).padStart(2, '0');
    }
  };

  const sideways = gsap.to(track, {
    x: () => -distance(),
    ease: 'none',
    onUpdate: turn,
    scrollTrigger: {
      trigger: section,
      pin,
      anticipatePin: 1,
      start: 'top top',
      end: () => `+=${Math.round(distance() * 1.15)}`,
      scrub: 0.7,
      invalidateOnRefresh: true,
      onUpdate: (self) => gsap.set(bar, { scaleX: 0.2 + self.progress * 0.8 }),
      onRefresh: turn,
    },
  });
  turn();
  steerSideways(sideways.scrollTrigger, viewport, 1.15);

  /* The heading and counter rise in before the pin takes over. */
  gsap.fromTo(section.querySelectorAll('.journey__title, .journey__count'), { y: 50, autoAlpha: 0 }, {
    y: 0, autoAlpha: 1, duration: 1, ease: 'expo.out', stagger: 0.1,
    scrollTrigger: { trigger: section, start: 'top 75%' },
  });
}

/* Numbers that flip up out of the page in perspective and count as they come. */
function buildStats(gsap) {
  const section = document.querySelector('[data-gsap="stats"]');
  if (!section) return;
  const stats = [...section.querySelectorAll('.stat')];
  const tl = gsap.timeline({ scrollTrigger: { trigger: section, start: 'top 80%' } });
  tl.fromTo(stats, { rotationX: -75, y: 80, autoAlpha: 0, transformOrigin: '50% 100%' }, {
    rotationX: 0, y: 0, autoAlpha: 1,
    duration: 1.1, ease: 'expo.out', stagger: 0.1,
  });
  stats.forEach((stat, i) => {
    const number = stat.querySelector('[data-count]');
    if (!number) return;
    const to = Number(number.dataset.count);
    const counter = { value: Number(number.dataset.from ?? 0) };
    number.textContent = String(counter.value);
    tl.to(counter, {
      value: to, duration: 1.4, ease: 'power3.out',
      onUpdate: () => { number.textContent = String(Math.round(counter.value)); },
    }, 0.15 + i * 0.1);
  });
}

/* The closing card grows into place, then its sentence fills in word by word
   as it is scrolled through, like a line being read. It is the last thing on
   the page and never reaches the middle of the window, so everything here ends
   at the bottom of the page rather than at a point in the window. */
function buildCloser(gsap, ScrollTrigger) {
  const closer = document.querySelector('.closer');
  if (!closer) return;
  const pageEnd = () => ScrollTrigger.maxScroll(window);
  gsap.fromTo(closer, { scale: 0.9, y: 60, borderRadius: 64 }, {
    scale: 1, y: 0, borderRadius: 24, ease: 'none',
    scrollTrigger: { trigger: closer, start: 'top bottom', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true },
  });
  const line = closer.querySelector('.closer__line');
  if (window.SplitText && line) {
    const split = window.SplitText.create(line, { type: 'words' });
    gsap.fromTo(split.words, { opacity: 0.14 }, {
      opacity: 1, ease: 'none', stagger: 0.12,
      scrollTrigger: { trigger: closer, start: 'top 95%', end: () => pageEnd() - 40, scrub: true, invalidateOnRefresh: true },
    });
  }
  gsap.fromTo(closer.querySelector('.btn'), { y: 24, autoAlpha: 0 }, {
    y: 0, autoAlpha: 1, duration: 0.9, ease: 'expo.out',
    scrollTrigger: { trigger: closer, start: 'top 85%' },
  });
}

/* Prepare an SVG stroke to be drawn on: dash it to its own length, offset fully. */
function strokeLength(node) {
  const length = typeof node.getTotalLength === 'function' ? node.getTotalLength() : 0;
  node.style.strokeDasharray = `${length}`;
  return length;
}

/* The carousel moves with the page's vertical scroll, but a sideways gesture
   over it should move it too: a trackpad swipe (or shift + wheel) on a
   desktop, a horizontal swipe on a phone. Both are turned into vertical
   scroll inside the pin's range, so the page, the pin and the cards stay one
   state. At either end of the range the gesture is left to the browser.
   `ratio` is page scroll per pixel of track travel. */
function steerSideways(trigger, surface, ratio) {
  const inRange = (y) => y >= trigger.start - 1 && y <= trigger.end + 1;
  const clampY = (y) => Math.max(trigger.start, Math.min(trigger.end, y));
  /* Lenis, when it runs, owns the scroll position and undoes a direct
     window.scrollTo, so every move goes through it. */
  const scrollY = () => (lenis ? lenis.scroll : window.scrollY);
  const scrollToY = (y, immediate) => {
    if (lenis) lenis.scrollTo(y, { immediate });
    else window.scrollTo(0, y);
  };

  /* Wheel and trackpad. A trackpad sends a stream of small deltas; they add
     up on a target of our own, since Lenis is still gliding toward the last
     one when the next arrives. */
  let wheelTarget = 0;
  let wheelAt = 0;
  const onWheel = (event) => {
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const dx = (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * scale;
    const dy = event.shiftKey ? 0 : event.deltaY * scale;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    const from = event.timeStamp - wheelAt < 250 ? wheelTarget : scrollY();
    if (!inRange(from)) return;
    const to = clampY(from + dx * ratio);
    if (to === from) return;
    event.preventDefault();
    event.stopPropagation();   // keep Lenis from also reading it
    wheelTarget = to;
    wheelAt = event.timeStamp;
    scrollToY(to, false);
  };
  surface.addEventListener('wheel', onWheel, { passive: false });

  /* Touch. The surface takes horizontal pans (touch-action: pan-y in CSS
     leaves vertical ones to the browser); a swipe follows the finger, and a
     flick carries on and slows, as a native scroller would. */
  let drag = null;
  let glide = 0;
  const stopGlide = () => { cancelAnimationFrame(glide); glide = 0; };
  const onDown = (event) => {
    if (event.pointerType !== 'touch') return;
    stopGlide();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, scroll: scrollY(), axis: null, lastX: event.clientX, lastT: event.timeStamp, v: 0 };
  };
  const onMove = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.axis && Math.hypot(dx, dy) > 8) {
      drag.axis = Math.abs(dx) > Math.abs(dy) && inRange(drag.scroll) ? 'x' : 'y';
    }
    if (drag.axis !== 'x') return;
    const dt = Math.max(1, event.timeStamp - drag.lastT);
    drag.v = drag.v * 0.6 + ((event.clientX - drag.lastX) / dt) * 0.4;   // px per ms
    drag.lastX = event.clientX;
    drag.lastT = event.timeStamp;
    scrollToY(clampY(drag.scroll - dx * ratio), true);
  };
  const onUp = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const flick = drag.axis === 'x' ? drag.v : 0;
    drag = null;
    if (Math.abs(flick) < 0.05) return;
    let v = -flick * ratio * 16;   // px per frame
    const step = () => {
      v *= 0.94;
      const y = clampY(scrollY() + v);
      scrollToY(y, true);
      glide = Math.abs(v) > 0.4 && y !== trigger.start && y !== trigger.end ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  };
  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onUp);

  onRevert(() => {
    stopGlide();
    surface.removeEventListener('wheel', onWheel);
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onUp);
    surface.removeEventListener('pointercancel', onUp);
  });
}

/* "How a reading is made": pinned while scrolling scrubs through four stages,
   each of which lights its step in the text. */
function buildHow(gsap, ScrollTrigger) {
  const section = document.querySelector('[data-gsap="how"]');
  if (!section) return;
  const pin = section.querySelector('.how__pin');
  const steps = [...section.querySelectorAll('[data-how-step]')];
  const angle = section.querySelector('[data-how-angle]');
  const pm = section.querySelector('[data-how-pm]');

  const reveal = section.querySelector('.how__reveal');
  const measures = [...section.querySelectorAll('.how__measure')];
  const level = section.querySelector('.how__level');
  const arc = section.querySelector('.how__arc');
  const plumbLine = section.querySelector('.how__plumb');
  const points = [...section.querySelectorAll('.how__points circle')];
  const fan = [...section.querySelectorAll('.how__fan line')];

  [...measures, level, arc, plumbLine].forEach((node) => {
    gsap.set(node, { strokeDashoffset: strokeLength(node) });
  });

  /* Before it pins, the drawing board rises into place. */
  gsap.fromTo(section.querySelector('.how__stage'), { y: 120, scale: 0.9, rotate: -2 }, {
    y: 0, scale: 1, rotate: 0, ease: 'none',
    scrollTrigger: { trigger: section, start: 'top bottom', end: 'top top', scrub: 0.6 },
  });

  const counter = { angle: 0, pm: 0 };

  /* Each step arrives with some weight: it swings in from behind the page,
     out of focus, and lands. Going back up, it comes in from the other side.
     On a phone only the current step shows, so the old one also leaves; on a
     desktop the list stays, and CSS dims the old one. */
  const single = window.matchMedia('(max-width: 959px)').matches;
  let current = -1;
  if (single) gsap.set(steps, { autoAlpha: 0 });
  const setStep = (index) => {
    if (index === current) return;
    const forward = index > current;
    const leaving = steps[current];
    current = index;
    steps.forEach((step, i) => step.toggleAttribute('data-active', i === index));
    const arriving = steps[index];
    gsap.killTweensOf([arriving, leaving].filter(Boolean));
    gsap.fromTo(arriving, {
      x: single ? 0 : -42,
      y: single ? (forward ? 46 : -46) : 0,
      rotationX: single ? (forward ? -55 : 55) : 0,
      rotationY: single ? 0 : 18,
      scale: 0.92,
      filter: 'blur(8px)',
      transformPerspective: 700,
      transformOrigin: single ? '50% 50%' : '0% 50%',
      ...(single ? { autoAlpha: 0 } : {}),
    }, {
      x: 0, y: 0, rotationX: 0, rotationY: 0, scale: 1, filter: 'blur(0px)',
      ...(single ? { autoAlpha: 1 } : {}),
      duration: 0.85, ease: 'expo.out', delay: single && leaving ? 0.12 : 0,
      clearProps: 'filter',
    });
    if (leaving && single) {
      gsap.to(leaving, {
        y: forward ? -40 : 40, rotationX: forward ? 50 : -50, scale: 0.94,
        filter: 'blur(6px)', autoAlpha: 0, duration: 0.45, ease: 'power2.in',
      });
    } else if (leaving) {
      /* Settle it fully, even if its own entrance was cut short by a fast
         scroll, or it would stay half blurred in the list. */
      gsap.to(leaving, {
        x: 0, y: 0, rotationX: 0, rotationY: 0, scale: 1, filter: 'blur(0px)',
        duration: 0.5, ease: 'power3.out', clearProps: 'filter',
      });
    }
  };
  setStep(0);

  /* Every stretch of the pin draws something: an earlier version paused
     between stages, and scrolling through a pause that moved nothing felt
     like the page had stuck. The extra time comes from drawing more slowly
     instead, SCROLL_PER_UNIT screens of scroll per unit of the timeline.
     STAGES are when each step's drawing starts. */
  const STAGES = [0, 1.15, 2.0, 3.05];
  const SCROLL_PER_UNIT = 0.88;

  let figure3d = null;
  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    onUpdate: () => {
      const t = tl.time();
      figure3d?.setProgress(tl.progress());
      /* A step lights when its drawing starts, so each hold keeps the stage
         just finished, with its own text, on screen. */
      let step = 0;
      STAGES.forEach((at, i) => { if (t > at + 0.001) step = i; });
      setStep(step);
    },
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * tl.duration() * SCROLL_PER_UNIT)}`,
      pin,
      anticipatePin: 1,
      scrub: 0.8,
      invalidateOnRefresh: true,
    },
  });

  /* 1. The plumb line drops, then the figure is revealed down its length. */
  tl.to(plumbLine, { strokeDashoffset: 0, duration: 0.6 }, 0)
    .fromTo(reveal, { attr: { height: 0 } }, { attr: { height: 400 }, duration: 1, ease: 'power2.out' }, 0.1)
  /* 2. The four points land. */
    .from(points, { scale: 0.4, autoAlpha: 0, transformOrigin: '50% 50%', duration: 0.35, stagger: 0.12, ease: 'back.out(2.4)' }, 1.15)
  /* 3. Horizontal reference, the measured lines, the angle, and the number. */
    .to(level, { strokeDashoffset: 0, duration: 0.5 }, 2.0)
    .to(measures, { strokeDashoffset: 0, duration: 0.6, stagger: 0.15 }, 2.2)
    .to(arc, { strokeDashoffset: 0, duration: 0.35 }, 2.6)
    .to(counter, {
      angle: 4.2, duration: 0.6, ease: 'power1.out',
      onUpdate: () => { angle.textContent = counter.angle.toFixed(1); },
    }, 2.3)
  /* 4. Four more measurements fan out around it, and their spread becomes the ±. */
    .from(fan, { autoAlpha: 0, duration: 0.3, stagger: 0.14, ease: 'power3.out' }, 3.05)
    .to(counter, {
      pm: 0.8, duration: 0.6, ease: 'power1.out',
      onUpdate: () => { pm.textContent = counter.pm.toFixed(1); },
    }, 3.1)
    .to({}, { duration: 0.3 });   // a beat at the end before the pin releases

  angle.textContent = '0.0';
  pm.textContent = '0.0';

  /* The 3D figure, fetched once the page has settled so it never competes
     with the hero's entrance. It takes its progress from this timeline. */
  let alive = true;
  const art = section.querySelector('.how__art');
  const load = () => import('./figure3d.js')
    .then((module) => module.mountFigure(art, tl.duration()))
    .then((mounted) => {
      if (!mounted) return;
      if (!alive) { mounted.destroy(); return; }
      figure3d = mounted;
      figure3d.setProgress(tl.progress());
      bindPoses();
    })
    .catch(() => { /* the SVG drawing stays */ });
  /* Standing / Forward bend. Standing is where every visit starts. The thumb
     is measured onto the chosen button, so it fits either label. */
  const poses = section.querySelector('.how__poses');
  const thumb = poses?.querySelector('.how__poses-thumb');
  const placeThumb = () => {
    const on = poses?.querySelector('[aria-pressed="true"]');
    if (!on || !thumb) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  const choosePose = (event) => {
    const button = event.target.closest('[data-pose]');
    if (!button) return;
    poses.querySelectorAll('[data-pose]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    placeThumb();
    figure3d?.setPose(button.dataset.pose);
  };
  const bindPoses = () => {
    if (!poses) return;
    poses.querySelectorAll('[data-pose]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pose === 'stand')));
    poses.addEventListener('click', choosePose);
    window.addEventListener('resize', placeThumb);
    requestAnimationFrame(placeThumb);
  };
  onRevert(() => {
    poses?.removeEventListener('click', choosePose);
    window.removeEventListener('resize', placeThumb);
  });

  const timer = setTimeout(() => (window.requestIdleCallback || setTimeout)(load), 900);
  onRevert(() => { alive = false; clearTimeout(timer); figure3d?.destroy(); figure3d = null; });
}

/* The limits: the heading rises out of its lines and holds while the list
   scrolls; each row slides in, and its DOES or NO key lands after it. */
function buildLimits(gsap) {
  const title = document.querySelector('.limits__title');
  if (window.SplitText && title) {
    const split = window.SplitText.create(title, { type: 'lines', mask: 'lines', linesClass: 'split-line' });
    gsap.from(split.lines, {
      yPercent: 110, duration: 1, ease: 'expo.out', stagger: 0.1,
      scrollTrigger: { trigger: title, start: 'top 85%' },
    });
  }
  gsap.fromTo('.limits__lede', { y: 20, autoAlpha: 0 }, {
    y: 0, autoAlpha: 1, duration: 0.9, ease: 'expo.out', delay: 0.2,
    scrollTrigger: { trigger: '.limits__lede', start: 'top 88%' },
  });

  gsap.utils.toArray('.limits__list > li').forEach((row) => {
    gsap.timeline({ scrollTrigger: { trigger: row, start: 'top 86%' } })
      .fromTo(row, { x: 60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.9, ease: 'expo.out' })
      .fromTo(row.querySelector('.claim-list__key'), { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(3)' }, 0.25);
  });
}

/* ------------------------------------------------------------------ learn --- */

function buildLearn(gsap, ScrollTrigger) {
  const article = document.querySelector('#screen-resources');
  if (!article) return;

  /* Reading progress, as a scrub-blue rule under the masthead. */
  const bar = document.querySelector('.read-progress');
  if (bar) {
    gsap.fromTo(bar, { scaleX: 0 }, {
      scaleX: 1, ease: 'none',
      scrollTrigger: { trigger: article, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
    });
    gsap.set(bar, { autoAlpha: 1 });
  }

  /* The Cobb diagram draws itself as it scrolls into view: spine, vertebrae,
     then the two lines and the angle between them. */
  const cobb = article.querySelector('.figure-cobb svg');
  if (cobb) {
    const parts = [...cobb.querySelectorAll('.fig-plumb, .fig-spine, .fig-vert rect, .fig-angle')];
    parts.forEach((node) => gsap.set(node, { strokeDashoffset: strokeLength(node) }));
    gsap.to(parts, {
      strokeDashoffset: 0, ease: 'power2.inOut', stagger: 0.08,
      scrollTrigger: { trigger: cobb, start: 'top 80%', end: 'center 45%', scrub: 0.6 },
    });
  }

  /* Section headings rise out of a mask as they arrive. */
  if (window.SplitText) {
    article.querySelectorAll('h2').forEach((heading) => {
      const split = window.SplitText.create(heading, { type: 'lines', mask: 'lines', linesClass: 'split-line' });
      gsap.from(split.lines, {
        yPercent: 110, duration: 0.9, ease: 'expo.out', stagger: 0.08,
        scrollTrigger: { trigger: heading, start: 'top 88%' },
      });
    });
  }
}
