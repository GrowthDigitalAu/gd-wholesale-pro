document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('gd-b2b-cart-modal');
  if (!modal) return;

  const checkbox = document.getElementById('gd-b2b-opt-out-checkbox');
  const btnCancel = document.getElementById('gd-b2b-modal-cancel');
  const btnCheckout = document.getElementById('gd-b2b-modal-checkout');
  let currentEvent = null;

  // ─── Helper: clear the opt-out attribute from the cart ────────────────────
  async function clearOptOut() {
    try {
      await fetch(window.Shopify.routes.root + 'cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: { 'gd_b2b_checkout_retail': '' } })
      });
    } catch (e) {
      // silent fail – not critical
    }
  }

  // ─── Auto-clear on every page load ────────────────────────────────────────
  // The opt-out flag exists only to pass through checkout. As soon as the user
  // is back on any storefront page, wipe it so discounts are immediately visible.
  clearOptOut();

  // ─── Auto-restore: clear opt-out whenever the cart is modified ───────────
  // Intercept fetch() calls for cart/change.js and cart/add.js
  const _originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const isCartChange = /cart\/(change|add)\.js/.test(url);
    const result = await _originalFetch.apply(this, args);
    if (isCartChange && result.ok) {
      // Fire-and-forget – clear the opt out flag
      clearOptOut();
    }
    return result;
  };

  // Also intercept XMLHttpRequest for themes that use jQuery.ajax
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._gdUrl = url;
    return _open.call(this, method, url, ...rest);
  };
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      if (/cart\/(change|add)\.js/.test(this._gdUrl || '')) {
        clearOptOut();
      }
    });
    return _send.apply(this, args);
  };

  // ─── Modal UI logic ───────────────────────────────────────────────────────
  checkbox.addEventListener('change', (e) => {
    btnCheckout.disabled = !e.target.checked;
  });

  btnCancel.addEventListener('click', () => {
    modal.style.display = 'none';
    checkbox.checked = false;
    btnCheckout.disabled = true;
  });

  btnCheckout.addEventListener('click', async () => {
    btnCheckout.disabled = true;
    const originalText = btnCheckout.innerText;
    btnCheckout.innerText = "Applying...";

    try {
      await fetch(window.Shopify.routes.root + 'cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attributes: { 'gd_b2b_checkout_retail': 'true' }
        })
      });

      if (currentEvent && currentEvent.target && currentEvent.target.closest('form[action="/cart"], form[action^="/checkout"]')) {
        currentEvent.target.closest('form').submit();
      } else {
        window.location.href = '/checkout';
      }
    } catch (err) {
      console.error(err);
      window.location.href = '/checkout';
    }
  });

  // ─── Checkout button intercept ────────────────────────────────────────────
  document.addEventListener('click', async (e) => {
    const isCheckoutBtn =
      e.target.matches('[name="checkout"], [href="/checkout"], [href^="/checkout?"]') ||
      e.target.closest('[name="checkout"], [href="/checkout"], [href^="/checkout?"]');

    if (!isCheckoutBtn) return;
    if (e.target.closest('#gd-b2b-cart-modal')) return;

    // Only intercept if a min order threshold is configured
    const minOrder = window.GDB2B_MIN_ORDER_CENTS || 0;
    if (!minOrder) return; // No minimum set — let Shopify handle it

    // Old B2B customers (with 'old_b2b_customer' tag) are exempt from the minimum
    if (window.GDB2B_IS_OLD_CUSTOMER) return;

    try {
      // We MUST temporarily pause the click to check the cart asynchronously.
      // We only call preventDefault here; we will re-allow if no modal is needed.
      e.preventDefault();
      e.stopPropagation();

      const res = await fetch(window.Shopify.routes.root + 'cart.js');
      const cart = await res.json();

      // Helper to proceed to checkout natively
      const proceedToCheckout = () => {
        if (isCheckoutBtn.tagName === 'A') {
          window.location.href = isCheckoutBtn.href || '/checkout';
        } else if (isCheckoutBtn.closest && isCheckoutBtn.closest('form')) {
          isCheckoutBtn.closest('form').submit();
        } else {
          window.location.href = '/checkout';
        }
      };

      // If cart is empty or has no value, don't intercept
      if (!cart.item_count || !cart.total_price) {
        proceedToCheckout();
        return;
      }

      const isAlreadyOptedOut = cart.attributes && cart.attributes['gd_b2b_checkout_retail'] === 'true';

      if (cart.total_price < minOrder && !isAlreadyOptedOut) {
        // Show the opt-out modal
        currentEvent = e;
        modal.style.display = 'flex';
      } else {
        // Threshold met or already opted out — re-trigger natively
        proceedToCheckout();
      }
    } catch (err) {
      console.error("Cart check failed", err);
      // On error, do nothing — let Shopify's native event handle it
    }
  }, true);
});
