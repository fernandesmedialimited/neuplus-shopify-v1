/* NEU+ nutrition & ingredients drawer (sections/neu-ingredients-drawer.liquid) */

const VARIANT_EVENT = 'neu:variant-change';
const OPEN_SELECTOR = 'a[href="#neu-ingredients"], [data-neu-ingredients-open]';
const MOBILE_QUERY = window.matchMedia('(max-width: 749px)');
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

class NeuIngredientsDrawer extends HTMLElement {
  connectedCallback() {
    if (this.ready) return;

    // Escape any stacking context so the drawer sits above everything (headers, chat widgets, popups).
    if (!this.hasAttribute('data-design-mode') && this.parentElement !== document.body) {
      document.body.appendChild(this);
      return;
    }
    this.ready = true;

    this.panel = this.querySelector('.neu-drawer__panel');
    this.onDocumentClick = this.onDocumentClick.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
    this.onVariant = (event) => this.showFlavour(event.detail?.variant?.options || []);

    document.addEventListener('click', this.onDocumentClick);
    document.addEventListener(VARIANT_EVENT, this.onVariant);
    this.querySelectorAll('[data-neu-drawer-close]').forEach((el) =>
      el.addEventListener('click', () => this.close())
    );
    this.setUpSwipe();

    if (this.hasAttribute('data-design-mode')) {
      document.addEventListener('shopify:section:select', (e) => this.contains(e.target) && this.open());
      document.addEventListener('shopify:block:select', (e) => this.contains(e.target) && this.open());
      document.addEventListener('shopify:section:deselect', (e) => this.contains(e.target) && this.close());
    }

    if (window.location.hash === '#neu-ingredients') this.open();
  }

  onDocumentClick(event) {
    const trigger = event.target.closest?.(OPEN_SELECTOR);
    if (!trigger || this.contains(trigger)) return;
    event.preventDefault();
    this.open(trigger);
  }

  /** Shows the ingredient list for the flavour in the given variant options. */
  showFlavour(options) {
    const values = options.map((value) => String(value).trim().toLowerCase());
    const lists = [...this.querySelectorAll('.neu-drawer__list')];
    const match = lists.find((list) => list.dataset.flavour && values.includes(list.dataset.flavour));
    if (!match) return;
    lists.forEach((list) => (list.hidden = list !== match));
  }

  open(trigger) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.trigger = trigger || document.activeElement;
    this.hidden = false;
    this.panel.style.transform = '';
    document.documentElement.classList.add('neu-drawer-locked');
    document.addEventListener('keydown', this.onKeydown);
    this.querySelector('.neu-drawer__body').scrollTop = 0;
    // Force a reflow so the slide-in transition runs from the hidden state.
    void this.offsetWidth;
    this.classList.add('is-open');
    this.panel.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.classList.remove('is-open', 'is-dragging');
    this.panel.style.transform = '';
    this.style.removeProperty('--neu-drag-progress');
    this.querySelector('.neu-drawer__overlay').style.opacity = '';
    document.removeEventListener('keydown', this.onKeydown);

    const finish = () => {
      if (this.isOpen) return;
      this.hidden = true;
      document.documentElement.classList.remove('neu-drawer-locked');
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) finish();
    else {
      this.panel.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 500);
    }

    if (this.trigger?.focus) this.trigger.focus({ preventScroll: true });
  }

  onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...this.panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Mobile bottom sheet: drag the top of the sheet down to close it. */
  setUpSwipe() {
    const overlay = this.querySelector('.neu-drawer__overlay');
    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let dragging = false;
    let pointerId = null;

    const onDown = (event) => {
      if (!MOBILE_QUERY.matches || !this.isOpen) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('button, a')) return;
      dragging = true;
      pointerId = event.pointerId;
      startY = lastY = event.clientY;
      lastTime = performance.now();
      velocity = 0;
      this.classList.add('is-dragging');
      event.currentTarget.setPointerCapture?.(pointerId);
    };

    const onMove = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const now = performance.now();
      const dy = Math.max(0, event.clientY - startY);
      velocity = (event.clientY - lastY) / Math.max(1, now - lastTime);
      lastY = event.clientY;
      lastTime = now;
      this.panel.style.transform = `translateY(${dy}px)`;
      overlay.style.opacity = String(Math.max(0, 1 - dy / this.panel.offsetHeight));
    };

    const onUp = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      dragging = false;
      this.classList.remove('is-dragging');
      const dy = Math.max(0, event.clientY - startY);
      const shouldClose = dy > Math.min(140, this.panel.offsetHeight * 0.3) || (velocity > 0.5 && dy > 20);
      if (shouldClose) {
        this.close();
      } else {
        this.panel.style.transform = '';
        overlay.style.opacity = '';
      }
    };

    this.querySelectorAll('[data-neu-drawer-handle]').forEach((handle) => {
      handle.addEventListener('pointerdown', onDown);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }
}

if (!customElements.get('neu-ingredients-drawer')) {
  customElements.define('neu-ingredients-drawer', NeuIngredientsDrawer);
}
