(function() {
  function formatMoney(cents, format) {
    if (typeof cents === 'string') cents = cents.replace('.', '');
    let value = '';
    const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
    const formatString = format || "${{amount}}";

    function defaultOption(opt, def) {
       return (typeof opt == 'undefined' ? def : opt);
    }

    function formatWithDelimiters(number, precision, thousands, decimal) {
      precision = defaultOption(precision, 2);
      thousands = defaultOption(thousands, ',');
      decimal   = defaultOption(decimal, '.');

      if (isNaN(number) || number == null) { return 0; }

      number = (number/100.0).toFixed(precision);

      var parts   = number.split('.'),
          dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands),
          cents   = parts[1] ? (decimal + parts[1]) : '';

      return dollars + cents;
    }

    switch(formatString.match(placeholderRegex)[1]) {
      case 'amount':
        value = formatWithDelimiters(cents, 2);
        break;
      case 'amount_no_decimals':
        value = formatWithDelimiters(cents, 0);
        break;
      case 'amount_with_comma_separator':
        value = formatWithDelimiters(cents, 2, '.', ',');
        break;
      case 'amount_no_decimals_with_comma_separator':
        value = formatWithDelimiters(cents, 0, '.', ',');
        break;
    }

    return formatString.replace(placeholderRegex, value);
  }

  function updateTarget(container, html) {
    if (container) container.innerHTML = html;
  }

  function initB2BPrice(config) {
    const { isB2B, moneyFormat, variantsData, blockId, selectedVariantId } = config;
    let currentHtml = '';

    function updatePriceDisplay(variantId) {
      const data = variantsData[variantId];
      if (!data) return;

      let html = '';

      if (isB2B && data.b2b_price && data.b2b_price > 0) {
         html = `
            <div class="b2b-price-wrapper b2b-customer-price">
                <span class="b2b-price-current">${formatMoney(data.b2b_price, moneyFormat)}</span>
                <span class="b2b-price-original" style="text-decoration: line-through;">
                  ${formatMoney(data.price, moneyFormat)}
                </span>
            </div>
         `;
      } 
      else if (data.compare_at_price && data.compare_at_price > data.price) {
         html = `
            <div class="b2b-price-wrapper b2b-regular-sale">
                <span class="b2b-price-current">${formatMoney(data.price, moneyFormat)}</span>
                <span class="b2b-price-compare" style="text-decoration: line-through;">
                  ${formatMoney(data.compare_at_price, moneyFormat)}
                </span>
            </div>
         `;
      }
      else {
         html = `
            <div class="b2b-price-wrapper b2b-regular-price">
                <span class="b2b-price-current">${formatMoney(data.price, moneyFormat)}</span>
            </div>
         `;
      }
      
      currentHtml = html; 

      const internalContainer = document.getElementById("b2b-price-container-" + blockId);
      updateTarget(internalContainer, html);
    }

    function observeAndTriggerUpdate(productContainer, fallbackVariantId) {
        if (productContainer) {
          const variantInput = productContainer.querySelector('.js-gd-ext-selected-variant-id');
          if (variantInput) {
            let fallbackTimeout;

            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
                  const updatedVariantId = variantInput.value;
                  if (updatedVariantId) {
                    const priceContainer = productContainer.querySelector("#b2b-price-container-" + blockId);
                    if (priceContainer) {
                        updatePriceDisplay(updatedVariantId);
                    }
                    if (fallbackTimeout) clearTimeout(fallbackTimeout);
                    observer.disconnect();
                  }
                }
              });
            });
            
            observer.observe(variantInput, { attributes: true });
            
            fallbackTimeout = setTimeout(() => {
              if(variantInput.value) {
                const priceContainer = productContainer.querySelector("#b2b-price-container-" + blockId);
                if (priceContainer) {
                  updatePriceDisplay(variantInput.value);
                }
              }
            }, 500);
            return;
          }
        }
        
        if(fallbackVariantId) updatePriceDisplay(fallbackVariantId);
    }

    let currentVariantId = selectedVariantId;
    updatePriceDisplay(currentVariantId);

    // Listen for click on variant pickers
    document.body.addEventListener('click', function(e) {
      if (e.target.matches('.js-gd-ext-variant-picker-rb')) {
         const productContainer = e.target.closest('.js-gd-ext-product-info-container');
         const variantId = e.target.getAttribute('data-variant-id');
         observeAndTriggerUpdate(productContainer, variantId);
      }
    });

    // Listen for change on dropdown variant pickers
    document.body.addEventListener('change', function(e) {
      if (e.target.tagName === 'SELECT') {
        const selectedOption = e.target.options[e.target.selectedIndex];
        if (selectedOption && selectedOption.classList.contains('js-gd-ext-variant-picker-dd')) {
          const productContainer = e.target.closest('.js-gd-ext-product-info-container');
          const variantId = selectedOption.getAttribute('data-variant-id');
          observeAndTriggerUpdate(productContainer, variantId);
        }
      }
    });
  }

  // Initialization Pattern
  window.b2bPriceConfigs = window.b2bPriceConfigs || [];
  window.b2bPriceConfigs.forEach(initB2BPrice);
  
  // Override push to capture future additions
  const oldPush = window.b2bPriceConfigs.push;
  window.b2bPriceConfigs.push = function(config) {
    oldPush.call(this, config);
    initB2BPrice(config);
  };

})();
