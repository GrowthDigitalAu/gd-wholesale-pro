if (!customElements.get('b2b-prod-price')) {
  class B2bProdPrice extends HTMLElement {
    constructor() {
      super();
      this._instanceId = Math.random().toString(36).substr(2, 9);
    }

    connectedCallback() {
      this.setupVisibilityObserver();
    }

    disconnectedCallback() {
      this.cleanup();
    }
    
    cleanup() {
      this.unbindEvents();
      if (this.visibilityObserver) {
        this.visibilityObserver.disconnect();
        this.visibilityObserver = null;
      }
      if (this.currentObserver) {
        this.currentObserver.disconnect();
        this.currentObserver = null;
      }
      this.dataset.initialized = "false";
    }

    setupVisibilityObserver() {
      if (this.visibilityObserver) return;

      this.visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.handleConnect();
          } else {
             this.unbindEvents(); 
             this.dataset.initialized = "false"; // Allo re-init if shown again
          }
        });
      }, {
        threshold: [0] 
      });

      this.visibilityObserver.observe(this);
    }

    handleConnect() {
      if (this.dataset.initialized === "true") return;

      const config = this.getConfiguration();
      if (config) {
        this.config = config;
        this.dataset.initialized = "true";
        this.bindEvents();
        const initialVariantId = document.querySelector('input[name="id"]')?.value || this.config.selectedVariantId;
        this.updatePriceDisplay(initialVariantId, false);
      }
    }

    getConfiguration() {
      const scriptTag = this.querySelector('script');
      if (!scriptTag || !scriptTag.textContent) return null;
      try {
        return JSON.parse(scriptTag.textContent.trim());
      } catch (e) {
        return null;
      }
    }

    formatMoney(cents, format) {
      if (typeof cents === 'string') cents = cents.replace('.', '');
      let value = '';
      const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
      const formatString = format || "${{amount}}";

      switch(formatString.match(placeholderRegex)[1]) {
        case 'amount':
          value = this.formatWithDelimiters(cents, 2);
          break;
        case 'amount_no_decimals':
          value = this.formatWithDelimiters(cents, 0);
          break;
        case 'amount_with_comma_separator':
          value = this.formatWithDelimiters(cents, 2, '.', ',');
          break;
        case 'amount_no_decimals_with_comma_separator':
          value = this.formatWithDelimiters(cents, 0, '.', ',');
          break;
      }

      return formatString.replace(placeholderRegex, value);
    }

    defaultOption(opt, def) {
      return (typeof opt == 'undefined' ? def : opt);
    }

    formatWithDelimiters(number, precision, thousands, decimal) {
      precision = this.defaultOption(precision, 2);
      thousands = this.defaultOption(thousands, ',');
      decimal = this.defaultOption(decimal, '.');

      if (isNaN(number) || number == null) { return 0; }

      number = (number/100.0).toFixed(precision);

      var parts = number.split('.'),
          dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands),
          cents = parts[1] ? (decimal + parts[1]) : '';

      return dollars + cents;
    }

    updateTarget(container, html) {
      if (container) {
          container.innerHTML = html;
      }
    }

    getEffectiveB2BPrice(data) {
      if (!data) return null;

      const customerTags = Array.isArray(this.config?.customerTags) ? this.config.customerTags : [];
      const groupPrices = data.b2b_group_prices || {};

      for (const tag of customerTags) {
        const groupPrice = Number(groupPrices[tag]);
        if (groupPrice > 0) return Math.round(groupPrice * 100);
      }

      return data.b2b_price && data.b2b_price > 0 ? data.b2b_price : null;
    }

    updatePriceDisplay(variantId, stickyAddCartPresent) {
        if (!this.config) return;
        const { isB2B, moneyFormat, variantsData } = this.config;
        
        const data = variantsData[variantId];
        if (!data) return;

        let html = '';
        const b2bPrice = this.getEffectiveB2BPrice(data);

        if (isB2B && b2bPrice && b2bPrice > 0) {
           const minQtyText = this.config.minQtyText;
           const minQtyEnabled = this.config.minQtyEnabled !== false; // Default to true if missing
           const minQtyBadge = (minQtyEnabled && data.b2b_min_qty && data.b2b_min_qty > 1 && minQtyText) 
                ? `<div class="b2b-min-qty-text b2b-min-qty-wrapper"><span class="b2b-min-qty-inner-text">${minQtyText.replace('[b2b_min_qty]', data.b2b_min_qty)}</span></div>` 
                : '';
           html = `
              <div class="b2b-price-wrapper b2b-customer-price">
                  <div class="b2b-price-group">
                    <span class="b2b-price-current">
                      ${this.formatMoney(b2bPrice, moneyFormat)}
                    </span>
                    <span class="b2b-price-original" style="text-decoration: line-through;">
                      ${this.formatMoney(data.price, moneyFormat)}
                    </span>
                  </div>
                  ${minQtyBadge}
              </div>
           `;
        } 
        else if (data.compare_at_price && data.compare_at_price > data.price) {
           html = `
              <div class="b2b-price-wrapper b2b-regular-sale">
                  <span class="b2b-price-current">${this.formatMoney(data.price, moneyFormat)}</span>
                  <span class="b2b-price-compare" style="text-decoration: line-through;">
                    ${this.formatMoney(data.compare_at_price, moneyFormat)}
                  </span>
              </div>
           `;
        }
        else {
           html = `
              <div class="b2b-price-wrapper b2b-regular-price">
                  <span class="b2b-price-current">${this.formatMoney(data.price, moneyFormat)}</span>
              </div>
           `;
        }
        
        const priceWrapper = this.querySelector('.js-b2b-price-wrapper');
        if (priceWrapper) {
            this.updateTarget(priceWrapper, html);
        }

        if (stickyAddCartPresent) {
          const stickyAddCartPriceWrapper = this.closest('.js-gd-ext-pdp-info-section')?.querySelector('.js-gd-ext-sticky-add-cart .js-gd-ext-sticky-add-to-cart-price');
          if (stickyAddCartPriceWrapper) {
            this.updateTarget(stickyAddCartPriceWrapper, html);
          }
        }
    }

    bindEvents() {
        if (this.hasBoundEvents) return;
        
        this._lastVariantId = document.querySelector('input[name="id"]')?.value || this.config.selectedVariantId;
        this.onVariantChange = this.handleVariantChange.bind(this);
        
        document.body.addEventListener('change', this.onVariantChange);
        document.body.addEventListener('click', this.onVariantChange);
        
        
        // Add To Cart Interceptor
        this.onAddToCart = this.handleAddCart.bind(this);
        document.body.addEventListener('submit', this.onAddToCart, true);
        document.body.addEventListener('click', this.onAddToCart, true);
        
        this.pollInterval = setInterval(() => {
             const currentId = document.querySelector('input[name="id"]')?.value;
             if (currentId && currentId !== this._lastVariantId) {
                  this._lastVariantId = currentId;
                  this.updatePriceDisplay(currentId, false);
             }
        }, 300);

        this.hasBoundEvents = true;
    }

    unbindEvents() {
        if (!this.hasBoundEvents) return;
        document.body.removeEventListener('change', this.onVariantChange);
        document.body.removeEventListener('click', this.onVariantChange);
        if (this.onAddToCart) {
            document.body.removeEventListener('submit', this.onAddToCart, true);
            document.body.removeEventListener('click', this.onAddToCart, true);
        }
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.hasBoundEvents = false;
    }

    handleVariantChange(e) {
        const isVariantChange = e.target.matches('.js-gd-ext-variant-picker') || 
                                e.target.closest('variant-selects') || 
                                e.target.closest('variant-radios') || 
                                e.target.name === 'id' || 
                                e.target.closest('.variant-input') || 
                                e.target.closest('form[action*="/cart/add"]');
                                
        if (isVariantChange) {
             // Wait briefly for theme to update hidden input value
             setTimeout(() => {
                 const variantInput = document.querySelector('input[name="id"]') || document.querySelector('.js-gd-ext-selected-variant-id');
                 if (variantInput && variantInput.value && variantInput.value !== this._lastVariantId) {
                     this._lastVariantId = variantInput.value;
                     this.updatePriceDisplay(variantInput.value, false);
                 }
             }, 100);
        }
    }

    handleAddCart(e) {
        let isAddToCartEvent = false;
        let form = null;
        
        if (e.type === 'submit') {
             form = e.target.closest('form[action*="/cart/add"], form.product-form');
             if (form) isAddToCartEvent = true;
        } else if (e.type === 'click') {
             const btn = e.target.closest('button[name="add"], button[type="submit"], .add-to-cart, .product-form__submit, [id*="AddToCart"]');
             if (btn) {
                 form = btn.closest('form[action*="/cart/add"], form.product-form') || document.querySelector('form[action*="/cart/add"], form.product-form');
                 if (form || btn.name === 'add' || btn.classList.contains('add-to-cart') || btn.classList.contains('product-form__submit')) {
                     isAddToCartEvent = true;
                 }
             }
        }
        
        if (!isAddToCartEvent) return;

        // Check if B2B conditions met
        if (!this.config || !this.config.isB2B) return;
        
        // Which variant is added? Use form input first, fallback to global input, fallback to last variant
        const idInput = form ? form.querySelector('input[name="id"]') : null;
        const variantId = idInput ? idInput.value : (document.querySelector('input[name="id"]')?.value || this._lastVariantId);
        if (!variantId) return;

        const data = this.config.variantsData[variantId];
        const b2bPrice = this.getEffectiveB2BPrice(data);
        if (!data || !b2bPrice || !data.b2b_min_qty || data.b2b_min_qty <= 1) return;

        // What is the quantity requested? Look globally first because modern themes often put it outside the form body
        const qtyInput = document.querySelector('input[name="quantity"]') || (form ? form.querySelector('input[name="quantity"]') : null);
        let qty = 1;
        if (qtyInput && qtyInput.value) {
             qty = parseInt(qtyInput.value, 10);
        }

        // Only run minimum quantity enforcement if enabled
        const minQtyEnabled = this.config.minQtyEnabled !== false;
        if (!minQtyEnabled) return;

        if (qty > 0 && qty < data.b2b_min_qty) {
             e.preventDefault();
             e.stopPropagation();
             e.stopImmediatePropagation();
             
             this.showMinQtyModal(data.b2b_min_qty);
             return;
        }

        // If the quantity check passed, secretly inject the minimum quantity requirement rule as a Cart Property!
        // This ensures the Cart Drawer cannot bypass the restriction!
        if (form) {
             let minQtyPropInput = form.querySelector('input[name="properties[_gd_b2b_min_qty]"]');
             if (!minQtyPropInput) {
                  minQtyPropInput = document.createElement('input');
                  minQtyPropInput.type = 'hidden';
                  minQtyPropInput.name = 'properties[_gd_b2b_min_qty]';
                  form.appendChild(minQtyPropInput);
             }
             minQtyPropInput.value = data.b2b_min_qty;
        }
    }
    
    showMinQtyModal(minQty) {
        let modal = document.getElementById('gd-b2b-qty-modal');
        if (!modal) {
            const style = document.createElement('style');
            style.innerHTML = `
                #gd-b2b-qty-modal {
                    position: fixed;
                    top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.6);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 9999999;
                    backdrop-filter: blur(2px);
                }
                .gd-b2b-qty-modal-content {
                    background: #fff;
                    padding: 36px 30px;
                    border-radius: 12px;
                    max-width: 400px;
                    width: 90%;
                    text-align: center;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
                    font-family: inherit;
                    animation: gdPopIn 0.3s ease-out;
                }
                @keyframes gdPopIn {
                    from { opacity: 0; transform: scale(0.9); }
                    to { opacity: 1; transform: scale(1); }
                }
                .gd-b2b-qty-modal-title {
                    margin-top: 0;
                    color: #111;
                    font-size: 1.4rem;
                    font-weight: bold;
                    margin-bottom: 12px;
                    line-height: 1.3;
                }
                .gd-b2b-qty-modal-text {
                    color: #444;
                    margin-bottom: 24px;
                    font-size: 1rem;
                    line-height: 1.5;
                }
                .gd-b2b-qty-modal-text strong {
                    color: #d8000c;
                    background: #ffeaeb;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 1.1em;
                }
                .gd-b2b-qty-btn {
                    background: #111;
                    color: #fff;
                    border: none;
                    padding: 12px 28px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 1rem;
                    width: 100%;
                    transition: background 0.2s ease;
                }
                .gd-b2b-qty-btn:hover {
                    background: #333;
                }
            `;
            document.head.appendChild(style);

            modal = document.createElement('div');
            modal.id = 'gd-b2b-qty-modal';
            modal.innerHTML = `
                <div class="gd-b2b-qty-modal-content">
                    <h3 class="gd-b2b-qty-modal-title">Minimum Quantity Required</h3>
                    <p class="gd-b2b-qty-modal-text">You must add at least <strong id="gd-b2b-qty-req"></strong> items of this variant to your cart to qualify for wholesale pricing.</p>
                    <button class="gd-b2b-qty-btn" onclick="document.getElementById('gd-b2b-qty-modal').style.display='none'">Got it</button>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        document.getElementById('gd-b2b-qty-req').innerText = minQty;
        modal.style.display = 'flex';
    }
  }
  customElements.define("b2b-prod-price", B2bProdPrice);
}


if (!customElements.get('b2b-sticky-cart-price')) {
  class B2bStickyCartPrice extends HTMLElement {
    constructor() {
      super();
    }

    connectedCallback() {
      requestAnimationFrame(() => this.loadInitialPrice());
    }

    loadInitialPrice() {
      const productInfoWrapper = this.closest(".js-gd-ext-pdp-info-section");
      if (!productInfoWrapper) return;

      const stickyPriceWrapper = productInfoWrapper.querySelector(".js-gd-ext-sticky-add-to-cart-price");
      const b2bPriceWrapper = productInfoWrapper.querySelector(".js-gd-ext-b2b-price-block");
      
      if (stickyPriceWrapper && b2bPriceWrapper && b2bPriceWrapper.innerHTML.trim().length > 0) {
          stickyPriceWrapper.innerHTML = b2bPriceWrapper.innerHTML;
      }
    }   
  }
  customElements.define("b2b-sticky-cart-price", B2bStickyCartPrice);
}
