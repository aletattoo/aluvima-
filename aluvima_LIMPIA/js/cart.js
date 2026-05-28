/**
 * cart.js — Aluvima Mérida 2.0
 * ────────────────────────────────────────────────────────────
 * Lógica del carrito con:
 *  • Persistencia LocalStorage (con expiración de 7 días)
 *  • Detección de carrito abandonado (banner de recuperación)
 *  • Cálculo automático USD ↔ Bs según ALUVIMA_CONFIG.tasaCambio
 *  • Renderizado del panel lateral y contador del header
 * ──────────────────────────────────────────────────────────── */

const Cart = (() => {
  const STORAGE_KEY    = 'aluvima_cart_v2';
  const RECOVERY_KEY   = 'aluvima_cart_recovery_shown';
  const EXPIRY_DAYS    = 7;

  let items = [];
  let savedAt = null;

  // ── Helpers tasa ──────────────────────────────────────────
  function getTasa() {
    return window.ALUVIMA_CONFIG?.tasaCambio?.valorPorDefecto || null;
  }

  function formatUSD(amount) {
    return `$${amount.toFixed(2)}`;
  }

  function formatBs(amount) {
    const tasa = getTasa();
    if (!tasa) return '';
    const bs = amount * tasa;
    return 'Bs. ' + bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Persistencia con expiración ───────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { items = []; return; }
      const data = JSON.parse(raw);
      // expiración
      if (data.expiraEn && new Date(data.expiraEn) < new Date()) {
        localStorage.removeItem(STORAGE_KEY);
        items = [];
        return;
      }
      items = Array.isArray(data.items) ? data.items : [];
      savedAt = data.guardadoEn || null;
    } catch (e) {
      console.warn('[Cart] load error:', e);
      items = [];
    }
  }

  function save() {
    try {
      const expira = new Date();
      expira.setDate(expira.getDate() + EXPIRY_DAYS);
      const payload = {
        items,
        guardadoEn: new Date().toISOString(),
        expiraEn:   expira.toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      savedAt = payload.guardadoEn;
    } catch (e) {
      console.warn('[Cart] save error:', e);
    }
  }

  // ── CRUD ──────────────────────────────────────────────────
  /** Devuelve el precio efectivo del producto SEGÚN el tier del cliente actual */
  function effectivePrice(product) {
    const base = product.basePrice ?? product.price; // siempre guardamos base
    if (window.Customers?.applyTierPrice) return Customers.applyTierPrice(base);
    return base;
  }

  function addItem(product, qty = 1) {
    const existing = items.find(i => i.id === product.id);
    if (existing) {
      existing.qty += qty;
    } else {
      const basePrice = product.basePrice ?? product.price;
      items.push({
        id:        product.id,
        name:      product.name,
        basePrice: basePrice,                   // ← precio cristalero/costo (NUNCA cambia)
        price:     effectivePrice(product),     // precio con tier del cliente actual (puede cambiar)
        unit:      product.unit,
        qty,
      });
    }
    save();
    render();
    updateCounter();
    animateCartBtn();
    if (typeof showToast === 'function') {
      showToast(`✅ "${product.name}" agregado al pedido`, 'success');
    }
  }

  /** Recalcula todos los precios del carrito según el tier actual del cliente */
  function recalculateTierPrices() {
    items.forEach(it => {
      const base = it.basePrice ?? it.price;
      it.basePrice = base;
      it.price = window.Customers?.applyTierPrice ? Customers.applyTierPrice(base) : base;
    });
    save();
  }

  function updateQty(id, qty) {
    if (qty <= 0) return removeItem(id);
    const item = items.find(i => i.id === id);
    if (item) {
      item.qty = qty;
      save();
      render();
      updateCounter();
    }
  }

  function removeItem(id) {
    items = items.filter(i => i.id !== id);
    save();
    render();
    updateCounter();
  }

  function clear() {
    items = [];
    save();
    render();
    updateCounter();
  }

  // ── Cálculos ──────────────────────────────────────────────
  const getSubtotal = () => items.reduce((a, i) => a + i.price * i.qty, 0);
  const getTotal    = () => getSubtotal();
  const getTotalQty = () => items.reduce((a, i) => a + i.qty, 0);
  const getItems    = () => [...items];

  // ── Render ────────────────────────────────────────────────
  function updateCounter() {
    const counter = document.getElementById('cart-count');
    if (!counter) return;
    counter.textContent = getTotalQty();
    counter.classList.remove('bump');
    void counter.offsetWidth;
    counter.classList.add('bump');
    setTimeout(() => counter.classList.remove('bump'), 300);
  }

  function animateCartBtn() {
    const btn = document.getElementById('cart-btn');
    if (!btn) return;
    btn.style.transform = 'scale(1.2)';
    setTimeout(() => { btn.style.transform = ''; }, 200);
  }

  function render() {
    // SIEMPRE recalcular precios al render — refleja cambios de tier (login/logout)
    if (items.length) recalculateTierPrices();

    const container = document.getElementById('cart-items-container');
    const emptyMsg  = document.getElementById('cart-empty');
    const footer    = document.getElementById('cart-footer');
    const subEl     = document.getElementById('cart-subtotal');
    const totEl     = document.getElementById('cart-total');
    const totBsEl   = document.getElementById('cart-total-bs');

    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = '';
      const empty = emptyMsg || createEmptyState();
      empty.style.display = 'flex';
      container.appendChild(empty);
      if (footer) footer.style.display = 'none';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (footer)   footer.style.display   = 'block';

    container.innerHTML = '';
    items.forEach(item => container.appendChild(createCartItemElement(item)));

    // ── Precios según el TIER del cliente (4 modelos) ──
    // El "items[].price" guardado en el carrito es el precio que vio cuando agregó
    // (ya ajustado al tier en ese momento). Recalculamos aquí por si cambió tipo.
    const tipoActivo = window.Customers ? Customers.currentTipo() : 'publico';
    const tipoLbl    = window.Customers?.getTipos()[tipoActivo]?.label || 'Público';

    const subtotal = getSubtotal();
    const finalTot = subtotal; // ya incluye el tier aplicado

    if (subEl) subEl.textContent = formatUSD(subtotal);
    if (totEl) totEl.textContent = formatUSD(finalTot);

    // Indicador del tier activo (siempre visible)
    let tierRow = document.getElementById('cart-tier-row');
    if (tipoActivo !== 'publico') {
      // Calcular ahorro vs precio público
      const ahorro = items.reduce((sum, it) => {
        const base = it.basePrice || it.price; // legado
        const pub  = window.Customers.priceFor(base, 'publico');
        const tuyo = window.Customers.priceFor(base, tipoActivo);
        return sum + (pub - tuyo) * it.qty;
      }, 0);

      if (!tierRow) {
        tierRow = document.createElement('div');
        tierRow.id = 'cart-tier-row';
        tierRow.className = 'cart-discount-row';
        subEl?.closest('.cart-summary-row')?.parentElement?.insertBefore(tierRow, totEl?.closest('.cart-summary-row') || null);
      }
      tierRow.innerHTML = `
        <span>🏷️ Precios <strong>${tipoLbl}</strong></span>
        ${ahorro > 0 ? `<span class="cart-discount-amount">Ahorras ${formatUSD(ahorro)}</span>` : '<span></span>'}`;
      tierRow.style.display = '';
    } else if (tierRow) {
      tierRow.style.display = 'none';
    }

    // Bolívares (solo si la tasa está activa y el config lo permite)
    if (totBsEl) {
      const showBs = window.ALUVIMA_CONFIG?.tasaCambio?.mostrarEnCarrito && getTasa();
      if (showBs) {
        totBsEl.textContent = formatBs(finalTot);
        totBsEl.parentElement.style.display = '';
      } else {
        totBsEl.parentElement.style.display = 'none';
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function createCartItemElement(item) {
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.dataset.id = item.id;

    const subtotalBs = window.ALUVIMA_CONFIG?.tasaCambio?.mostrarEnCarrito && getTasa()
      ? `<span class="cart-item-subtotal-bs">${formatBs(item.price * item.qty)}</span>`
      : '';

    div.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="cart-item-unit-price">${formatUSD(item.price)} / ${escapeHtml(item.unit)}</div>
        <div class="cart-item-controls">
          <button class="qty-btn qty-minus" data-id="${item.id}" aria-label="Reducir">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn qty-plus" data-id="${item.id}" aria-label="Aumentar">+</button>
        </div>
      </div>
      <div class="cart-item-end">
        <button class="cart-item-remove" data-id="${item.id}" aria-label="Eliminar"><i data-lucide="trash-2"></i></button>
        <span class="cart-item-subtotal">${formatUSD(item.price * item.qty)}</span>
        ${subtotalBs}
      </div>
    `;

    div.querySelector('.qty-minus').addEventListener('click', () => updateQty(item.id, item.qty - 1));
    div.querySelector('.qty-plus').addEventListener('click',  () => updateQty(item.id, item.qty + 1));
    div.querySelector('.cart-item-remove').addEventListener('click', () => removeItem(item.id));

    return div;
  }

  function createEmptyState() {
    const div = document.createElement('div');
    div.id = 'cart-empty';
    div.className = 'cart-empty';
    div.innerHTML = `
      <i data-lucide="package-open"></i>
      <p>Tu carrito está vacío.</p>
      <a href="#catalogo" class="btn btn-outline-dark btn-sm">Ver Catálogo</a>
    `;
    return div;
  }

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  }

  // ── Banner de recuperación ────────────────────────────────
  /**
   * Muestra el banner si hay items guardados de una sesión previa.
   * Solo se muestra una vez por sesión del navegador.
   */
  function maybeShowRecoveryBanner() {
    if (!items.length) return;
    const alreadyShown = sessionStorage.getItem(RECOVERY_KEY);
    if (alreadyShown) return;

    const banner = document.getElementById('cart-recovery-banner');
    if (!banner) return;

    const countEl = document.getElementById('cart-recovery-count');
    if (countEl) countEl.textContent = getTotalQty();
    banner.hidden = false;

    const openBtn  = document.getElementById('cart-recovery-open');
    const clearBtn = document.getElementById('cart-recovery-clear');

    const close = () => {
      banner.hidden = true;
      sessionStorage.setItem(RECOVERY_KEY, '1');
    };

    if (openBtn)  openBtn.onclick  = () => { close(); window.openCartPanel?.(); };
    if (clearBtn) clearBtn.onclick = () => { clear(); close(); };

    // Auto-cerrar a los 12s
    setTimeout(() => { if (!banner.hidden) close(); }, 12000);
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    load();
    render();
    updateCounter();
    setTimeout(maybeShowRecoveryBanner, 800);
  }

  return {
    init, addItem, updateQty, removeItem, clear,
    getItems, getSubtotal, getTotal, getTotalQty,
    formatUSD, formatBs,
    effectivePrice,
    refresh: render,  // permite a customers.js refrescar el carrito al login/logout
  };
})();

// Expone Cart al window (para Customers.refreshUI lo encuentre)
window.Cart = Cart;
