/* NEU+ hero: scroll-driven parallax.
   Sets --neu-hero-p (0 at the top of the page, 1 once the hero has scrolled out)
   on each .neu-hero; neu-hero.css turns that into movement per word and the bottle. */
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const heroes = new Set();
  let ticking = false;

  const update = () => {
    ticking = false;
    const y = window.scrollY;
    heroes.forEach((hero) => {
      const rect = hero.getBoundingClientRect();
      const end = rect.top + y + rect.height;
      if (end <= 0) return;
      const p = Math.min(Math.max(y / end, 0), 1);
      hero.style.setProperty('--neu-hero-p', p.toFixed(4));
    });
  };

  const request = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  const init = (root = document) => {
    root.querySelectorAll('.neu-hero[data-neu-parallax]').forEach((hero) => {
      heroes.add(hero);
      hero.classList.add('neu-hero--parallax');
    });
    request();
  };

  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  document.addEventListener('shopify:section:load', (e) => init(e.target));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();
