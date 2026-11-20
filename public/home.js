const demo = document.querySelector('.demo-toggle');
const image = document.querySelector('#product-demo');
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
if (image && image.dataset.animation && !reducedMotion) {
  image.src = image.dataset.animation;
  demo?.remove();
} else if (demo && image) {
  demo.hidden = false;
  demo.addEventListener('click', () => {
    const playing = demo.getAttribute('aria-pressed') !== 'true';
    image.src = playing ? demo.dataset.animation : demo.dataset.poster;
    demo.setAttribute('aria-pressed', String(playing));
    demo.querySelector('[data-demo-label]').textContent = playing ? demo.dataset.pause : demo.dataset.play;
    demo.querySelector('.play-symbol').textContent = playing ? 'Ⅱ' : '▷';
  });
}
const copyGlyph = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
for (const button of document.querySelectorAll('[data-copy]')) {
  button.hidden = false;
  const label = button.getAttribute('aria-label');
  let reset;
  button.addEventListener('click', async () => {
    clearTimeout(reset);
    const value = document.getElementById(button.dataset.copy).textContent;
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(value);
      button.dataset.state = 'success';
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      button.setAttribute('aria-label', button.dataset.done);
      button.title = button.dataset.done;
      status.textContent = button.dataset.done;
    } catch {
      button.dataset.state = 'error';
      button.setAttribute('aria-label', button.dataset.error);
      button.title = button.dataset.error;
      status.textContent = button.dataset.error;
    }
    reset = setTimeout(() => {
      delete button.dataset.state;
      button.innerHTML = copyGlyph;
      button.setAttribute('aria-label', label);
      button.title = label;
      status.textContent = '';
    }, 2200);
  });
}
