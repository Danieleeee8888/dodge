import { applyGameViewportChromeVars } from './viewport-ui-scale.js';

function bindViewportUiSync() {
  const run = () => {
    applyGameViewportChromeVars();
  };
  run();
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', () => {
    setTimeout(run, 120);
  });
  window.addEventListener('pageshow', () => {
    requestAnimationFrame(run);
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 48);
    setTimeout(run, 160);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', run);
    window.visualViewport.addEventListener('scroll', run);
  }
}

bindViewportUiSync();

document.getElementById('btn-legal-back')?.addEventListener('click', () => {
  window.location.href = '/';
});
