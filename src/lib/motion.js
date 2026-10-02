/* Page motion: scroll reveal, a cursor spotlight on cards, buttons that lean
 * toward the cursor, and the masthead's scrolled state.
 *
 * Everything here is progressive. The hidden "before" state of a reveal only
 * applies under html.motion, which is set here, so content is never invisible
 * when this script fails to run. prefers-reduced-motion skips all of it except
 * the masthead border, which is not motion. The pointer effects only run on a
 * real hover-capable pointer, so a phone never pays for them. */

/* Things that arrive one by one as they scroll into view. Kept to card-level
   blocks: revealing a card and the paragraph inside it would double the motion. */
const REVEAL = [
  '.step-label', '.screen h1', '.screen > h2', '.intro__lede', '.board', '.claim-list li',
  '.capture__hint', '.capture__stage', '.capture__controls', '.capture__steps',
  '.adjust__stage', '.adjust__panel',
  '.analyze__frame', '.analyze__log li',
  '.verdict', '.redflag', '.plate', '.plate__key', '.readout', '.sway', '.notice', '.quality-note',
  '.result__details > .panel', '.next-steps li', '.intake-prompt', '.disclaimer',
  '.locbar', '.loc-hint', '.filters', '.care__mapcol', '.clinic', '.empty',
  '.trend', '.log-entry',
  '.intake__q', '.article > p', '.article > h2', '.figure-cobb', '.path-table', '.link-list li',
  '.report__section', '.report__head',
].join(',');

/* Cards that get the cursor spotlight. */
const SPOT = [
  '.claim-list li', '.verdict', '.readout', '.sway', '.clinic', '.log-entry', '.trend',
  '.panel', '.intake__q', '.intake-prompt', '.capture__steps', '.capture__controls',
  '.adjust__panel', '.link-list a', '.analyze__log li',
].join(',');

/* Controls that lean a few pixels toward the cursor. */
const MAGNET = '.btn:not(.btn--quiet), .shutter';

const STAGGER_MS = 70;
const MAX_STAGGER = 8;
const REVEAL_MS = 700;

export function initMotion() {
  initMasthead();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('motion');
  initReveal();

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    initPointerEffects();
  }
}

/* --------------------------------------------------------------- masthead --- */

function initMasthead() {
  const bar = document.querySelector('.masthead');
  if (!bar) return;
  const update = () => bar.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/* ----------------------------------------------------------------- reveal --- */

function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    /* Everything that enters in the same frame is one batch, staggered in
       reading order, so a freshly rendered list ripples in from the top. */
    const entering = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => (a.boundingClientRect.top - b.boundingClientRect.top)
        || (a.boundingClientRect.left - b.boundingClientRect.left));

    entering.forEach((entry, index) => reveal(entry.target, index));
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

  function reveal(node, index = 0) {
    if (!node.hasAttribute('data-reveal') || node.classList.contains('is-in')) return;
    const delay = Math.min(index, MAX_STAGGER) * STAGGER_MS;
    observer.unobserve(node);
    node.style.setProperty('--reveal-delay', `${delay}ms`);
    node.classList.add('is-in');

    /* Once it has arrived, hand the element back to its own styles, so hover
       transforms do not inherit the slow reveal transition. */
    setTimeout(() => {
      node.removeAttribute('data-reveal');
      node.classList.remove('is-in');
      node.style.removeProperty('--reveal-delay');
    }, REVEAL_MS + delay + 60);
  }

  /* Safety net. Observer callbacks ride on rendering, which a browser may pause
     (a background tab, a hidden embed). Anything still waiting after a moment
     that is actually on screen is shown regardless, so a paused observer can
     delay content but never hide it. */
  const sweep = () => {
    document.querySelectorAll('[data-reveal]:not(.is-in)').forEach((node) => {
      const box = node.getBoundingClientRect();
      if (box.width && box.bottom > 0 && box.top < window.innerHeight) reveal(node);
    });
  };

  const tag = (node) => {
    if (node.hasAttribute('data-revealed')) return;
    node.setAttribute('data-revealed', '');
    node.setAttribute('data-reveal', '');
    observer.observe(node);
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweep, 1200);
  };
  let sweepTimer = 0;
  window.addEventListener('scroll', () => { clearTimeout(sweepTimer); sweepTimer = setTimeout(sweep, 1200); }, { passive: true });

  const scan = (root) => {
    if (root.matches?.(REVEAL)) tag(root);
    root.querySelectorAll?.(REVEAL).forEach(tag);
  };

  const main = document.querySelector('main');
  if (!main) return;
  scan(main);

  /* Screens render their contents after load (results, clinic lists, the scan
     log), so new nodes are picked up as they are inserted. */
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      /* A screen being switched to is an attribute change, not new nodes, but
         its contents still need the safety net. */
      if (mutation.type === 'attributes') {
        clearTimeout(sweepTimer);
        sweepTimer = setTimeout(sweep, 1200);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      }
    }
  }).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active'] });
}

/* ---------------------------------------------------------------- pointer --- */

function initPointerEffects() {
  document.documentElement.classList.add('pointer-fine');
  let spot = null;
  let magnet = null;

  const clearSpot = () => {
    spot?.style.removeProperty('--mx');
    spot?.style.removeProperty('--my');
    spot = null;
  };
  const clearMagnet = () => {
    magnet?.style.removeProperty('--mag-x');
    magnet?.style.removeProperty('--mag-y');
    magnet = null;
  };

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const target = event.target instanceof Element ? event.target : null;

    const card = target?.closest(SPOT) || null;
    if (card !== spot) { clearSpot(); spot = card; card?.classList.add('spot'); }
    if (card) {
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${Math.round(event.clientX - box.left)}px`);
      card.style.setProperty('--my', `${Math.round(event.clientY - box.top)}px`);
    }

    const button = target?.closest(MAGNET) || null;
    if (button !== magnet) { clearMagnet(); magnet = button; }
    if (button && !button.disabled) {
      const box = button.getBoundingClientRect();
      /* Normalised to the button's own size, so a full-width button leans no
         further than a small one. */
      const dx = (event.clientX - (box.left + box.width / 2)) / box.width;
      const dy = (event.clientY - (box.top + box.height / 2)) / box.height;
      button.style.setProperty('--mag-x', `${(dx * 8).toFixed(1)}px`);
      button.style.setProperty('--mag-y', `${(dy * 6).toFixed(1)}px`);
    }
  }, { passive: true });

  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) { clearSpot(); clearMagnet(); }
  });
}
