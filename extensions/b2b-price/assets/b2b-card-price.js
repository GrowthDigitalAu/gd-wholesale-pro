if (!customElements.get('b2b-card-price')) {
  class B2bCardPrice extends HTMLElement {
    constructor() {
      super();
    }

    connectedCallback() {
      requestAnimationFrame(() => this.loadInitialPrice());
    }

    getConfiguration() {
      const scriptTag = this.querySelector('script[data-prod-card-price]');
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

    loadInitialPrice() {
      const config = this.getConfiguration();
      if (!config) return;

      const { variantsData, moneyFormat } = config;
      const variants = Object.values(variantsData);
      
      if (variants.length === 0) return;

      const isSingleVariant = variants.length === 1;
      const priceContainer = this.querySelector('.js-gd-ext-card-price');
      if (!priceContainer) return;

      let finalHtml = '';
      
      const regularPrices = variants.map(v => v.price);
      const minRegular = Math.min(...regularPrices);
      const maxRegular = Math.max(...regularPrices);
      
      const b2bPrices = variants
            .filter(v => v.b2b_price !== null && v.b2b_price > 0)
            .map(v => v.b2b_price);
            
      const minB2b = b2bPrices.length > 0 ? Math.min(...b2bPrices) : Infinity;
      const maxB2b = b2bPrices.length > 0 ? Math.max(...b2bPrices) : Infinity;

      const winnerIsB2B = minB2b < minRegular;
      
      let displayPrice, displayCompareAt;

      if (winnerIsB2B) {
           displayPrice = minB2b;
           
           const validRegulars = regularPrices.filter(p => p > displayPrice);
           if (validRegulars.length > 0) {
               displayCompareAt = Math.min(...validRegulars);
           }
      } else {
           displayPrice = minRegular;

           const compareAtPrices = variants
                .map(v => v.compare_at_price)
                .filter(p => p !== null && p > displayPrice);

           if (compareAtPrices.length > 0) {
                 displayCompareAt = Math.min(...compareAtPrices);
           }
      }
      
      let showFrom = false;
      
      if (!isSingleVariant) {
          const hasAnyB2B = b2bPrices.length > 0;
          
          if (hasAnyB2B) {
              const allHaveB2b = b2bPrices.length === variants.length;
              const allB2bSame = minB2b === maxB2b;
              showFrom = !(allHaveB2b && allB2bSame);
              
          } else {
              const allRegularSame = minRegular === maxRegular;
              showFrom = !allRegularSame;
          }
      }

      if (displayCompareAt) {
           finalHtml += `<div class="b2b-compare-price"><span class="price-compare" style="text-decoration: line-through;">${this.formatMoney(displayCompareAt, moneyFormat)}</span></div>`;
      }
      
      finalHtml += `<div class="b2b-current-price">`;
      if (showFrom) {
          finalHtml += `<span class="price-from">From </span>`;
      }

      finalHtml += `<span class="price-current">${this.formatMoney(displayPrice, moneyFormat)}</span></div>`;

      priceContainer.innerHTML = finalHtml;
    }   
  }
  customElements.define("b2b-card-price", B2bCardPrice);
}