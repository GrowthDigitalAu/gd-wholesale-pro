/* Shopify validates inventory and applies wholesale discounts in the cart. */
if (!customElements.get('gd-quick-order')) {
  customElements.define('gd-quick-order', class extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;
      this.rows = [...this.querySelectorAll('[data-variant]')];
      this.button = this.querySelector('[data-add]');
      this.status = this.querySelector('[data-status]');
      if (!this.button) return;
      this.querySelector('[data-search]').addEventListener('input', (event) => {
        const query = event.target.value.trim().toLowerCase();
        this.rows.forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
        this.querySelector('[data-empty]').hidden = this.rows.some(row => !row.hidden);
      });
      this.addEventListener('input', event => {
        if (event.target.matches('[data-quantity]')) this.updateTotal();
      });
      this.button.addEventListener('click', () => this.addItems());
      this.updateTotal();
    }
    updateTotal() {
      const units = this.rows.reduce((sum, row) => {
        const input = row.querySelector('[data-quantity]');
        if (input.disabled) return sum;
        const value = Number(input.value);
        return sum + (Number.isSafeInteger(value) && value > 0 ? value : 0);
      }, 0);
      this.querySelector('[data-total]').textContent = `${units} units selected`;
    }
    async addItems() {
      if (this.busy) return;
      const items = [];
      this.status.textContent = '';
      for (const row of this.rows) {
        const input = row.querySelector('[data-quantity]');
        if (input.disabled) continue;
        const quantity = Number(input.value);
        if (!Number.isSafeInteger(quantity) || quantity < 0 || (quantity > 0 && quantity < Number(row.dataset.minimum))) {
          this.status.textContent = `Enter a whole quantity of at least ${row.dataset.minimum}, or 0 to skip this variant.`;
          row.hidden = false;
          input.focus();
          return;
        }
        if (quantity > 0) items.push({ id: row.dataset.variant, quantity });
      }
      if (!items.length) { this.status.textContent = 'Select at least one available variant.'; return; }
      if (items.length > 100) { this.status.textContent = 'Add up to 100 variants at a time.'; return; }
      this.busy = true;
      this.button.disabled = true;
      this.status.textContent = 'Adding selected variants...';
      this.rows.forEach(row => { row.querySelector('[data-quantity]').readOnly = true; });
      try {
        const root = window.Shopify?.routes?.root || '/';
        const response = await fetch(`${root}cart/add.js`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.description || data.message || 'Cart rejected these items.');
        this.rows.forEach(row => { if (!row.querySelector('[data-quantity]').disabled) row.querySelector('[data-quantity]').value = '0'; });
        this.updateTotal();
        this.status.textContent = 'Selected variants added. Open your cart to confirm quantities and wholesale totals.';
      } catch (error) {
        this.status.textContent = `${error.message || 'Unable to confirm cart update.'} Check your cart before retrying to avoid duplicate quantities.`;
      } finally {
        this.busy = false;
        this.button.disabled = false;
        this.rows.forEach(row => { row.querySelector('[data-quantity]').readOnly = false; });
      }
    }
  });
}
