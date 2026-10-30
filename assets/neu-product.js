import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

const VARIANT_EVENT = 'neu:variant-change';
const STATE_EVENT = 'neu:buy-state';

/**
 * Formats cents with the shop's money format.
 * @param {number} cents
 * @param {string} format
 */
function formatMoney(cents, format) {
  const value = Number(cents) / 100;
  const withDelimiters = (amount, decimals, thousands = ',', decimal = '.') => {
    const [whole, fraction] = amount.toFixed(decimals).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return fraction ? `${grouped}${decimal}${fraction}` : grouped;
  };

  return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, placeholder) => {
    switch (placeholder) {
      case 'amount_no_decimals':
        return withDelimiters(value, 0);
      case 'amount_with_comma_separator':
        return withDelimiters(value, 2, '.', ',');
      case 'amount_no_decimals_with_comma_separator':
        return withDelimiters(value, 0, '.', ',');
      case 'amount_with_apostrophe_separator':
        return withDelimiters(value, 2, "'", '.');
      default:
        return withDelimiters(value, 2);
    }
  });
}

class NeuGallery extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-track]');
    this.slides = [...this.querySelectorAll('.neu-gallery__slide')];
    this.thumbs = [...this.querySelectorAll('.neu-gallery__thumb')];
    if (!this.track || this.slides.length === 0) return;

    this.querySelector('[data-prev]')?.addEventListener('click', () => this.go(this.index - 1));
    this.querySelector('[data-next]')?.addEventListener('click', () => this.go(this.index + 1));
    this.thumbs.forEach((thumb) => thumb.addEventListener('click', () => this.go(Number(thumb.dataset.index))));

    this.track.addEventListener('scroll', () => {
      window.cancelAnimationFrame(this.frame);
      this.frame = window.requestAnimationFrame(() => this.syncFromScroll());
    });

    this.onVariant = (event) => {
      const mediaId = event.detail?.variant?.media;
      if (!mediaId) return;
      const index = this.slides.findIndex((slide) => slide.dataset.mediaId === String(mediaId));
      if (index >= 0) this.go(index);
    };
    document.addEventListener(VARIANT_EVENT, this.onVariant);

    const current = this.thumbs.findIndex((thumb) => thumb.getAttribute('aria-current') === 'true');
    this.index = Math.max(current, 0);
    if (this.index > 0) this.go(this.index, 'instant');
  }

  disconnectedCallback() {
    document.removeEventListener(VARIANT_EVENT, this.onVariant);
  }

  go(index, behavior = 'smooth') {
    const count = this.slides.length;
    this.index = (index + count) % count;
    this.track.scrollTo({ left: this.slides[this.index].offsetLeft - this.track.offsetLeft, behavior });
    this.markThumb();
  }

  syncFromScroll() {
    const index = Math.round(this.track.scrollLeft / this.track.clientWidth);
    if (index !== this.index) {
      this.index = index;
      this.markThumb();
    }
  }

  markThumb() {
    this.thumbs.forEach((thumb, i) => thumb.setAttribute('aria-current', String(i === this.index)));
  }
}

class NeuTabs extends HTMLElement {
  connectedCallback() {
    this.tabs = [...this.querySelectorAll('[role="tab"]')];
    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.select(i));
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const next = (i + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length;
        this.select(next);
        this.tabs[next].focus();
      });
    });
  }

  select(index) {
    this.tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
      if (panel) panel.hidden = !selected;
    });
  }
}

