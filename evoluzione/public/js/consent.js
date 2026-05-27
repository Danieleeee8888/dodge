/**
 * Banner consenso cookie / archiviazione locale (solo tecnici, nessun ads).
 * Scelta salvata in localStorage; non riappare finché non si resetta.
 */
(function () {
  const STORAGE_KEY = 'dodge:cookieChoice';

  function getChoice() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function setChoice(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function hideBanner(banner) {
    banner.hidden = true;
    banner.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('cookie-banner-open');
  }

  function showBanner(banner) {
    banner.hidden = false;
    banner.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('cookie-banner-open');
    const primary = document.getElementById('cookieAcceptAll');
    if (primary) primary.focus();
  }

  function bind() {
    const banner = document.getElementById('cookieBanner');
    if (!banner) return;

    const accept = document.getElementById('cookieAcceptAll');
    const essential = document.getElementById('cookieEssentialOnly');

    if (accept) {
      accept.addEventListener('click', () => {
        setChoice('all');
        hideBanner(banner);
      });
    }
    if (essential) {
      essential.addEventListener('click', () => {
        setChoice('essential');
        hideBanner(banner);
      });
    }

    if (!getChoice()) showBanner(banner);
    else hideBanner(banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  /** Debug: resetCookieChoice() in console per rivedere il banner */
  window.resetCookieChoice = function resetCookieChoice() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const banner = document.getElementById('cookieBanner');
    if (banner) showBanner(banner);
  };
})();
