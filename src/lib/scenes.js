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
  entrance.from(hero.querySelector('.hero__eyebrow'), { y: 16, autoAlpha: 0, duration: 0.8 });

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

  buildHow(gsap, ScrollTrigger);
  buildLimits(gsap);

  gsap.from('.closer > *', {
    y: 30, autoAlpha: 0, duration: 1, stagger: 0.12, ease: 'expo.out',
    scrollTrigger: { trigger: '.closer', start: 'top 80%' },
  });
}

/* Prepare an SVG stroke to be drawn on: dash it to its own length, offset fully. */
function strokeLength(node) {
  const length = typeof node.getTotalLength === 'function' ? node.getTotalLength() : 0;
  node.style.strokeDasharray = `${length}`;
  return length;
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

  const figure = [...section.querySelectorAll('.how__figure > *')];
  const measures = [...section.querySelectorAll('.how__measure')];
  const level = section.querySelector('.how__level');
  const arc = section.querySelector('.how__arc');
  const plumbLine = section.querySelector('.how__plumb');
  const points = [...section.querySelectorAll('.how__points circle')];
  const frames = [...section.querySelectorAll('.how__frames rect')];

  [...figure, ...measures, level, arc, plumbLine].forEach((node) => {
    gsap.set(node, { strokeDashoffset: strokeLength(node) });
  });

  const counter = { angle: 0, pm: 0 };
  const setStep = (index) => steps.forEach((step, i) => step.toggleAttribute('data-active', i === index));
  setStep(0);

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * 2.6)}`,
      pin,
      scrub: 0.8,
      invalidateOnRefresh: true,
      onUpdate: (self) => setStep(Math.min(steps.length - 1, Math.floor(self.progress * steps.length * 0.999))),
    },
  });

  /* 1. The figure draws itself, plumb line first. */
  tl.to(plumbLine, { strokeDashoffset: 0, duration: 0.6 }, 0)
    .to(figure, { strokeDashoffset: 0, duration: 1, stagger: 0.06 }, 0.1)
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
  /* 4. Five framings jitter in around it, and their spread becomes the ±. */
    .from(frames, { autoAlpha: 0, scale: 1.06, transformOrigin: '50% 50%', duration: 0.3, stagger: 0.14, ease: 'power3.out' }, 3.05)
    .to(counter, {
      pm: 0.8, duration: 0.6, ease: 'power1.out',
      onUpdate: () => { pm.textContent = counter.pm.toFixed(1); },
    }, 3.1)
    .to({}, { duration: 0.3 });   // a beat at the end before the pin releases

  angle.textContent = '0.0';
  pm.textContent = '0.0';
}

/* The limits: the heading holds while the list scrolls; each row slides in. */
function buildLimits(gsap) {
  const rows = gsap.utils.toArray('.limits__list > li');
  rows.forEach((row) => {
    gsap.from(row, {
      x: 40, autoAlpha: 0, duration: 0.9, ease: 'expo.out',
      scrollTrigger: { trigger: row, start: 'top 85%' },
    });
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