class NeuBuyBox extends HTMLElement {
  connectedCallback() {
    const json = this.querySelector('[data-product-json]');
    if (!json) return;
    this.data = JSON.parse(json.textContent || '{}');
    this.form = this.querySelector('form');
    this.variantInput = this.querySelector('[data-variant-input]');
    this.planInput = this.querySelector('[data-plan-input]');
    this.qtyInput = this.querySelector('[data-qty]');
    this.addButton = this.querySelector('[data-add-button]');
    this.addLabel = this.querySelector('[data-add-label]');
    this.error = this.querySelector('[data-error]');
    this.plans = [...this.querySelectorAll('[data-plan]')];

    this.variant =
      this.data.variants.find((variant) => String(variant.id) === this.variantInput.value) || this.data.variants[0];

    this.querySelectorAll('[data-option-index]').forEach((input) =>
      input.addEventListener('change', () => this.onOptionChange())
    );
    this.plans.forEach((plan) => {
      plan.querySelector('.neu-plan__radio')?.addEventListener('change', () => this.update());
      plan.querySelectorAll('[data-purchase]').forEach((input) =>
        input.addEventListener('change', () => this.selectPlan(plan))
      );
      // The card is a div (it holds its own Subscribe / Buy once radios), so a click anywhere selects it
      plan.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('a, button')) return;
        this.selectPlan(plan);
      });
    });
    this.shownVariantId = '';
    this.querySelector('[data-qty-minus]')?.addEventListener('click', () => this.stepQuantity(-1));
    this.querySelector('[data-qty-plus]')?.addEventListener('click', () => this.stepQuantity(1));
    this.qtyInput?.addEventListener('change', () => this.update());
    this.form.addEventListener('submit', (event) => this.onSubmit(event));

    if (this.plans.length && !this.plans.some((plan) => plan.querySelector('.neu-plan__radio')?.checked)) {
      const first = this.plans[0].querySelector('.neu-plan__radio');
      if (first) first.checked = true;
    }

    this.update();
  }

  get money() {
    return (cents) => formatMoney(cents, this.data.moneyFormat);
  }

  selectPlan(plan) {
    const radio = plan.querySelector('.neu-plan__radio');
    if (radio && !radio.checked) radio.checked = true;
    this.update();
  }

  get selectedPlan() {
    return this.plans.find((plan) => plan.querySelector('.neu-plan__radio')?.checked);
  }

  get quantity() {
    return Math.max(1, parseInt(this.qtyInput?.value || '1', 10) || 1);
  }

  stepQuantity(delta) {
    if (!this.qtyInput) return;
    this.qtyInput.value = String(Math.max(1, this.quantity + delta));
    this.update();
  }

  onOptionChange() {
    // Options without a picker (the one the plan cards control) keep their current value
    const selected = [...this.variant.options];
    this.querySelectorAll('[data-option-index]:checked').forEach((input) => {
      selected[Number(input.dataset.optionIndex)] = input.value;
    });
    const match = this.data.variants.find((variant) => variant.options.every((value, i) => value === selected[i]));
    if (!match) return;

    this.variant = match;
    selected.forEach((value, i) => {
      const label = this.querySelector(`[data-option-label="${i}"]`);
      if (label) label.textContent = value;
    });

    this.update();
  }

  /**
   * The variant a plan card buys: its pack value combined with the currently picked flavour.
   * @param {HTMLElement} plan
   */
  variantFor(plan) {
    const pack = plan.dataset.pack;
    if (!pack) return this.variant;

    const packIndex = this.variant.options.findIndex((_, i) =>
      this.data.variants.some((variant) => variant.options[i] === pack)
    );
    if (packIndex < 0) return this.variant;

    return (
      this.data.variants.find((variant) =>
        variant.options.every((value, i) => (i === packIndex ? value === pack : value === this.variant.options[i]))
      ) || this.variant
    );
  }

  /** Keeps the URL and gallery in step with the variant that will be added to the cart. */
  showVariant(variant) {
    const id = String(variant.id);
    if (id === this.shownVariantId) return;
    const firstRun = !this.shownVariantId;
    this.shownVariantId = id;
    if (firstRun) return;

    const url = new URL(window.location.href);
    url.searchParams.set('variant', id);
    window.history.replaceState({}, '', url.toString());

    document.dispatchEvent(new CustomEvent(VARIANT_EVENT, { detail: { variant } }));
  }

  /**
   * Resolves the selling plan id and per-delivery price of a plan card for the current variant.
   * @param {HTMLElement} plan
   */
  priceFor(plan) {
    const type = plan.dataset.planType;

    if (type === 'product') {
      return {
        price: Number(plan.dataset.fixedPrice),
        planId: '',
        variantId: plan.dataset.variantId,
        available: true,
        variant: this.variant,
      };
    }

    const variant = this.variantFor(plan);

    const oneTime = { price: variant.price, planId: '', variantId: String(variant.id), available: variant.available, variant };

    if (type === 'subscription' || type === 'pack') {
      const wanted = plan.dataset.wantedPlanId;
      const position = Number(plan.dataset.planPosition) || 1;
      const planId = wanted && variant.plans[wanted] !== undefined ? wanted : wanted ? '' : variant.planOrder[position - 1];
      const subscription =
        planId && variant.plans[planId] !== undefined
          ? { ...oneTime, price: variant.plans[planId], planId, subscription: true }
          : null;

      if (type === 'pack') {
        const mode = plan.querySelector('[data-purchase]:checked')?.value;
        return { ...(subscription && mode === 'subscription' ? subscription : oneTime), oneTime, subscriptionOption: subscription };
      }
      if (subscription) return subscription;
    }

    return oneTime;
  }

  update() {
    const money = this.money;
    const variant = this.variant;

    this.plans.forEach((plan) => {
      const resolvedPlan = this.priceFor(plan);
      const { variant: planVariant } = resolvedPlan;
      // Pack cards headline the upfront one-time price; their Subscribe / Buy once rows carry both prices
      const price = resolvedPlan.oneTime ? resolvedPlan.oneTime.price : resolvedPlan.price;
      const months = Number(plan.dataset.months) || 1;
      const servings = Number(plan.dataset.servings) || 1;
      const perMonth = plan.dataset.perMonth === 'true';
      const perLabel = plan.dataset.perLabel || '/day';

      const amount = plan.querySelector('[data-plan-amount]');
      if (amount) amount.textContent = money(perMonth ? Math.round(price / months) : price);

      const per = plan.querySelector('[data-plan-per]');
      if (per) {
        per.textContent = `${money(Math.round(price / servings))}${perLabel}${months > 1 ? ` · ${months}mo = ${money(price)}` : ''}`;
      }

      const purchase = plan.querySelector('.neu-purchase');
      if (purchase) {
        const option = resolvedPlan.subscriptionOption;
        purchase.hidden = !option;
        const subPrice = plan.querySelector('[data-purchase-price="subscription"]');
        if (subPrice && option) subPrice.textContent = money(option.price);
        const oneTimePrice = plan.querySelector('[data-purchase-price="one_time"]');
        if (oneTimePrice) oneTimePrice.textContent = money(resolvedPlan.oneTime.price);
        const purchaseSave = plan.querySelector('[data-purchase-save]');
        if (purchaseSave && option) {
          const percent = this.savePercent(option.price, 1, planVariant);
          purchaseSave.hidden = percent <= 0;
          purchaseSave.textContent = `Save ${percent}%`;
        }
      }

      const save = plan.querySelector('[data-plan-save]');
      if (save) {
        const percent = this.savePercent(price, months, planVariant);
        save.hidden = percent <= 0;
        save.textContent = `Save ${percent}%`;
      }

      plan.classList.toggle('is-selected', !!plan.querySelector('.neu-plan__radio')?.checked);
    });

    const plan = this.selectedPlan;
    const resolved = plan
      ? this.priceFor(plan)
      : { price: variant.price, planId: '', variantId: String(variant.id), available: variant.available, variant };
    const months = resolved.subscription && plan.dataset.planType === 'subscription' ? Number(plan.dataset.months) || 1 : 1;
    const percent = resolved.subscription ? this.savePercent(resolved.price, months, resolved.variant) : 0;
    const total = resolved.price * this.quantity;
    const compare = resolved.variant.price * months * this.quantity;

    this.showVariant(resolved.variant);

    this.variantInput.value = resolved.variantId;
    this.planInput.value = resolved.planId;
    this.planInput.disabled = !resolved.planId;

    this.setText('[data-total-price]', money(total));
    this.toggleText('[data-total-compare]', percent > 0 ? money(compare) : '');
    this.toggleText('[data-total-save]', percent > 0 ? `Save ${percent}%` : '');

    this.addButton.disabled = !resolved.available;
    this.addLabel.textContent = resolved.available
      ? `${this.data.buttonLabel} — ${money(total)}`
      : this.data.soldOutLabel;

    document.dispatchEvent(
      new CustomEvent(STATE_EVENT, {
        detail: {
          variant: resolved.variant,
          price: money(total),
          compare: percent > 0 ? money(compare) : '',
          save: percent > 0 ? `Save ${percent}%` : '',
          available: resolved.available,
        },
      })
    );
  }

  savePercent(price, months, variant = this.variant) {
    const baseline = variant.price * months;
    return baseline > price ? Math.round(((baseline - price) / baseline) * 100) : 0;
  }

  setText(selector, text) {
    const element = this.querySelector(selector);
    if (element) element.textContent = text;
  }

  toggleText(selector, text) {
    const element = this.querySelector(selector);
    if (!element) return;
    element.textContent = text;
    element.hidden = !text;
  }

  async fetchCart() {
    const response = await fetch(`${window.Theme?.routes?.cart_url || '/cart'}.js`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Failed to fetch cart: ${response.status}`);
    return response.json();
  }

  async onSubmit(event) {
    event.preventDefault();
    if (this.addButton.disabled) return;

    const formData = new FormData(this.form);
    [...formData.keys()].filter((key) => key.startsWith('neu-')).forEach((key) => formData.delete(key));

    const sectionIds = [...document.querySelectorAll('cart-items-component')]
      .map((element) => element instanceof HTMLElement && element.dataset.sectionId)
      .filter(Boolean);
    if (sectionIds.length) formData.append('sections', sectionIds.join(','));

    this.addButton.setAttribute('aria-busy', 'true');
    this.error.textContent = '';

    const variantId = String(formData.get('id'));
    const itemCount = Number(formData.get('quantity')) || this.quantity;
    const deferredEventPromise = CartLinesUpdateEvent.createPromise();

    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: [{ merchandiseId: variantId, quantity: itemCount }],
        promise: deferredEventPromise.promise,
      })
    );

    const eventDetail = {
      source: 'neu-buy-box',
      itemCount,
      productId: this.closest('[data-product-id]')?.getAttribute('data-product-id') || undefined,
    };

    try {
      const response = await fetch(window.Theme?.routes?.cart_add_url || '/cart/add.js', {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: formData,
      });
      const body = await response.json();
      const failed = !response.ok || Boolean(body.status);

      if (failed) {
        this.error.textContent = body.description || body.message || 'Could not add to cart';
        this.dispatchEvent(
          new CartErrorEvent({
            error: body.message || 'Add to cart failed',
            code: 'INVALID',
            detail: { description: body.description, errors: body.errors },
          })
        );
      }

      const cart = await this.fetchCart();
      deferredEventPromise.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: { ...eventDetail, items: cart.items, sections: failed ? undefined : body.sections, didError: failed },
      });

      if (!failed && !document.querySelector('cart-drawer-component')) {
        window.location.href = window.Theme?.routes?.cart_url || '/cart';
      }
    } catch (error) {
      console.error(error);
      deferredEventPromise.reject(error);
      this.error.textContent = 'Could not add to cart';
      this.dispatchEvent(
        new CartErrorEvent({ error: error?.message || 'Network error during add to cart', code: 'SERVICE_UNAVAILABLE' })
      );
    } finally {
      this.addButton.removeAttribute('aria-busy');
    }
  }
}

class NeuStickyBar extends HTMLElement {
  connectedCallback() {
    this.buyBox = document.querySelector('neu-buy-box');
    const target = this.buyBox?.querySelector('[data-add-button]');
    if (!target) return;

    this.button = this.querySelector('[data-sticky-add]');
    this.button?.addEventListener('click', () => {
      target.click();
    });

    // Always shown, so add to cart is one click away anywhere on the page
    this.classList.add('is-visible');
    this.removeAttribute('aria-hidden');
    if (this.button) this.button.tabIndex = 0;

    this.onState = (event) => {
      const { variant, price, compare, save, available } = event.detail;
      this.setText('[data-sticky-variant]', variant.title);
      this.setText('[data-sticky-price]', price);
      this.toggle('[data-sticky-compare]', compare);
      this.toggle('[data-sticky-save]', save);
      if (this.button) this.button.disabled = !available;
      const image = this.querySelector('[data-sticky-image]');
      if (image instanceof HTMLImageElement && variant.image) {
        image.src = variant.image;
        image.removeAttribute('srcset');
      }
    };
    document.addEventListener(STATE_EVENT, this.onState);
  }

  disconnectedCallback() {
    document.removeEventListener(STATE_EVENT, this.onState);
  }

  setText(selector, text) {
    const element = this.querySelector(selector);
    if (element) element.textContent = text;
  }

  toggle(selector, text) {
    const element = this.querySelector(selector);
    if (!element) return;
    element.textContent = text;
    element.hidden = !text;
  }
}

if (!customElements.get('neu-gallery')) customElements.define('neu-gallery', NeuGallery);
if (!customElements.get('neu-tabs')) customElements.define('neu-tabs', NeuTabs);
// The sticky bar listens for the buy box's first state, so it is defined first.
if (!customElements.get('neu-sticky-bar')) customElements.define('neu-sticky-bar', NeuStickyBar);
if (!customElements.get('neu-buy-box')) customElements.define('neu-buy-box', NeuBuyBox);
