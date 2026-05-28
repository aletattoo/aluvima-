/**
 * main.js — Aluvima Mérida 2.0
 * ────────────────────────────────────────────────────────────
 * Orquesta todo el sitio:
 *   • Render del catálogo con precio USD + Bs
 *   • Render de pasarelas y selector de pago
 *   • Banner de tasa de cambio
 *   • Mapa, nav móvil, filtros, animaciones, scroll-top, etc.
 *   • Botón WhatsApp flotante + links de WhatsApp en hero/contacto
 * ──────────────────────────────────────────────────────────── */

// ── Herramientas de diagnóstico (consola F12) ─────────────
window.AluvimaDebug = {
  /** Limpia la sesión del cliente actual (si hay datos viejos rompiendo el catálogo) */
  reset() {
    ['aluvima_customer_session', 'aluvima_cart_v2'].forEach(k => localStorage.removeItem(k));
    location.reload();
  },
  /** Borra TODO (clientes, pedidos, sesiones) — usar con cuidado */
  nuke() {
    if (!confirm('⚠️ Esto borra TODO: clientes, pedidos, sesiones, overrides. ¿Continuar?')) return;
    Object.keys(localStorage).filter(k => k.startsWith('aluvima_')).forEach(k => localStorage.removeItem(k));
    location.reload();
  },
  /** Muestra estado del sistema en consola */
  info() {
    const data = {};
    Object.keys(localStorage).filter(k => k.startsWith('aluvima_')).forEach(k => {
      try { data[k] = JSON.parse(localStorage.getItem(k)); }
      catch { data[k] = localStorage.getItem(k); }
    });
    console.table({
      'Productos en grid': document.querySelectorAll('#products-grid .product-card').length,
      'Productos visibles': [...document.querySelectorAll('#products-grid .product-card')].filter(c => c.style.display !== 'none').length,
      'Items en carrito': data['aluvima_cart_v2']?.items?.length || 0,
      'Cliente sesión': data['aluvima_customer_session']?.nombre || '(ninguno)',
      'Tipo cliente': data['aluvima_customer_session']?.tipo || '—',
      'WhatsApp destino': window.ALUVIMA_CONFIG?.contacto?.whatsapp,
    });
    return data;
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  Cart.init();
  Checkout.init();
  if (window.Customers) Customers.init();   // sistema de clientes (login/descuentos)
  if (window.lucide) window.lucide.createIcons();
  console.log('%c💡 Aluvima debug: AluvimaDebug.info() | .reset() | .nuke()', 'color:#8B1A2B;font-weight:bold');

  applyAluvimaConfig();

  // Expone función global para re-render al cambiar tier de cliente
  window.rerenderCatalog = () => {
    renderCatalog(getEffectiveProducts());
    // Re-aplicar filtro activo (búsqueda + categoría) tras cada re-render
    if (typeof applyCatalogFilter === 'function') {
      // Re-poblar dataset.searchText en los cards recién creados
      document.querySelectorAll('#products-grid .product-card').forEach(card => {
        const name = card.querySelector('.product-card-name')?.textContent || '';
        const desc = card.querySelector('.product-card-desc')?.textContent || '';
        card.dataset.searchText = (name + ' ' + desc + ' ' + (card.dataset.category || '') + ' ' + (card.dataset.originalName || '')).toLowerCase();
      });
      applyCatalogFilter();
    }
  };

  // Inicializar primero todo lo que no depende del catálogo — el usuario ve
  // la página interactiva mientras llega products.json en paralelo.
  initMobileNav();
  initCartPanel();
  initScrollEffects();
  initFadeInAnimations();
  initScrollTopBtn();
  initActiveNavOnScroll();
  bindWhatsAppLinks();
  hideSplash();

  // Esperar al catálogo (lazy-load desde products.json) antes de renderizarlo.
  // Si tarda, mostramos un placeholder con spinner para no dejar el área en blanco.
  showCatalogSkeleton();
  try { await window.PRODUCTS_READY; } catch (e) { /* products.js ya logueó */ }
  rerenderCatalog();
  initFilters();
});

/** Skeleton temporal mientras se descarga products.json (en 3G aporta UX, no es decorativo) */
function showCatalogSkeleton() {
  const grid = document.getElementById('products-grid');
  if (!grid || grid.children.length) return;
  grid.innerHTML = Array.from({ length: 6 }).map(() => `
    <div class="product-card product-card-skeleton" aria-hidden="true">
      <div class="product-card-image" style="background:#eef0f3"></div>
      <div class="product-card-body">
        <div style="height:14px;background:#eef0f3;border-radius:6px;margin-bottom:8px;width:80%"></div>
        <div style="height:12px;background:#eef0f3;border-radius:6px;margin-bottom:14px;width:60%"></div>
        <div style="height:34px;background:#eef0f3;border-radius:6px"></div>
      </div>
    </div>`).join('');
}

