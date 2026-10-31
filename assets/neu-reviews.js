/**
 * Fills the reviews marquee with real reviews from Judge.me.
 *
 * Data comes from Judge.me's public widget endpoint, the same one its own
 * review widget pages through. It needs no token and allows any origin.
 * Cards are cloned from the <template data-card> so they match the review
 * block cards rendered in Liquid. If the request fails or there are no
 * reviews, the marquee stays hidden rather than showing placeholder copy.
 */

const ENDPOINT = 'https://api.judge.me/reviews/reviews_for_widget';
const MAX_SCREEN_PX = 3840;
const MAX_COPIES = 12;

/** @param {string} html */
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html || '').replace(/<br\s*\/?>/gi, ' '), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/** @param {string} url @param {number} width */
function resizeImage(url, width) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('width', String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

class NeuReviewsFeed extends HTMLElement {
  connectedCallback() {
    if (this.started) return;
    this.started = true;
    this.load().catch(() => {
      // Leave the marquee hidden: no placeholder reviews on the live page.
    });
  }

  async load() {
    const { shopDomain, productId, limit } = this.dataset;
    if (!shopDomain || !productId) return;

    const params = new URLSearchParams({
      url: shopDomain,
      shop_domain: shopDomain,
      platform: 'shopify',
      product_id: productId,
      page: '1',
      per_page: limit || '20',
    });
    const response = await fetch(`${ENDPOINT}?${params}`, { credentials: 'omit' });
    if (!response.ok) return;

    const data = await response.json();
    const reviews = (data.reviews || []).filter((review) => htmlToText(review.body_html || review.body));
    if (reviews.length === 0) return;

    this.updateSummary(data);
    this.render(reviews);
  }

  /** @param {{ number_of_reviews?: number, average_rating?: string }} data */
  updateSummary(data) {
    const section = this.closest('.neu-reviews');
    if (!section) return;

    const count = Number(data.number_of_reviews);
    const rating = Number(data.average_rating);
    if (!count || !rating) return;

    const score = section.querySelector('[data-neu-reviews-score]');
    if (score) score.textContent = `${rating.toFixed(1)} / 5`;

    const countEl = section.querySelector('[data-neu-reviews-count]');
    if (countEl) countEl.textContent = `${count.toLocaleString()} ${this.dataset.countLabel || 'reviews'}`;

    const stars = section.querySelector('[data-neu-reviews-stars]');
    if (stars) stars.replaceChildren(...this.stars(rating));
  }

  /** @param {number} rating */
  stars(rating) {
    const full = this.querySelector('template[data-star]');
    const empty = this.querySelector('template[data-star-empty]');
    const nodes = [];
    for (let i = 1; i <= 5; i += 1) {
      const template = rating >= i - 0.25 ? full : empty || full;
      if (template instanceof HTMLTemplateElement) nodes.push(template.content.cloneNode(true));
    }
    return nodes;
  }

  /** @param {any} review */
  card(review) {
    const template = this.querySelector('template[data-card]');
    if (!(template instanceof HTMLTemplateElement)) return null;

    const fragment = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
    const card = fragment.querySelector('.neu-review');
    if (!card) return null;
    const find = (selector) => card.querySelector(selector);

    const rating = Math.max(1, Math.min(5, Math.round(Number(review.rating) || 5)));
    const starsEl = find('[data-stars]');
    starsEl.setAttribute('aria-label', `${rating} out of 5 stars`);
    const full = this.querySelector('template[data-star]');
    if (full instanceof HTMLTemplateElement) {
      for (let i = 0; i < rating; i += 1) starsEl.append(full.content.cloneNode(true));
    }

    const name = String(review.reviewer_name || '').trim() || 'Anonymous';
    find('[data-initial]').textContent = (review.reviewer_initial || name.charAt(0)).toUpperCase();
    find('[data-name]').textContent = name;

    const title = htmlToText(review.title);
    if (title) find('[data-title]').textContent = title;
    else find('[data-title]').remove();

    find('[data-body]').textContent = htmlToText(review.body_html || review.body);

    if (!review.verified_buyer) find('[data-verified]').remove();

    const pictures = (review.pictures_urls || []).filter((picture) => picture && (picture.original || picture.huge));
    const photo = find('[data-photo]');
    if (pictures.length > 0) {
      card.classList.add('neu-review--photo');
      const img = photo.querySelector('img');
      const src = pictures[0].original || pictures[0].huge;
      img.src = resizeImage(src, 240);
      img.srcset = `${resizeImage(src, 240)} 1x, ${resizeImage(src, 480)} 2x`;
      img.alt = `Photo from ${name}`;
      const more = photo.querySelector('[data-photo-more]');
      if (pictures.length > 1) more.textContent = `+${pictures.length - 1}`;
      else more.remove();
    } else {
      photo.remove();
    }

    return card;
  }

  /** @param {any[]} reviews */
  render(reviews) {
    const track = this.querySelector('[data-track]');
    if (!track) return;

    const set = document.createElement('div');
    set.className = 'neu-reviews__set';
    for (const review of reviews) {
      const card = this.card(review);
      if (card) set.append(card);
    }
    if (!set.children.length) return;

    this.track = track;
    this.set = set;
    track.replaceChildren(set);
    this.hidden = false;
    this.layout();

    // Card text reflows at the phone breakpoint, which changes the card
    // height and so the photo width and set width. Re-run on width changes.
    let lastWidth = window.innerWidth;
    let frame = 0;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.layout());
    });
  }

  layout() {
    const { track, set } = this;
    if (!track || !set) return;

    // Drop the old loop copies so only the first set is measured.
    while (track.lastElementChild && track.lastElementChild !== set) track.lastElementChild.remove();

    // Photos fill the full card height at 3:4, so their width follows the
    // height. The photo column has no content height of its own, so the
    // height comes from the text: measure it with the photo column at zero,
    // then widen the column to three quarters of that height.
    track.style.setProperty('--neu-review-photo-w', '0px');
    const photo = set.querySelector('.neu-review__photo');
    if (photo) {
      const height = photo.getBoundingClientRect().height;
      if (height > 0) track.style.setProperty('--neu-review-photo-w', `${Math.round(height * 0.75)}px`);
      else track.style.removeProperty('--neu-review-photo-w');
    }

    // Same rule as the Liquid marquee: repeat the set until a full copy always
    // sits past the right edge of a 3840px screen, so the loop reset (one set
    // width) happens off-screen and the tail never shows blank space.
    const setWidth = set.getBoundingClientRect().width || set.children.length * 336;
    const copies = Math.min(MAX_COPIES, Math.floor(MAX_SCREEN_PX / setWidth) + 2);

    for (let i = 2; i <= copies; i += 1) {
      const copy = /** @type {HTMLElement} */ (set.cloneNode(true));
      copy.setAttribute('aria-hidden', 'true');
      copy.inert = true;
      for (const img of copy.querySelectorAll('img')) img.alt = '';
      track.append(copy);
    }
    track.style.setProperty('--neu-reviews-copies', String(copies));
  }
}

if (!customElements.get('neu-reviews-feed')) {
  customElements.define('neu-reviews-feed', NeuReviewsFeed);
}
