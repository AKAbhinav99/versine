/* The Standing / Forward bend switch (.pose-switch in base.css), shared by the
 * intro's 3D figure and the camera's framing guide.
 *
 * Standing is where every visit starts. The sliding thumb is measured onto
 * the chosen button, so it fits either label; a ResizeObserver re-measures it
 * whenever the switch gets a size, which is also how it catches the moment a
 * hidden screen (display: none, every size zero) is first shown. */

/**
 * @param {HTMLElement} root the .pose-switch element
 * @param {(pose: 'stand'|'bend') => void} onChange
 * @returns {{destroy(): void}}
 */
export function bindPoseSwitch(root, onChange) {
  const thumb = root.querySelector('.pose-switch__thumb');
  const buttons = [...root.querySelectorAll('[data-pose]')];

  const place = () => {
    const on = buttons.find((button) => button.getAttribute('aria-pressed') === 'true');
    if (!on || !thumb || !on.offsetWidth) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  const select = (pose) => {
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pose === pose)));
    place();
  };
  const onClick = (event) => {
    const button = event.target.closest('[data-pose]');
    if (!button || button.getAttribute('aria-pressed') === 'true') return;
    select(button.dataset.pose);
    onChange(button.dataset.pose);
  };

  select('stand');
  root.addEventListener('click', onClick);
  const observer = window.ResizeObserver ? new ResizeObserver(place) : null;
  observer?.observe(root);
  window.addEventListener('resize', place);

  return {
    destroy() {
      root.removeEventListener('click', onClick);
      observer?.disconnect();
      window.removeEventListener('resize', place);
    },
  };
}