/** Oculta el splash screen cuando la app está lista */
function hideSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  // Mínimo 400ms visible para que no parpadee, máximo 2s
  const minDelay = 400;
  setTimeout(() => {
    splash.classList.add('hidden-splash');
    setTimeout(() => splash.remove(), 500);
  }, minDelay);
}

// ═══════════════════════════════════════════════════════════
// OVERRIDES DEL PANEL ADMIN (localStorage)
// ═══════════════════════════════════════════════════════════

/** Lee productos con sobreescrituras + mapeo de departamentos.
 *  Fusiona en este orden:
 *    1. PRODUCTS hardcodeados en products.js
 *    2. aluvima_imported_products (importados de Valery)
 *    3. aluvima_product_overrides (edición manual del admin)
 *    4. aluvima_dept_mapping → reasigna category por departamento
 */
function getEffectiveProducts() {
  const overrides = _lsJSON('aluvima_product_overrides', {});
  const imported  = _lsJSON('aluvima_imported_products', []);
  const deptMap   = _lsJSON('aluvima_dept_mapping', {});  // { '4.1': 'vidrio', '7.7.1': 'accesorios', ... }
  const cfgOver   = _lsJSON('aluvima_config_overrides', {});
  const base      = (typeof PRODUCTS !== 'undefined') ? PRODUCTS : (window.PRODUCTS || []);

  // ── PLAN HÍBRIDO: solo se muestran productos con displayName (nombre comercial)
  // La dueña va asignando displayName desde admin. Sin displayName = oculto.
  // Override global: aluvima_config_overrides.showAllProducts = true desactiva el filtro
  // (útil cuando se le muestra el catálogo al admin con todos los productos)
  const showAll = cfgOver.showAllProducts === true;

  const byId = {};
  base.forEach(p => { byId[String(p.id)] = { ...p }; });
  imported.forEach(p => {
    const id = String(p.id);
    byId[id] = byId[id] ? { ...byId[id], ...p } : { ...p };
  });

  return Object.values(byId)
    .map(p => {
      // Aplicar overrides
      let prod = { ...p, ...(overrides[p.id] || {}) };
      // Si el override define displayName, lo usamos como nombre visible
      if (prod.displayName && prod.displayName.trim()) {
        prod.originalName = prod.name;
        prod.name = prod.displayName.trim();
      }
      // Aplicar mapeo de departamentos si está definido
      if (prod.departamento && deptMap[prod.departamento]) {
        prod.category = deptMap[prod.departamento];
        const meta = { vidrio:'Vidrio', aluminio:'Aluminio', acero:'Acero', accesorios:'Accesorios' };
        if (meta[prod.category]) {
          prod.badge = 'badge-' + prod.category;
          prod.badgeLabel = meta[prod.category];
        }
      }
      return prod;
    })
    .filter(p => {
      if (p.active === false) return false;
      // Plan híbrido: solo productos con displayName son visibles al público
      // Salvo que sea producto demo (id empieza con 'demo-') o esté el flag global de admin
      if (showAll) return true;
      if (typeof p.id === 'string' && p.id.startsWith('demo-')) return true;
      return !!(p.displayName && p.displayName.trim());
    });
}

/** Aplica overrides de admin al objeto de configuración (muta en memoria) */
function applyAdminOverrides(cfg) {
  const payOver  = _lsJSON('aluvima_payment_overrides', {});
  const cfgOver  = _lsJSON('aluvima_config_overrides',  {});

  // Métodos de pago
  if (cfg.pasarelas && Object.keys(payOver).length) {
    cfg.pasarelas = cfg.pasarelas.map(p => ({
      ...p,
      activo: payOver[p.id] !== undefined ? payOver[p.id] : p.activo,
    }));
  }
  // Tasa de cambio
  if (cfgOver.tasaCambio?.valorPorDefecto) {
    cfg.tasaCambio = { ...cfg.tasaCambio, ...cfgOver.tasaCambio };
  }
  // Horario / datos empresa
  if (cfgOver.empresa) cfg.empresa = { ...cfg.empresa, ...cfgOver.empresa };
  // Contacto (WhatsApp)
  if (cfgOver.contacto) cfg.contacto = { ...cfg.contacto, ...cfgOver.contacto };
}

function _lsJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

