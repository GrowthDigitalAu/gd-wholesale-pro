(function() {
  if (customElements.get('b2b-prod-price')) return;

  class B2bProdPrice extends HTMLElement {
    constructor() {
      super();
      this._instanceId = Math.random().toString(36).substr(2, 9);
    }

    connectedCallback() {
      this.setupVisibilityObserver();
    }

    disconnectedCallback() {
      console.log("HelloBox disconnectedCallback");
      this.cleanup();
    }
    
    cleanup() {
      this.unbindEvents();
      if (this.visibilityObserver) {
        this.visibilityObserver.disconnect();
        this.visibilityObserver = null;
      }
      this.dataset.initialized = "false";
    }

    setupVisibilityObserver() {
      if (this.visibilityObserver) return;

      this.visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            console.log("HelloBox connectedCallback");
            this.handleConnect();
          } else {
             console.log("HelloBox disconnectedCallback---");
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
      console.log("----->>>", config);
      if (config) {
        this.config = config;
        this.initB2BPrice(this.config);
        this.bindEvents();
      }
    }

    getConfiguration() {
      const scriptTag = this.querySelector('script');
      if (!scriptTag || !scriptTag.textContent) return null;
      try {
        return JSON.parse(scriptTag.textContent.trim());
      } catch (e) {
        console.error("Error parsing config from script", e);
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

    initB2BPrice(config) {
      this.dataset.initialized = "true";
      const { selectedVariantId } = config;
      
      console.log('--->>>>selectedVariantId', selectedVariantId);
      if (selectedVariantId) {
          this.updatePriceDisplay(selectedVariantId);
      }
    }

    updatePriceDisplay(variantId) {
        if (!this.config) return;
        const { isB2B, moneyFormat, variantsData } = this.config;
        
        const data = variantsData[variantId];
        if (!data) return;

        let html = '';

        if (isB2B && data.b2b_price && data.b2b_price > 0) {
           html = `
              <div class="b2b-price-wrapper b2b-customer-price" style="display: block !important;">
                  <span class="b2b-price-current" style="display: block !important;">${this.formatMoney(data.b2b_price, moneyFormat)}</span>
                  <span class="b2b-price-original" style="text-decoration: line-through; display: block !important;">
                    ${this.formatMoney(data.price, moneyFormat)}
                  </span>
              </div>
           `;
        } 
        else if (data.compare_at_price && data.compare_at_price > data.price) {
           html = `
              <div class="b2b-price-wrapper b2b-regular-sale" style="display: block !important;">
                  <span class="b2b-price-current" style="display: block !important;">${this.formatMoney(data.price, moneyFormat)}</span>
                  <span class="b2b-price-compare" style="text-decoration: line-through; display: block !important;">
                    ${this.formatMoney(data.compare_at_price, moneyFormat)}
                  </span>
              </div>
           `;
        }
        else {
           html = `
              <div class="b2b-price-wrapper b2b-regular-price" style="display: block !important;">
                  <span class="b2b-price-current" style="display: block !important;">${this.formatMoney(data.price, moneyFormat)}</span>
              </div>
           `;
        }
        
        const priceWrapper = this.querySelector('.js-b2b-price-wrapper');
        if (priceWrapper) {
            this.updateTarget(priceWrapper, html);
        }
    }

    bindEvents() {
        if (this.hasBoundEvents) return;
        
        this.onVariantChange = this.handleVariantChange.bind(this);
        document.body.addEventListener('change', this.onVariantChange);

        this.hasBoundEvents = true;
    }

    unbindEvents() {
        if (!this.hasBoundEvents) return;
        document.body.removeEventListener('change', this.onVariantChange);
        this.hasBoundEvents = false;
    }

    safeObserveAndTrigger(productContainer) {
        if (!productContainer.contains(this) && productContainer !== this) {
             if (!productContainer.querySelector(`#${this.id}`)) {
                 return; 
             }
        }
        this.observeAndTriggerUpdate(productContainer);
    }

    handleVariantChange(e) {
        // Handle both Dropdowns and Radio Buttons with unified class name
        console.log("Variant change detected", e.target);
        if (e.target.matches('.js-gd-ext-variant-picker')) {
             const productContainer = e.target.closest('.js-gd-ext-product-info-container');
             if (productContainer) {
                 this.safeObserveAndTrigger(productContainer);
             }
        }
    }

    observeAndTriggerUpdate(productContainer) {
        if (productContainer) {
          const variantInput = productContainer.querySelector('.js-gd-ext-selected-variant-id');
          if (variantInput) {
            
            if (this.currentObserver) {
                this.currentObserver.disconnect();
                this.currentObserver = null;
            }

            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
                  const updatedVariantId = variantInput.value;
                  if (updatedVariantId) {
                    this.updatePriceDisplay(updatedVariantId);
                    observer.disconnect();
                    this.currentObserver = null;
                  }
                }
              });
            });
            
            this.currentObserver = observer;
            observer.observe(variantInput, { attributes: true });
            
            setTimeout(() => {
              if(variantInput.value) {
                this.updatePriceDisplay(variantInput.value);
              }
            }, 500);
            return;
          }
        }
        
        let fallbackVariantId = this.config.selectedVariantId;  
        if(fallbackVariantId) this.updatePriceDisplay(fallbackVariantId);
    }
  }

  customElements.define("b2b-prod-price", B2bProdPrice);
})();