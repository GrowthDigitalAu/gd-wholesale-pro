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
      this.catalog = this.querySelector('[data-catalog]');
      this.loadedPages = new Set([Number(this.catalog.dataset.currentPage)]);
      this.page = 0;
      this.query = '';
      this.querySelector('[data-search]').addEventListener('input', event => {
        this.query = event.target.value.trim().toLowerCase();
        this.page = 0;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(async () => {
          try { if (this.query) await this.loadCatalog(); this.showPage(); }
          catch (error) { this.status.textContent = error.message; }
        }, 300);
      });
      this.addEventListener('input', event => {
        if (event.target.matches('[data-quantity]')) this.updateTotal();
      });
      this.button.addEventListener('click', () => this.addItems());
      this.querySelector('[data-previous]').addEventListener('click', () => { this.page = Math.max(0, this.page - 1); this.showPage(); });
      this.querySelector('[data-next]').addEventListener('click', async () => {
        if (this.busy || this.listBusy) return;
        try { await this.loadCatalog(); this.page++; this.showPage(); }
        catch (error) { this.status.textContent = error.message; }
      });
      this.querySelector('[data-save-list]').addEventListener('click', () => this.saveList());
      this.querySelector('[data-load-list]').addEventListener('click', () => this.loadList());
      this.querySelector('[data-delete-list]').addEventListener('click', () => this.deleteList());
      this.querySelector('[data-fetch-orders]').addEventListener('click', () => this.fetchOrders());
      this.querySelector('[data-reorder]').addEventListener('click', () => {
        const order = this.orders?.find(entry => entry.id === this.querySelector('[data-orders]').value);
        if (!order) { this.status.textContent = 'Choose a previous order.'; return; }
        if (order.truncated) { this.status.textContent = 'This order has more than 100 lines. Use a smaller saved list instead.'; return; }
        this.loadList(order);
      });
      this.showPage();
      this.refreshLists().catch(error => { this.status.textContent = error.message; });
      this.updateTotal();
    }
    async loadCatalog() {
      if (this.catalogComplete) return;
      if (this.catalogTask) return this.catalogTask;
      this.catalogTask = (async () => {
        this.status.textContent = 'Loading collection...';
        for (let page = 1; page <= Number(this.catalog.dataset.pages); page++) {
          if (this.loadedPages.has(page)) continue;
          const url = new URL(window.location.href);
          url.searchParams.set(this.catalog.dataset.pageParam, String(page));
          const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) throw new Error('Collection loading failed. Retry your search or page change.');
          const html = new DOMParser().parseFromString(await response.text(), 'text/html');
          const block = html.getElementById(this.id);
          if (!block?.querySelector('[data-catalog]') || block.dataset.customer !== this.dataset.customer || block.dataset.group !== this.dataset.group) {
            throw new Error('Wholesale session or price list changed. Reload this page.');
          }
          const existing = new Set(this.rows.map(row => row.dataset.variant));
          block.querySelectorAll('[data-variant]').forEach(row => {
            if (!existing.has(row.dataset.variant)) {
              row.querySelector('[data-quantity]').value = '0';
              this.rows.push(row);
            }
          });
          this.loadedPages.add(page);
        }
        this.catalogComplete = true;
        this.status.textContent = 'Collection loaded.';
      })();
      try { await this.catalogTask; } finally { this.catalogTask = null; }
    }
    showPage() {
      const filtered = this.rows.filter(row => row.textContent.toLowerCase().includes(this.query));
      const pages = Math.max(1, Math.ceil(filtered.length / 25));
      this.page = Math.min(this.page, pages - 1);
      const body = this.querySelector('tbody');
      body.replaceChildren(...filtered.slice(this.page * 25, (this.page + 1) * 25));
      this.querySelector('[data-empty]').hidden = filtered.length > 0;
      this.querySelector('[data-page-label]').textContent = `Page ${this.page + 1} of ${pages}${this.catalogComplete ? '' : ' (collection not fully loaded)'}`;
      this.querySelector('[data-previous]').disabled = this.page === 0;
      this.querySelector('[data-next]').disabled = this.catalogComplete && this.page >= pages - 1;
    }
    async listRequest(body, orders = false) {
      const path = this.dataset.proxy;
      if (!/^\/apps\/[a-zA-Z0-9_/-]+$/.test(path)) throw new Error('Invalid saved-list proxy path.');
      const root = window.Shopify?.routes?.root || '/';
      const response = await fetch(`${root}${path.slice(1)}${orders ? '?orders=true' : ''}`, body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GD-Quick-Order': '1' }, body: JSON.stringify(body),
      } : { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Saved lists are unavailable.');
      return data;
    }
    async fetchOrders() {
      try {
        const data = await this.listRequest(undefined, true);
        this.orders = data.orders || [];
        const select = this.querySelector('[data-orders]');
        select.replaceChildren(new Option('Choose an order', ''));
        this.orders.forEach(order => select.add(new Option(order.name, order.id)));
        this.status.textContent = 'Recent paid orders loaded (up to 10, normally within the last 60 days).';
      } catch (error) { this.status.textContent = error.message; }
    }
    async refreshLists() {
      const data = await this.listRequest();
      this.lists = data.lists || [];
      const select = this.querySelector('[data-lists]');
      select.replaceChildren(new Option('Choose a list', ''));
      this.lists.forEach(list => select.add(new Option(list.name, list.id)));
    }
    selectedItems() {
      return this.rows.filter(row => !row.querySelector('[data-quantity]').disabled)
        .map(row => ({ id: row.dataset.variant, quantity: Number(row.querySelector('[data-quantity]').value) }))
        .filter(item => item.quantity !== 0);
    }
    async saveList() {
      if (this.busy || this.listBusy) return;
      this.listBusy = true;
      try {
        await this.listRequest({ intent: 'save', name: this.querySelector('[data-list-name]').value, items: this.selectedItems() });
        await this.refreshLists();
        this.status.textContent = 'Order list saved to your account.';
      } catch (error) { this.status.textContent = error.message; }
      finally { this.listBusy = false; }
    }
    async loadList(order) {
      if (this.busy || this.listBusy) return;
      const list = order || this.lists?.find(entry => entry.id === this.querySelector('[data-lists]').value);
      if (!list) { this.status.textContent = 'Choose a saved list.'; return; }
      if (this.selectedItems().length && !window.confirm('Replace the current quantities with this saved list?')) return;
      this.listBusy = true;
      try {
        await this.loadCatalog();
        const selected = new Map(list.items.map(item => [item.id, item.quantity]));
        const available = new Set();
        let adjusted = 0;
        this.rows.forEach(row => {
          const input = row.querySelector('[data-quantity]');
          input.value = '0';
          if (!input.disabled && selected.has(row.dataset.variant)) {
            const quantity = Math.max(selected.get(row.dataset.variant), Number(row.dataset.minimum));
            if (quantity !== selected.get(row.dataset.variant)) adjusted++;
            input.value = String(quantity);
            available.add(row.dataset.variant);
          }
        });
        this.query = '';
        this.querySelector('[data-search]').value = '';
        this.page = 0;
        this.showPage();
        this.updateTotal();
        this.status.textContent = `List loaded at current displayed prices. ${selected.size - available.size} unavailable or removed variants skipped; ${adjusted} quantities raised to current minimums. Review before adding.`;
      } catch (error) { this.status.textContent = error.message; }
      finally { this.listBusy = false; }
    }
    async deleteList() {
      if (this.busy || this.listBusy) return;
      const id = this.querySelector('[data-lists]').value;
      if (!id || !window.confirm('Delete this saved order list?')) return;
      this.listBusy = true;
      try { await this.listRequest({ intent: 'delete', id }); await this.refreshLists(); this.status.textContent = 'Saved list deleted.'; }
      catch (error) { this.status.textContent = error.message; }
      finally { this.listBusy = false; }
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
      if (this.busy || this.listBusy) return;
      const items = [];
      this.status.textContent = '';
      for (const row of this.rows) {
        const input = row.querySelector('[data-quantity]');
        if (input.disabled) continue;
        const quantity = Number(input.value);
        if (!Number.isSafeInteger(quantity) || quantity < 0 || (quantity > 0 && quantity < Number(row.dataset.minimum))) {
          this.status.textContent = `Enter a whole quantity of at least ${row.dataset.minimum}, or 0 to skip this variant.`;
          if (this.querySelector('[data-search]')) {
            this.query = '';
            this.querySelector('[data-search]').value = '';
            this.page = Math.floor(this.rows.indexOf(row) / 25);
            this.showPage();
          }
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