// ═══════════════════════════════════════════════════════════
// CONFIG GLOBAL
// ═══════════════════════════════════════════════════════════
function applyAluvimaConfig() {
  const cfg = window.ALUVIMA_CONFIG;
  if (!cfg) { console.warn('[Aluvima] ALUVIMA_CONFIG no cargado'); return; }

  // Aplica overrides del panel admin antes de renderizar
  applyAdminOverrides(cfg);

  renderTasaBanner(cfg.tasaCambio);
  renderMap(cfg.mapa);

  const pasarelasActivas = (cfg.pasarelas || []).filter(p => p.activo !== false);
  renderPasarelas(pasarelasActivas);
  renderPaymentSelect(pasarelasActivas);

  if (window.lucide) window.lucide.createIcons();
}

// ═══════════════════════════════════════════════════════════
// BANNER DE TASA DE CAMBIO
// ═══════════════════════════════════════════════════════════
function renderTasaBanner(tasaCfg) {
  if (!tasaCfg || !tasaCfg.mostrarEnWeb) return;
  const banner = document.getElementById('tasa-banner');
  const valor  = document.getElementById('tasa-valor');
  const fecha  = document.getElementById('tasa-fecha');
  if (!banner || !valor) return;

  valor.textContent = tasaCfg.valorPorDefecto.toLocaleString('es-VE', { minimumFractionDigits: 2 });

  if (fecha && tasaCfg.fechaActualizada) {
    const f = new Date(tasaCfg.fechaActualizada + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const diffDays = Math.floor((today - f) / 86400000);
    let label;
    if (diffDays === 0)      label = '(actualizada hoy)';
    else if (diffDays === 1) label = '(actualizada ayer)';
    else                     label = `(actualizada hace ${diffDays} días)`;
    fecha.textContent = label;
  }
  banner.hidden = false;
}

// ═══════════════════════════════════════════════════════════
// CATÁLOGO
// ═══════════════════════════════════════════════════════════
function renderCatalog(products) {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!products?.length) {
    const wa = window.ALUVIMA_CONFIG?.contacto?.whatsapp || '';
    const mkWa = (texto) => wa
      ? `https://wa.me/${wa}?text=${encodeURIComponent(texto)}`
      : '#';
    // Cada proyecto se cotiza a medida — convertimos la ausencia temporal
    // de catálogo online en una propuesta de valor (atención personalizada).
    grid.innerHTML = `
      <div class="catalog-empty-state" style="grid-column:1/-1">
        <div class="ces-header">
          <span class="ces-eyebrow">
            <i data-lucide="sparkles"></i> Atención personalizada
          </span>
          <h3 class="ces-title">Cada proyecto se cotiza a medida</h3>
          <p class="ces-subtitle">
            En vidrio, aluminio y acero las medidas, espesores y acabados cambian con cada espacio.
            Cuéntanos qué necesitas y recibe tu cotización detallada en menos de 1 hora.
          </p>
        </div>

        <div class="ces-categories">
          <a href="${mkWa('Hola, quiero cotizar VIDRIO TEMPLADO. Mis medidas son: ')}" target="_blank" rel="noopener" class="ces-cat" data-cat="vidrio">
            <span class="ces-cat-dot"></span>
            <span class="ces-cat-icon"><i data-lucide="square"></i></span>
            <div class="ces-cat-text">
              <strong>Vidrio templado</strong>
              <span>Puertas, ventanas, mamparas, divisiones</span>
            </div>
            <i data-lucide="arrow-right" class="ces-cat-arrow"></i>
          </a>

          <a href="${mkWa('Hola, quiero cotizar trabajos en ALUMINIO. Necesito: ')}" target="_blank" rel="noopener" class="ces-cat" data-cat="aluminio">
            <span class="ces-cat-dot"></span>
            <span class="ces-cat-icon"><i data-lucide="layout-grid"></i></span>
            <div class="ces-cat-text">
              <strong>Aluminio</strong>
              <span>Ventanas, puertas, cerramientos, estructuras</span>
            </div>
            <i data-lucide="arrow-right" class="ces-cat-arrow"></i>
          </a>

          <a href="${mkWa('Hola, quiero cotizar trabajos en ACERO INOXIDABLE. Necesito: ')}" target="_blank" rel="noopener" class="ces-cat" data-cat="acero">
            <span class="ces-cat-dot"></span>
            <span class="ces-cat-icon"><i data-lucide="shield"></i></span>
            <div class="ces-cat-text">
              <strong>Acero inoxidable</strong>
              <span>Pasamanos, barandas, cocinas, herrajes</span>
            </div>
            <i data-lucide="arrow-right" class="ces-cat-arrow"></i>
          </a>

          <a href="${mkWa('Hola, necesito ACCESORIOS y herrajes. Específicamente: ')}" target="_blank" rel="noopener" class="ces-cat" data-cat="accesorios">
            <span class="ces-cat-dot"></span>
            <span class="ces-cat-icon"><i data-lucide="settings"></i></span>
            <div class="ces-cat-text">
              <strong>Accesorios y herrajes</strong>
              <span>Bisagras, cerraduras, perfiles, sellantes</span>
            </div>
            <i data-lucide="arrow-right" class="ces-cat-arrow"></i>
          </a>
        </div>

        <div class="ces-trustbar">
          <div class="ces-trust-item">
            <i data-lucide="zap"></i>
            <span><strong>Respuesta en &lt; 1 hora</strong>Lun a Vie · 7:30 AM – 4:00 PM</span>
          </div>
          <div class="ces-trust-item">
            <i data-lucide="award"></i>
            <span><strong>+15 años en Mérida</strong>Sector El Caucho, Av. Los Próceres</span>
          </div>
          <div class="ces-trust-item">
            <i data-lucide="ruler"></i>
            <span><strong>Medición y diseño gratis</strong>En proyectos confirmados</span>
          </div>
        </div>

        <div class="ces-cta">
          <a href="${mkWa('Hola, quiero hablar con un asesor sobre mi proyecto.')}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-lg">
            <i data-lucide="message-circle"></i> Hablar con un asesor
          </a>
          <a href="#contacto" class="btn btn-outline-dark btn-lg">
            <i data-lucide="map-pin"></i> Visitar la tienda
          </a>
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  let renderErrors = 0;
  products.forEach((product, i) => {
    try {
      grid.appendChild(createProductCard(product, i));
    } catch (err) {
      renderErrors++;
      console.error(`[Catálogo] Error renderizando producto id=${product?.id}:`, err);
    }
  });
  if (renderErrors > 0) {
    console.warn(`[Catálogo] ${renderErrors} producto(s) fallaron al renderizar. Posible causa: datos viejos de cliente. Solución: borra localStorage o cierra sesión del cliente.`);
  }
  if (window.lucide) window.lucide.createIcons();
}

/** Genera un placeholder SVG con el color de la categoría — usado cuando la foto remota falla */
function makeCardFallback(product) {
  const palette = {
    vidrio:      { bg: '#E3F2FD', accent: '#0d47a1' },
    aluminio:    { bg: '#E8F5E9', accent: '#1b5e20' },
    acero:       { bg: '#ECEFF1', accent: '#263238' },
    accesorios:  { bg: '#FFF3E0', accent: '#BF360C' },
  };
  const { bg, accent } = palette[product.category] || { bg: '#F0F2F4', accent: '#8B1A2B' };
  const label = (product.badgeLabel || 'Aluvima').toUpperCase();
  // Iniciales del producto (máx 2 letras) para el centro
  const initials = (product.name || 'A')
    .split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
    <rect width="600" height="600" fill="${bg}"/>
    <circle cx="300" cy="260" r="110" fill="${accent}" opacity="0.12"/>
    <text x="300" y="295" font-family="Montserrat, sans-serif" font-size="100" font-weight="900"
          fill="${accent}" text-anchor="middle" dominant-baseline="middle">${initials}</text>
    <text x="300" y="430" font-family="Montserrat, sans-serif" font-size="32" font-weight="700"
          fill="${accent}" text-anchor="middle" letter-spacing="3">${label}</text>
    <text x="300" y="490" font-family="Open Sans, sans-serif" font-size="22"
          fill="${accent}" opacity="0.6" text-anchor="middle">Aluvima Mérida</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function createProductCard(product, index) {
  const card = document.createElement('article');
  card.className = 'product-card fade-in-up';
  card.dataset.category = product.category;
  // Permitir búsqueda por nombre comercial Y nombre técnico original
  if (product.originalName && product.originalName !== product.name) {
    card.dataset.originalName = product.originalName;
  }
  card.style.animationDelay = `${index * 60}ms`;

  const imgSrc = product.image || makeCardFallback(product);
  const tasaCfg = window.ALUVIMA_CONFIG?.tasaCambio;
  const tasa = tasaCfg?.valorPorDefecto;
  const showBs = tasaCfg?.mostrarEnProductos && tasa;

  // ── PRECIO SEGÚN TIER DEL CLIENTE ──
  // product.price = precio BASE (cristalero). Aplicamos multiplicador del tier.
  const basePrice = Number(product.price) || 0;
  let tipoActivo   = 'publico';
  let tipoLabel    = 'Público';
  let tierPrice    = basePrice;
  let publicoPrice = basePrice;

  // Aplicar tier de forma defensiva — si Customers falla, no quebrar la card
  try {
    if (window.Customers?.currentTipo) {
      tipoActivo   = Customers.currentTipo() || 'publico';
      tipoLabel    = Customers.getTipos()?.[tipoActivo]?.label || 'Público';
      // Si el producto trae precios exactos (Valery), usarlos. Sino, multiplicador
      tierPrice    = Customers.priceForProduct ? Customers.priceForProduct(product) : Customers.applyTierPrice(basePrice);
      publicoPrice = product.prices?.publico ?? Customers.priceFor(basePrice, 'publico');
    } else {
      publicoPrice = product.prices?.publico ?? +(basePrice * 1.45).toFixed(2);
      tierPrice    = publicoPrice;
    }
  } catch (e) {
    console.warn('[createProductCard] tier fallback para', product.name, e);
    publicoPrice = +(basePrice * 1.45).toFixed(2);
    tierPrice    = publicoPrice;
  }

  const ahorroVsPub = +(publicoPrice - tierPrice).toFixed(2);

  const priceBs = showBs
    ? 'Bs. ' + (tierPrice * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';

  // Si el cliente NO es público, mostramos su precio + precio público tachado para evidenciar ahorro
  const showPublicoStrike = tipoActivo !== 'publico' && ahorroVsPub > 0;

  const fallback = makeCardFallback(product);
  card.innerHTML = `
    <div class="product-card-image">
      <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(product.name)}" loading="lazy"
        onerror="this.onerror=null;this.src='${fallback}';this.classList.add('is-fallback');" />
      <span class="product-badge ${escapeHtml(product.badge)}">${escapeHtml(product.badgeLabel)}</span>
      ${product.featured ? '<span class="product-badge product-badge-featured">⭐ Destacado</span>' : ''}
    </div>
    <div class="product-card-body">
      <h3 class="product-card-name">${escapeHtml(product.name)}</h3>
      <p class="product-card-desc">${escapeHtml(product.description)}</p>
      <div class="product-card-footer">
        <div class="product-price">
          <span class="product-price-label">Precio${tipoActivo !== 'publico' ? ` ${tipoLabel}` : ''}</span>
          <span class="product-price-value">$${tierPrice.toFixed(2)}</span>
          ${showBs ? `<span class="product-price-bs">${priceBs}</span>` : ''}
          <span class="product-price-unit">por ${escapeHtml(product.unit)}</span>
        </div>
        <button class="add-to-cart-btn" data-product-id="${product.id}"
          aria-label="Agregar ${escapeHtml(product.name)} al carrito">
          <i data-lucide="plus"></i> Agregar
        </button>
      </div>
    </div>
  `;

  card.querySelector('.add-to-cart-btn').addEventListener('click', () => {
    // Pasamos basePrice al Cart para que recalcule según el tier
    Cart.addItem({ ...product, basePrice: basePrice, price: tierPrice });
    // En lugar de abrir el panel, mostramos toast con acción rápida (estilo app)
    showCartToast(product.name);
  });

  return card;
}

// ═══════════════════════════════════════════════════════════
// NAV MÓVIL
// ═══════════════════════════════════════════════════════════
function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');
  if (!toggle || !links) return;

  // Overlay oscuro que se inyecta detrás del menú
  let overlay = document.getElementById('nav-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'nav-overlay';
    overlay.className = 'nav-overlay';
    document.body.appendChild(overlay);
  }

  const setOpen = (open) => {
    links.classList.toggle('open', open);
    overlay.classList.toggle('visible', open);
    toggle.setAttribute('aria-expanded', open);
    toggle.querySelector('i')?.setAttribute('data-lucide', open ? 'x' : 'menu');
    document.body.style.overflow = open ? 'hidden' : ''; // scroll-lock
    if (window.lucide) window.lucide.createIcons();
  };

  toggle.addEventListener('click', () => setOpen(!links.classList.contains('open')));
  overlay.addEventListener('click', () => setOpen(false));

  // Cerrar al tocar un link
  links.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => setOpen(false));
  });

  // Cerrar con Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && links.classList.contains('open')) setOpen(false);
  });

  // Cerrar automáticamente si el usuario hace scroll significativo
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!links.classList.contains('open')) { lastY = window.scrollY; return; }
    if (Math.abs(window.scrollY - lastY) > 30) setOpen(false);
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════
// PANEL DEL CARRITO
// ═══════════════════════════════════════════════════════════
function initCartPanel() {
  document.getElementById('cart-btn')?.addEventListener('click', openCartPanel);
  document.getElementById('cart-close-btn')?.addEventListener('click', closeCartPanel);
  document.getElementById('cart-overlay')?.addEventListener('click', closeCartPanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCartPanel(); });
}

function openCartPanel() {
  document.getElementById('cart-panel')?.classList.add('open');
  document.getElementById('cart-overlay')?.classList.add('visible');
  document.getElementById('cart-panel')?.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeCartPanel() {
  document.getElementById('cart-panel')?.classList.remove('open');
  document.getElementById('cart-overlay')?.classList.remove('visible');
  document.getElementById('cart-panel')?.setAttribute('aria-hidden', 'true');
  // Solo restablecer overflow si el modal de checkout no está abierto
  const modal = document.getElementById('checkout-modal');
  if (!modal || modal.hidden) document.body.style.overflow = '';
}

window.openCartPanel  = openCartPanel;
window.closeCartPanel = closeCartPanel;

// ═══════════════════════════════════════════════════════════
// FILTROS
// ═══════════════════════════════════════════════════════════
/**
 * Estado del filtro (categoría + texto de búsqueda).
 * Se aplica de forma combinada — un producto solo se muestra si
 * coincide con AMBOS criterios.
 */
const _catalogFilter = { category: 'all', query: '' };

function applyCatalogFilter() {
  const grid       = document.getElementById('products-grid');
  const emptyState = document.getElementById('catalog-empty');
  const resultsEl  = document.getElementById('catalog-results');
  if (!grid) return;

  const q = _catalogFilter.query.trim().toLowerCase();
  const c = _catalogFilter.category;
  let visibleCount = 0;
  let totalCount   = 0;

  grid.querySelectorAll('.product-card').forEach(card => {
    totalCount++;
    const matchCat = c === 'all' || card.dataset.category === c;
    const text = (card.dataset.searchText || card.textContent).toLowerCase();
    const matchTxt = !q || text.includes(q);
    const show = matchCat && matchTxt;
    card.style.display = show ? '' : 'none';
    card.classList.toggle('hidden-by-filter', !show);
    if (show) visibleCount++;
  });

  // Estado vacío
  if (emptyState) emptyState.hidden = visibleCount !== 0;

  // Contador de resultados (solo si hay búsqueda activa)
  if (resultsEl) {
    if (q || c !== 'all') {
      resultsEl.hidden = false;
      resultsEl.innerHTML = `<strong>${visibleCount}</strong> de ${totalCount} productos${q ? ` para "<em>${escapeHtml(q)}</em>"` : ''}`;
    } else {
      resultsEl.hidden = true;
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

/** Resetea el buscador único del nav */
window.resetCatalogSearch = function() {
  const inp = document.getElementById('nav-search-input');
  if (inp) inp.value = '';
  _catalogFilter.query = '';
  applyCatalogFilter();
};

/** Abre el buscador del nav (expande input desde la lupita) */
window.toggleNavSearch = function() {
  const wrap = document.getElementById('nav-search-wrap');
  const inp  = document.getElementById('nav-search-input');
  const closeBtn = wrap?.querySelector('.nav-search-close');
  if (!wrap || !inp) return;

  const expanded = wrap.classList.toggle('expanded');
  if (closeBtn) closeBtn.hidden = !expanded;

  if (expanded) {
    setTimeout(() => inp.focus(), 100);
    // Scroll al catálogo si no está visible
    const rect = document.getElementById('catalogo')?.getBoundingClientRect();
    if (rect && rect.top > window.innerHeight) {
      document.getElementById('catalogo')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  } else {
    inp.value = '';
    _catalogFilter.query = '';
    applyCatalogFilter();
  }
};

/** Cierra el buscador y limpia la búsqueda */
window.closeNavSearch = function() {
  const wrap = document.getElementById('nav-search-wrap');
  const inp  = document.getElementById('nav-search-input');
  const closeBtn = wrap?.querySelector('.nav-search-close');
  if (wrap)     wrap.classList.remove('expanded');
  if (closeBtn) closeBtn.hidden = true;
  if (inp)      inp.value = '';
  _catalogFilter.query = '';
  applyCatalogFilter();
};

function initFilters() {
  const btns    = document.querySelectorAll('.filter-btn');
  const navInp  = document.getElementById('nav-search-input');
  const grid    = document.getElementById('products-grid');
  if (!grid) return;

  // Pre-cargar texto de búsqueda en cada card
  grid.querySelectorAll('.product-card').forEach(card => {
    const name = card.querySelector('.product-card-name')?.textContent || '';
    const desc = card.querySelector('.product-card-desc')?.textContent || '';
    card.dataset.searchText = (name + ' ' + desc + ' ' + (card.dataset.category || '')).toLowerCase();
  });

  // Filtros por categoría
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _catalogFilter.category = btn.dataset.filter;
      applyCatalogFilter();
    });
  });

  // Atajos del Hero → aplican el filtro y hacen scroll al catálogo
  document.querySelectorAll('.hero-shortcuts .shortcut').forEach(el => {
    el.addEventListener('click', e => {
      const cat = el.dataset.filter;
      if (!cat) return;
      // Activa el botón de filtro correspondiente
      btns.forEach(b => b.classList.toggle('active', b.dataset.filter === cat));
      _catalogFilter.category = cat;
      applyCatalogFilter();
    });
  });

  // ── Buscador ÚNICO del nav (lupita expandible) ──
  if (navInp) {
    let debounceTimer = null;
    navInp.addEventListener('input', e => {
      const v = e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        _catalogFilter.query = v;
        applyCatalogFilter();
      }, 150);
    });
    navInp.addEventListener('keydown', e => {
      if (e.key === 'Escape') window.closeNavSearch();
    });
  }
}

// ═══════════════════════════════════════════════════════════
// SCROLL EFFECTS
// ═══════════════════════════════════════════════════════════
function initScrollEffects() {
  const header = document.getElementById('site-header');
  window.addEventListener('scroll', () => {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

function initFadeInAnimations() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.fade-in-up').forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.fade-in-up, .about-card, .contact-item').forEach(el => {
    el.classList.add('fade-in-up');
    io.observe(el);
  });
}

function initScrollTopBtn() {
  const btn = document.createElement('button');
  btn.className = 'scroll-top-btn';
  btn.setAttribute('aria-label', 'Volver al inicio');
  btn.innerHTML = '<i data-lucide="chevron-up"></i>';
  document.body.appendChild(btn);
  if (window.lucide) window.lucide.createIcons();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
}

function initActiveNavOnScroll() {
  const sections = document.querySelectorAll('section[id]');
  const links    = document.querySelectorAll('.nav-link');
  if (!sections.length || !links.length) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => {
          l.classList.toggle('active', l.getAttribute('href') === `#${e.target.id}`);
        });
      }
    });
  }, { threshold: 0.4 });
  sections.forEach(s => io.observe(s));
}

