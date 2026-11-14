/* NEU+ hero: scroll-driven parallax.
   Sets --neu-hero-p (0 at the top of the page, 1 once the hero has scrolled out)
   on each .neu-hero; neu-hero.css turns that into movement per word and the bottle.
   Vessel scrolls inside .page-wrapper rather than the window, so the scroller is
   looked up per hero and scroll events are caught in the capture phase. */
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const heroes = new Set();
  let ticking = false;

  const scrollerOf = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
  };

  const update = () => {
    ticking = false;
    heroes.forEach((hero) => {
      if (!hero.isConnected) {
        heroes.delete(hero);
        return;
      }
      const scroller = scrollerOf(hero);
      const scrolled = scroller ? scroller.scrollTop : window.scrollY;
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const rect = hero.getBoundingClientRect();
      const end = rect.top - viewTop + scrolled + rect.height;
      if (end <= 0) return;
      const p = Math.min(Math.max(scrolled / end, 0), 1);
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

  document.addEventListener('scroll', request, { passive: true, capture: true });
  window.addEventListener('resize', request);
  document.addEventListener('shopify:section:load', (e) => init(e.target));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();