// ═══════════════════════════════════════════════════════════
// WHATSAPP: enlaces y botón flotante
// ═══════════════════════════════════════════════════════════
function getWhatsAppURL(text = '') {
  const num = window.ALUVIMA_CONFIG?.contacto?.whatsapp || '584247247358';
  const empresa = window.ALUVIMA_CONFIG?.empresa?.nombre || 'Aluvima Mérida';
  const defaultText = `Hola ${empresa}, vengo desde la web y me gustaría más información.`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text || defaultText)}`;
}

function bindWhatsAppLinks() {
  const hero    = document.getElementById('hero-whatsapp-link');
  const contact = document.getElementById('contact-whatsapp-link');
  const url = getWhatsAppURL();
  if (hero)    hero.href    = url;
  if (contact) contact.href = url;
}

// ═══════════════════════════════════════════════════════════
// MAPA
// ═══════════════════════════════════════════════════════════
function renderMap(mapa) {
  if (!mapa?.consulta) return;
  const iframe = document.getElementById('aluvima-map');
  const link   = document.getElementById('aluvima-map-link');
  const q = encodeURIComponent(mapa.consulta);
  const z = mapa.zoom || 16;
  if (iframe) iframe.src = `https://www.google.com/maps?q=${q}&z=${z}&output=embed`;
  if (link)   link.href  = `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ═══════════════════════════════════════════════════════════
// PASARELAS DE PAGO
// ═══════════════════════════════════════════════════════════
const PAYMENT_LOGOS = {
  'pago-movil': `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="pm-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0066B3"/><stop offset="100%" stop-color="#003E70"/></linearGradient></defs>
      <rect width="64" height="64" rx="14" fill="url(#pm-grad)"/>
      <rect x="20" y="12" width="24" height="40" rx="4" fill="#fff"/>
      <rect x="22" y="16" width="20" height="26" fill="#0066B3" opacity=".15"/>
      <circle cx="32" cy="47" r="2" fill="#0066B3"/>
      <path d="M28 24 L32 28 L40 20" stroke="#0066B3" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  'zelle': `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#6D1ED4"/>
      <path d="M22 18 H42 L26 46 H42" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="32" y1="12" x2="32" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <line x1="32" y1="46" x2="32" y2="52" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    </svg>`,
  'binance': `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0B0E11"/>
      <g fill="#F0B90B">
        <path d="M32 16 L36 20 L32 24 L28 20 Z"/>
        <path d="M20 28 L24 32 L20 36 L16 32 Z"/>
        <path d="M44 28 L48 32 L44 36 L40 32 Z"/>
        <path d="M32 40 L36 44 L32 48 L28 44 Z"/>
        <path d="M32 24 L40 32 L32 40 L24 32 Z"/>
      </g>
    </svg>`,
  'transferencia': `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#1E3A8A"/>
      <path d="M16 28 L32 16 L48 28 Z" fill="#fff"/>
      <rect x="18" y="30" width="4" height="14" fill="#fff"/>
      <rect x="26" y="30" width="4" height="14" fill="#fff"/>
      <rect x="34" y="30" width="4" height="14" fill="#fff"/>
      <rect x="42" y="30" width="4" height="14" fill="#fff"/>
      <rect x="14" y="46" width="36" height="4" fill="#fff"/>
    </svg>`,
  'efectivo-usd': `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#198754"/>
      <rect x="10" y="20" width="44" height="24" rx="3" fill="#fff"/>
      <circle cx="32" cy="32" r="7" fill="none" stroke="#198754" stroke-width="2"/>
      <text x="32" y="36" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="11" fill="#198754">$</text>
    </svg>`,
  'cashea': `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#FF6B00"/>
      <rect x="12" y="22" width="40" height="22" rx="3" fill="#fff"/>
      <rect x="12" y="26" width="40" height="4" fill="#FF6B00"/>
      <rect x="16" y="34" width="14" height="3" fill="#FF6B00"/>
    </svg>`,
};

function renderPasarelas(pasarelas) {
  const grid = document.getElementById('payments-grid');
  if (!grid || !pasarelas?.length) return;

  grid.innerHTML = pasarelas.map(p => {
    const datos = p.datos.map(d => `
      <li class="payment-data-row">
        <span class="payment-data-label">${escapeHtml(d.campo)}</span>
        <span class="payment-data-value" data-copy="${escapeHtml(d.valor)}">
          <span class="payment-data-text">${escapeHtml(d.valor)}</span>
          <button class="payment-copy-btn" type="button" aria-label="Copiar ${escapeHtml(d.campo)}" title="Copiar">
            <i data-lucide="copy"></i>
          </button>
        </span>
      </li>
    `).join('');

    const badge = p.etiqueta ? `<span class="payment-badge">${escapeHtml(p.etiqueta)}</span>` : '';
    const logo = PAYMENT_LOGOS[p.id] || `<div class="payment-logo-fallback" style="background:${p.color}"><i data-lucide="${escapeHtml(p.icono)}"></i></div>`;

    return `
      <article class="payment-card ${p.destacado ? 'is-featured' : ''}" data-id="${escapeHtml(p.id)}" style="--accent:${p.color};">
        <div class="payment-card-glow"></div>
        <header class="payment-card-header">
          <div class="payment-logo">${logo}</div>
          <div class="payment-title-block">
            <h3 class="payment-name">${escapeHtml(p.nombre)}</h3>
            <span class="payment-currency-pill">${escapeHtml(p.moneda)}</span>
          </div>
          ${badge}
        </header>
        <ul class="payment-data-list">${datos}</ul>
        ${p.nota ? `<p class="payment-note"><i data-lucide="info"></i><span>${escapeHtml(p.nota)}</span></p>` : ''}
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.payment-copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const valueEl = btn.closest('.payment-data-value');
      const text = valueEl?.dataset.copy || '';
      if (!text) return;
      navigator.clipboard.writeText(text)
        .then(() => {
          showToast(`✅ Copiado: ${text}`, 'success', 2200);
          btn.classList.add('is-copied');
          setTimeout(() => btn.classList.remove('is-copied'), 1500);
        })
        .catch(() => showToast('No se pudo copiar.', 'error'));
    });
  });
}

function renderPaymentSelect(pasarelas) {
  const select = document.getElementById('cart-payment-method');
  if (!select || !pasarelas?.length) return;
  select.innerHTML = pasarelas.map(p =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} (${escapeHtml(p.moneda)})</option>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════
// TOAST & UTILS
// ═══════════════════════════════════════════════════════════
function showToast(message, type = 'info', duration = 3000) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, duration);
}

/** Toast específico al agregar al carrito — incluye botón "Ver" */
function showCartToast(productName) {
  document.querySelector('.toast-cart')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast toast-cart';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const safeName = productName.length > 38 ? productName.slice(0, 36) + '…' : productName;
  toast.innerHTML = `
    <div class="toast-cart-body">
      <div class="toast-cart-check"><i data-lucide="check-circle-2"></i></div>
      <div class="toast-cart-text">
        <strong>Agregado al carrito</strong>
        <span>${escapeHtml(safeName)}</span>
      </div>
      <button type="button" class="toast-cart-action">Ver</button>
    </div>
  `;
  document.body.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  toast.querySelector('.toast-cart-action').addEventListener('click', () => {
    toast.remove();
    openCartPanel();
  });
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3500);
}

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}
