/**
 * admin.js — Panel de Administración Aluvima 2.0
 * ────────────────────────────────────────────────────────────
 * Roles:
 *   admin       → acceso total (tú, el desarrollador)
 *   propietario → acceso operativo (el cliente)
 *
 * Datos en localStorage:
 *   aluvima_admin_users         → usuarios y contraseñas (hashed)
 *   aluvima_admin_session       → sesión activa
 *   aluvima_product_overrides   → precios y estado de productos
 *   aluvima_payment_overrides   → métodos de pago activos/inactivos
 *   aluvima_config_overrides    → tasa, horario, WhatsApp
 *   aluvima_orders              → historial de pedidos
 *   aluvima_clients             → clientes frecuentes
 * ──────────────────────────────────────────────────────────── */

/* ════════════════════════════════════════════════════════════
   1. CLAVES Y PERMISOS
════════════════════════════════════════════════════════════ */
const KEYS = {
  users:           'aluvima_admin_users',
  session:         'aluvima_admin_session',
  productOverrides:'aluvima_product_overrides',
  paymentOverrides:'aluvima_payment_overrides',
  configOverrides: 'aluvima_config_overrides',
  orders:          'aluvima_orders',
  clients:         'aluvima_clients',
  lastBackup:      'aluvima_last_backup_at',
};

// Claves de localStorage que se incluyen en el backup completo
const BACKUP_KEYS = [
  'aluvima_admin_users',
  'aluvima_orders',
  'aluvima_customers',          // clientes registrados (sistema customers.js)
  'aluvima_vendedoras',         // equipo de vendedoras
  'aluvima_product_overrides',
  'aluvima_payment_overrides',
  'aluvima_config_overrides',
  'aluvima_tipos_cliente',
  'aluvima_pedido_counter',
  'aluvima_clients',            // legacy, por si hay datos viejos
];

const BACKUP_VERSION = '1.0';

const SALT = 'aluvima-admin-salt-2026';

// Permisos: admin tiene todo; propietario tiene operaciones del día a día
const PERMISSIONS = {
  admin:       ['*'],
  propietario: ['products','payments','orders','clients','config.tasa','config.horario','config.whatsapp'],
};

/* ════════════════════════════════════════════════════════════
   2. UTILIDADES
════════════════════════════════════════════════════════════ */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function lsGet(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function can(perm) {
  const s = lsGet(KEYS.session);
  if (!s) return false;
  const perms = PERMISSIONS[s.role] || [];
  return perms.includes('*') || perms.includes(perm) || perms.some(p => perm.startsWith(p));
}
function isAdmin() { return lsGet(KEYS.session)?.role === 'admin'; }

function adminToast(msg, type = 'ok', ms = 2800) {
  const icons  = { ok: '✅', success: '✅', err: '❌', error: '❌', info: 'ℹ️', warn: '⚠️', warning: '⚠️' };
  const colors = { ok: '#276749', success: '#276749', err: '#c53030', error: '#c53030', info: '#2b6cb0', warn: '#b7791f', warning: '#b7791f' };
  const wrap = document.getElementById('admin-toast');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'adm-toast';
  el.style.background = colors[type] || colors.ok;
  el.textContent = (icons[type] || '') + ' ' + msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, ms);
}

/** Escape para HTML inline (texto) */
function escapeHtmlAdm(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
}
/** Escape para atributos HTML */
function escapeAttr(str) { return escapeHtmlAdm(str); }

function fmt(val) { return parseFloat(val || 0).toFixed(2); }
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-VE', {
      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit',
    });
  } catch { return iso; }
}

/* ════════════════════════════════════════════════════════════
   3. AUTENTICACIÓN
════════════════════════════════════════════════════════════ */
const Auth = {
  /** Devuelve true si NO hay ningún usuario creado (primera visita). */
  needsSetup() {
    const u = lsGet(KEYS.users);
    return !u || Object.keys(u).length === 0;
  },

  /** Crea el primer usuario admin desde la pantalla de setup.
   *  Ya NO existe el bootstrap con contraseñas hardcodeadas en el código:
   *  era un riesgo serio porque admin.js es un archivo público.
   *  El propietario se crea más tarde desde "Gestión de Usuarios". */
  async firstSetup({ username, password, nombre }) {
    if (!this.needsSetup()) throw new Error('Ya hay usuarios creados.');
    if (!username || username.trim().length < 3) throw new Error('Usuario muy corto.');
    if (!password || password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    const uname = username.trim().toLowerCase();
    const hash  = await sha256(password + SALT);
    lsSet(KEYS.users, {
      [uname]: { hash, role: 'admin', nombre: nombre || 'Administrador' },
    });
    lsSet(KEYS.session, {
      username: uname,
      nombre:   nombre || 'Administrador',
      role:     'admin',
      at:       Date.now(),
    });
    return true;
  },

  async login(username, password) {
    const users = lsGet(KEYS.users, {});
    const u = users[username.trim().toLowerCase()];
    if (!u) return false;
    const hash = await sha256(password + SALT);
    if (hash !== u.hash) return false;
    lsSet(KEYS.session, {
      username: username.trim().toLowerCase(),
      nombre: u.nombre,
      role: u.role,
      at: Date.now(),
    });
    return true;
  },

  logout() {
    localStorage.removeItem(KEYS.session);
    location.reload();
  },

  check() {
    const s = lsGet(KEYS.session);
    if (!s) return false;
    if (Date.now() - s.at > 10 * 3600 * 1000) {
      localStorage.removeItem(KEYS.session);
      return false;
    }
    return true;
  },
};

/* ════════════════════════════════════════════════════════════
   4. PANEL PRINCIPAL
════════════════════════════════════════════════════════════ */
const Panel = {
  _pwTarget: null,

  /* ── Bootstrap ──
     Lógica de arranque:
       1. Si hay sesión válida          → panel directo.
       2. Si NO hay usuarios creados    → pantalla de setup (crea el primer admin).
       3. Si hay usuarios, sin sesión   → pantalla de login normal. */
  async init() {
    if (Auth.check()) {
      this.showPanel();
    } else if (Auth.needsSetup()) {
      this.showSetup();
    } else {
      this.showLogin();
    }

    /* Login form */
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const ok = await Auth.login(
        document.getElementById('inp-user').value,
        document.getElementById('inp-pass').value,
      );
      if (ok) {
        this.showPanel();
      } else {
        const err = document.getElementById('login-err');
        err.textContent = 'Usuario o contraseña incorrectos.';
        setTimeout(() => err.textContent = '', 3500);
      }
    });

    /* Setup form (primera vez) */
    const setupForm = document.getElementById('setup-form');
    if (setupForm) {
      setupForm.addEventListener('submit', async e => {
        e.preventDefault();
        const u   = document.getElementById('setup-user').value;
        const p1  = document.getElementById('setup-pass').value;
        const p2  = document.getElementById('setup-pass2').value;
        const err = document.getElementById('setup-err');
        err.textContent = '';
        if (p1 !== p2) { err.textContent = 'Las contraseñas no coinciden.'; return; }
        try {
          await Auth.firstSetup({ username: u, password: p1, nombre: 'Administrador' });
          this.showPanel();
        } catch (ex) {
          err.textContent = ex.message || 'Error al crear la cuenta.';
        }
      });
    }

    document.getElementById('logout-btn').addEventListener('click', Auth.logout);

    /* Nav items */
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => this.go(btn.dataset.nav));
    });

    /* ESC cierra modales */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape')
        document.querySelectorAll('.adm-modal:not([hidden])').forEach(m => m.hidden = true);
    });

    /* Click fuera del modal lo cierra */
    document.querySelectorAll('.adm-modal').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
    });
  },

  showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    const setup = document.getElementById('setup-screen');
    if (setup) setup.hidden = true;
    document.getElementById('admin-panel').hidden = true;
  },

  /** Pantalla de configuración inicial (cuando aún no hay ningún usuario). */
  showSetup() {
    document.getElementById('login-screen').style.display = 'none';
    const setup = document.getElementById('setup-screen');
    if (setup) {
      setup.hidden = false;
      // El CSS de #login-screen aplica también aquí — usamos su display:flex
      setup.style.display = 'flex';
    }
    document.getElementById('admin-panel').hidden = true;
    if (window.lucide) lucide.createIcons();
    setTimeout(() => document.getElementById('setup-pass')?.focus(), 100);
  },

  showPanel() {
    document.getElementById('login-screen').style.display = 'none';
    const setup = document.getElementById('setup-screen');
    if (setup) setup.hidden = true;
    document.getElementById('admin-panel').hidden = false;

    const s = lsGet(KEYS.session);
    document.getElementById('sb-nombre').textContent  = s.nombre;
    document.getElementById('sb-role').textContent    = s.role === 'admin' ? '🔑 Administrador' : '👤 Propietario';
    document.getElementById('sb-avatar').textContent  = s.nombre.charAt(0).toUpperCase();

    /* Ocultar secciones solo admin */
    if (!isAdmin()) {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }

    if (window.lucide) lucide.createIcons();
    this._updateRenameCounter();
    this.go('dashboard');
  },

  go(section) {
    /* Nav activo */
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === section));
    /* Sección activa */
    document.querySelectorAll('.adm-section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + section));
    /* Título header */
    const titles = {
      dashboard:    'Dashboard',
      productos:    'Catálogo de Productos',
      renombrar:    'Renombrar Productos (nombres comerciales)',
      pagos:        'Métodos de Pago',
      pedidos:      'Pedidos',
      clientes:     'Clientes Frecuentes',
      vendedoras:   'Vendedoras',
      usuarios:     'Gestión de Usuarios',
      configuracion:'Configuración',
    };
    document.getElementById('hdr-title').textContent = titles[section] || section;

    /* Render */
    const fn = {
      dashboard:    () => this.renderDashboard(),
      productos:    () => this.renderProducts(),
      renombrar:    () => this.renderRename(),
      pagos:        () => this.renderPayments(),
      pedidos:      () => this.renderOrders(),
      clientes:     () => this.renderClients(),
      vendedoras:   () => this.renderVendedoras(),
      usuarios:     () => this.renderUsers(),
      configuracion:() => this.renderConfig(),
    };
    fn[section]?.();
    if (window.lucide) lucide.createIcons();
  },

  openModal(id)  { document.getElementById(id).hidden = false; if (window.lucide) lucide.createIcons(); },
  closeModal(id) { document.getElementById(id).hidden = true; },

  /* ════════════════════════════════════════════════════════
     DASHBOARD
  ════════════════════════════════════════════════════════ */
  renderDashboard() {
    const orders   = lsGet(KEYS.orders,  []);
    const clients  = lsGet(KEYS.clients, []);
    const prods    = this._effectiveProducts();
    const pays     = this._effectivePayments();
    const revenue  = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const payOvr   = lsGet(KEYS.paymentOverrides, {});

    document.getElementById('stat-pedidos').textContent  = orders.length;
    document.getElementById('stat-revenue').textContent  = '$' + fmt(revenue);
    document.getElementById('stat-activos').textContent  = prods.filter(p => p.active !== false).length + ' / ' + prods.length;
    document.getElementById('stat-pagos').textContent    = pays.filter(p => p.activo).length + ' activos';

    /* Widget de backup (estado + acciones) */
    this._renderBackupWidget();

    /* Pedidos recientes */
    const recEl = document.getElementById('dash-recent');
    const recent = [...orders].reverse().slice(0, 5);
    recEl.innerHTML = recent.length ? recent.map(o => `
      <div class="dash-row">
        <div>
          <div class="dash-num">${escapeHtmlAdm(o.numero || 'N/A')}</div>
          <div class="dash-sub">${escapeHtmlAdm(o.cliente || '—')} · ${escapeHtmlAdm(fmtDate(o.fecha))}</div>
        </div>
        <div style="text-align:right">
          <div class="dash-total">$${fmt(o.total)}</div>
          <span class="badge ${this._statusBadge(o.estado)}">${escapeHtmlAdm(o.estado || 'nuevo')}</span>
        </div>
      </div>`).join('') :
      '<p class="no-data">No hay pedidos aún</p>';

    /* Estado sistema */
    const prodOvr = lsGet(KEYS.productOverrides, {});
    const cfgOvr  = lsGet(KEYS.configOverrides,  {});
    const tasa    = cfgOvr.tasaCambio?.valorPorDefecto ?? window.ALUVIMA_CONFIG?.tasaCambio?.valorPorDefecto;
    document.getElementById('dash-status').innerHTML = `
      <div class="cfg-row"><div class="cfg-lbl"><strong>Tasa de cambio activa</strong><span>Bs por USD</span></div>
        <span class="cfg-val">Bs ${tasa || '—'}</span></div>
      <div class="cfg-row"><div class="cfg-lbl"><strong>Precios editados</strong><span>Productos con precio personalizado</span></div>
        <span class="badge ${Object.keys(prodOvr).length ? 'bdg-warn' : 'bdg-neutral'}">${Object.keys(prodOvr).length}</span></div>
      <div class="cfg-row"><div class="cfg-lbl"><strong>Métodos ocultos</strong><span>Desactivados manualmente</span></div>
        <span class="badge ${Object.values(payOvr).filter(v=>!v).length ? 'bdg-danger' : 'bdg-neutral'}">${Object.values(payOvr).filter(v=>!v).length}</span></div>
      <div class="cfg-row"><div class="cfg-lbl"><strong>Clientes frecuentes</strong></div>
        <span class="cfg-val">${clients.length}</span></div>`;
  },

  /* ════════════════════════════════════════════════════════
     PRODUCTOS
  ════════════════════════════════════════════════════════ */
  _effectiveProducts() {
    const ov = lsGet(KEYS.productOverrides, {});
    return ((typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || []).map(p => ({ ...p, ...(ov[p.id] || {}) }));
  },

  renderProducts() {
    const prods = this._effectiveProducts();
    const ov    = lsGet(KEYS.productOverrides, {});
    const tbody = document.getElementById('prod-tbody');
    const tipos = this._getTipos();
    tbody.innerHTML = prods.map(p => {
      const base    = ((typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || []).find(b => b.id === p.id);
      const hasOv   = !!ov[p.id]?.price;
      const isActive = p.active !== false;
      // 4 precios derivados del precio cristalero (base) actual
      const baseP = parseFloat(p.price) || 0;
      const pubP  = (baseP * (1 + (tipos.publico?.pctSobreBase ?? 45)/100)).toFixed(2);
      const bcvP  = (baseP * (1 + (tipos.bcv?.pctSobreBase ?? 35)/100)).toFixed(2);
      const mayP  = (baseP * (1 + (tipos.mayorista?.pctSobreBase ?? -5)/100)).toFixed(2);
      const pidAttr = escapeAttr(p.id);
      return `
      <tr data-pid="${pidAttr}" ${!isActive ? 'style="opacity:.5"' : ''}>
        <td><img src="${escapeAttr(p.image||'')}" class="prod-thumb" onerror="this.src='';this.style.background='#ddd'"/></td>
        <td>
          <div class="prod-name">${escapeHtmlAdm(p.name)}</div>
          <div class="text-sm text-muted">${escapeHtmlAdm((p.description||'').slice(0,55))}${(p.description||'').length>55?'…':''}</div>
        </td>
        <td><span class="badge bdg-neutral">${escapeHtmlAdm(p.category||'—')}</span></td>
        <td class="text-right ${hasOv?'strike text-muted':''}">$${fmt(base?.price)}</td>
        <td>
          <input type="number" class="price-inp ${hasOv?'changed':''}" value="${fmt(p.price)}"
            min="0" step="0.01" data-pid="${pidAttr}" data-base="${fmt(base?.price)}"
            onchange="Panel.onPriceChange(this)" title="Cristalero (base)" />
          <div class="text-sm text-muted" style="font-size:10.5px;margin-top:3px;line-height:1.4;white-space:nowrap">
            🌐 $${pubP} · 🧾 $${bcvP} · 🚛 $${mayP}
          </div>
        </td>
        <td>
          <label class="toggle"><input type="checkbox" data-pid="${pidAttr}" data-field="featured" ${p.featured?'checked':''}
            onchange="Panel.onFieldChange(this)"><span class="tog-slider"></span></label>
        </td>
        <td>
          <label class="toggle"><input type="checkbox" data-pid="${pidAttr}" data-field="active" ${isActive?'checked':''}
            onchange="Panel.onFieldChange(this)"><span class="tog-slider"></span></label>
        </td>
        <td>
          <button class="btn btn-xs btn-ghost" onclick="Panel.resetProduct('${pidAttr}')" title="Restaurar precio original">
            <i data-lucide="rotate-ccw" style="width:12px;height:12px"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  filterProducts(q) {
    document.querySelectorAll('#prod-tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
  },

  onPriceChange(inp) {
    inp.classList.toggle('changed', parseFloat(inp.value) !== parseFloat(inp.dataset.base));
  },

  onFieldChange(inp) {
    const row = inp.closest('tr');
    if (row) { row.style.outline = '2px solid #dd6b20'; setTimeout(()=>row.style.outline='', 900); }
  },

  saveProducts() {
    const ov = lsGet(KEYS.productOverrides, {});
    /* Precios */
    document.querySelectorAll('.price-inp').forEach(inp => {
      const id = inp.dataset.pid;
      if (!ov[id]) ov[id] = {};
      ov[id].price = parseFloat(inp.value);
    });
    /* Checkboxes */
    document.querySelectorAll('#prod-tbody input[data-field]').forEach(inp => {
      const id = inp.dataset.pid, field = inp.dataset.field;
      if (!ov[id]) ov[id] = {};
      ov[id][field] = inp.checked;
    });
    /* Limpiar overrides que coinciden con el valor base */
    ((typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || []).forEach(bp => {
      if (!ov[bp.id]) return;
      const o = ov[bp.id];
      if (o.price    === bp.price)           delete o.price;
      if (o.featured === !!bp.featured)      delete o.featured;
      if (o.active   === (bp.active !== false)) delete o.active;
      if (!Object.keys(o).length)            delete ov[bp.id];
    });
    lsSet(KEYS.productOverrides, ov);
    adminToast('Precios guardados. El sitio se actualiza al instante.', 'ok');
    this.renderProducts();
  },

  resetProduct(id) {
    const ov = lsGet(KEYS.productOverrides, {});
    delete ov[id];
    lsSet(KEYS.productOverrides, ov);
    adminToast('Precio restaurado al original.', 'info');
    this.renderProducts();
  },

  resetAllProducts() {
    if (!confirm('¿Restaurar TODOS los precios al valor original de products.js?')) return;
    localStorage.removeItem(KEYS.productOverrides);
    adminToast('Todos los precios restaurados.', 'info');
    this.renderProducts();
  },

  /* ════════════════════════════════════════════════════════
     RENOMBRADOR DE PRODUCTOS (nombres comerciales)
     ─────────────────────────────────────────────────────
     Plan híbrido: el sitio público solo muestra productos con
     displayName asignado. Aquí la dueña los va renombrando.
  ════════════════════════════════════════════════════════ */
  _renameState: { q: '', cat: '', status: 'pending', page: 0, pageSize: 50 },

  /** Actualiza el contador en el sidebar (productos pendientes) */
  _updateRenameCounter() {
    const ov = lsGet(KEYS.productOverrides, {});
    const all = (typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || [];
    const pending = all.filter(p => {
      const dn = ov[p.id]?.displayName;
      return !(dn && dn.trim());
    }).length;
    const badge = document.getElementById('nav-rename-counter');
    if (badge) {
      badge.textContent = pending > 999 ? '999+' : pending;
      badge.hidden = pending === 0;
    }
  },

  renderRename() {
    // Sincroniza el toggle "mostrar todos" con localStorage
    const cfgOver = lsGet(KEYS.configOverrides, {});
    const toggle = document.getElementById('show-all-toggle');
    if (toggle) toggle.checked = cfgOver.showAllProducts === true;

    this._renderRenameTable();
    this._updateRenameCounter();
  },

  _renderRenameTable() {
    const ov  = lsGet(KEYS.productOverrides, {});
    const all = (typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || [];
    const st  = this._renameState;

    // Filtrado
    let list = all.filter(p => {
      const dn = ov[p.id]?.displayName?.trim();
      const isDone = !!dn;
      if (st.status === 'pending' && isDone) return false;
      if (st.status === 'done' && !isDone) return false;
      if (st.cat && p.category !== st.cat) return false;
      if (st.q) {
        const hay = (p.name + ' ' + (p.id || '') + ' ' + (dn || '')).toLowerCase();
        if (!hay.includes(st.q.toLowerCase())) return false;
      }
      return true;
    });

    // Stats
    const totalAll  = all.length;
    const totalDone = all.filter(p => !!ov[p.id]?.displayName?.trim()).length;
    document.getElementById('rs-pending').textContent = totalAll - totalDone;
    document.getElementById('rs-done').textContent    = totalDone;
    document.getElementById('rs-total').textContent   = totalAll;

    // Paginación
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / st.pageSize));
    st.page = Math.max(0, Math.min(st.page, totalPages - 1));
    const slice = list.slice(st.page * st.pageSize, (st.page + 1) * st.pageSize);

    document.getElementById('rename-pginfo').textContent =
      total === 0 ? 'Sin resultados' :
      `Página ${st.page + 1} de ${totalPages}  ·  ${total} producto(s) listado(s)`;

    const tbody = document.getElementById('rename-tbody');
    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--muted)">
        ${st.status === 'pending' ? '🎉 ¡No hay productos pendientes! Todos tienen nombre comercial.' : 'Sin resultados con esos filtros.'}
      </td></tr>`;
      return;
    }

    const catLabels = { vidrio: 'Vidrio', aluminio: 'Aluminio', acero: 'Acero', accesorios: 'Accesorios' };
    tbody.innerHTML = slice.map(p => {
      const dn = ov[p.id]?.displayName || '';
      const isDone = !!dn.trim();
      const catLabel = catLabels[p.category] || p.category || '—';
      const safeName = escapeAttr(p.name);
      const safeDn   = escapeAttr(dn);
      return `
        <tr data-id="${escapeAttr(p.id)}">
          <td><span class="rs-chip" style="font-size:11px;padding:3px 9px">${catLabel}</span></td>
          <td style="font-size:13px;color:var(--text)">
            <div style="font-weight:600">${escapeHtmlAdm(p.name)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">ID: ${escapeHtmlAdm(p.id)} · ${p.unit || 'unidad'}</div>
          </td>
          <td>
            <input type="text" class="rename-input ${isDone ? 'is-done' : ''}"
              placeholder="Ej: Vidrio Templado de Seguridad 6mm"
              value="${safeDn}"
              data-product-id="${escapeAttr(p.id)}"
              onchange="Panel.saveDisplayName(this.dataset.productId, this.value)"
              onkeydown="if(event.key==='Enter'){this.blur();}" />
          </td>
          <td>
            <span class="rename-status ${isDone ? 'rename-status-done' : 'rename-status-pending'}">
              ${isDone ? '✓ Visible' : 'Oculto'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  },

  /** Guarda el displayName de un producto (lo activa o desactiva) */
  saveDisplayName(productId, displayName) {
    const ov = lsGet(KEYS.productOverrides, {});
    const trimmed = (displayName || '').trim();
    ov[productId] = ov[productId] || {};
    if (trimmed) {
      ov[productId].displayName = trimmed;
    } else {
      delete ov[productId].displayName;
      if (Object.keys(ov[productId]).length === 0) delete ov[productId];
    }
    lsSet(KEYS.productOverrides, ov);
    this._renderRenameTable();
    this._updateRenameCounter();
    adminToast(trimmed ? '✓ Nombre comercial guardado' : 'Nombre comercial eliminado (producto oculto)', 'success', 1800);
  },

  filterRename(q)       { this._renameState.q = q;    this._renameState.page = 0; this._renderRenameTable(); },
  filterRenameCat(c)    { this._renameState.cat = c;  this._renameState.page = 0; this._renderRenameTable(); },
  filterRenameStatus(s) { this._renameState.status = s; this._renameState.page = 0; this._renderRenameTable(); },
  renamePage(delta)     { this._renameState.page += delta; this._renderRenameTable(); },

  /** Toggle: mostrar TODOS los productos al público (modo dev) */
  toggleShowAll(checked) {
    const cfgOver = lsGet(KEYS.configOverrides, {});
    cfgOver.showAllProducts = checked === true;
    lsSet(KEYS.configOverrides, cfgOver);
    adminToast(checked
      ? '⚠ Modo desarrollo: TODOS los productos visibles al público'
      : '✓ Plan híbrido: solo productos con nombre comercial visibles',
      checked ? 'warn' : 'success', 2200);
  },

  /* ════════════════════════════════════════════════════════
     MÉTODOS DE PAGO
  ════════════════════════════════════════════════════════ */
  _effectivePayments() {
    const ov = lsGet(KEYS.paymentOverrides, {});
    return (window.ALUVIMA_CONFIG?.pasarelas || []).map(p => ({
      ...p,
      activo: ov[p.id] !== undefined ? ov[p.id] : p.activo,
    }));
  },

  renderPayments() {
    const pays = this._effectivePayments();
    const FISCAL = ['binance', 'zelle', 'paypal'];
    document.getElementById('pays-grid').innerHTML = pays.map(p => `
      <div class="pay-card ${p.activo ? 'pay-on' : 'pay-off'}" id="pc-${p.id}">
        <div class="pay-head">
          <div class="pay-info">
            <div class="pay-icon" style="background:${p.color||'#555'}">
              <i data-lucide="${p.icono||'credit-card'}" style="width:18px;height:18px"></i>
            </div>
            <div>
              <div class="pay-name">${p.nombre}</div>
              <div class="text-sm text-muted">${p.moneda||'USD'}</div>
            </div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="pt-${p.id}" ${p.activo?'checked':''}
              onchange="Panel.onPayToggle('${p.id}',this.checked)">
            <span class="tog-slider"></span>
          </label>
        </div>
        ${p.datos ? `<div class="pay-data">${p.datos.slice(0,2).map(d=>`<span><strong>${d.campo}:</strong> ${d.valor}</span>`).join('')}</div>` : ''}
        ${FISCAL.includes(p.id) ? `
          <div class="fiscal-warn">
            <i data-lucide="alert-triangle" style="width:13px;height:13px;flex-shrink:0"></i>
            <span><strong>Riesgo fiscal VE</strong> — Puede generar observaciones del SENIAT. Consulta con tu contador.</span>
          </div>` : ''}
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  },

  onPayToggle(id, active) {
    const card = document.getElementById(`pc-${id}`);
    card?.classList.toggle('pay-on', active);
    card?.classList.toggle('pay-off', !active);
  },

  savePayments() {
    const ov = {};
    document.querySelectorAll('[id^="pt-"]').forEach(t => {
      ov[t.id.replace('pt-', '')] = t.checked;
    });
    lsSet(KEYS.paymentOverrides, ov);
    adminToast('Métodos de pago actualizados.', 'ok');
    this.renderPayments();
  },

  /* ════════════════════════════════════════════════════════
     PEDIDOS
  ════════════════════════════════════════════════════════ */
  renderOrders(filterStatus = 'all') {
    const all    = lsGet(KEYS.orders, []);
    const orders = filterStatus === 'all' ? all : all.filter(o => (o.estado||'nuevo') === filterStatus);
    const tbody  = document.getElementById('ord-tbody');

    if (!orders.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="no-data">
        ${filterStatus==='all' ? 'No hay pedidos aún. Los pedidos aparecen cuando el cliente envía su orden por WhatsApp.' : 'Sin pedidos con ese estado.'}
      </td></tr>`;
      return;
    }

    tbody.innerHTML = [...orders].reverse().map(o => `
      <tr>
        <td><strong>${o.numero||'—'}</strong></td>
        <td>${o.cliente||'—'}</td>
        <td>${o.telefono||'—'}</td>
        <td>${fmtDate(o.fecha)}</td>
        <td><strong>$${fmt(o.total)}</strong></td>
        <td>${o.metodoPago||'—'}</td>
        <td>
          <select class="ord-status" data-oid="${o.id}" onchange="Panel.setOrderStatus('${o.id}',this.value)">
            <option value="nuevo"      ${(o.estado||'nuevo')==='nuevo'      ?'selected':''}>Nuevo</option>
            <option value="confirmado" ${o.estado==='confirmado'?'selected':''}>Confirmado</option>
            <option value="entregado"  ${o.estado==='entregado' ?'selected':''}>Entregado</option>
            <option value="cancelado"  ${o.estado==='cancelado' ?'selected':''}>Cancelado</option>
          </select>
        </td>
        <td>
          <button class="btn btn-xs btn-ghost" onclick="Panel.viewOrder('${o.id}')">
            <i data-lucide="eye" style="width:12px;height:12px"></i>
          </button>
          ${o.telefono ? `<a href="https://wa.me/${o.telefono.replace(/\D/g,'')}" target="_blank" class="btn btn-xs btn-wa" title="WhatsApp">
            <i data-lucide="message-circle" style="width:12px;height:12px"></i>
          </a>` : ''}
        </td>
      </tr>`).join('');
    if (window.lucide) lucide.createIcons();
  },

  filterOrders() {
    this.renderOrders(document.getElementById('ord-filter').value);
  },

  setOrderStatus(oid, status) {
    const orders = lsGet(KEYS.orders, []);
    const i = orders.findIndex(o => o.id === oid);
    if (i !== -1) { orders[i].estado = status; lsSet(KEYS.orders, orders); }
    adminToast('Estado actualizado.', 'ok'); this.renderOrders();
  },

  viewOrder(oid) {
    const o = (lsGet(KEYS.orders, [])).find(o => o.id === oid);
    if (!o) return;
    document.getElementById('modal-ord-title').textContent = `Pedido ${o.numero||oid}`;
    document.getElementById('modal-ord-body').innerHTML = `
      <div class="ord-grid">
        <div><strong>Cliente</strong><p>${o.cliente||'—'}</p></div>
        <div><strong>Teléfono</strong><p>${o.telefono||'—'}</p></div>
        <div><strong>Email</strong><p>${o.email||'—'}</p></div>
        <div><strong>Modalidad</strong><p>${o.entrega||'—'}</p></div>
        <div><strong>Fecha</strong><p>${fmtDate(o.fecha)}</p></div>
        <div><strong>Método de pago</strong><p>${o.metodoPago||'—'}</p></div>
      </div>
      ${o.nota?`<div class="ord-nota"><strong>Nota:</strong> ${o.nota}</div>`:''}
      <div class="ord-items-title">Productos</div>
      <div class="ord-items">
        ${(o.items||[]).map(it=>`
          <div class="ord-item">
            <span>${it.qty}× ${it.name}</span>
            <strong>$${fmt(it.subtotal||it.price*it.qty)}</strong>
          </div>`).join('')||'<p class="text-muted">Sin detalle</p>'}
        <div class="ord-item ord-total">
          <span>TOTAL</span>
          <strong>$${fmt(o.total)}</strong>
        </div>
      </div>`;
    this.openModal('modal-ord');
  },

  exportOrders() {
    const orders = lsGet(KEYS.orders, []);
    if (!orders.length) { adminToast('No hay pedidos para exportar.', 'err'); return; }
    const hdrs = ['Número','Cliente','Teléfono','Email','Fecha','Total USD','Método Pago','Estado','Productos','Nota'];
    const rows = orders.map(o => [
      o.numero||'', o.cliente||'', o.telefono||'', o.email||'',
      fmtDate(o.fecha), fmt(o.total), o.metodoPago||'', o.estado||'nuevo',
      (o.items||[]).map(it=>`${it.qty}x ${it.name}`).join('; '), o.nota||'',
    ]);
    const csv = [hdrs,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`aluvima-pedidos-${new Date().toISOString().slice(0,10)}.csv`});
    a.click(); URL.revokeObjectURL(a.href);
    adminToast('CSV exportado.', 'ok');
  },

  _statusBadge(s) {
    return { nuevo:'bdg-warn', confirmado:'bdg-ok', entregado:'bdg-neutral', cancelado:'bdg-danger' }[s] || 'bdg-neutral';
  },

  /* ════════════════════════════════════════════════════════
     CLIENTES (auto-registrados desde checkout + manuales)
  ════════════════════════════════════════════════════════ */
  _getAutoCustomers() {
    try { return Object.values(JSON.parse(localStorage.getItem('aluvima_customers') || '{}')); }
    catch { return []; }
  },

  _getTipos() {
    // Usa los tipos del módulo Customers si está cargado (fuente única de verdad)
    if (window.Customers?.getTipos) return Customers.getTipos();
    const DEF = {
      publico:    { label: 'Público',    pctSobreBase: 45, color: '#8B1A2B' },
      bcv:        { label: 'BCV',        pctSobreBase: 35, color: '#dd6b20' },
      cristalero: { label: 'Cristalero', pctSobreBase:  0, color: '#2b6cb0' },
      mayorista:  { label: 'Mayorista',  pctSobreBase: -5, color: '#276749' },
    };
    return DEF;
  },

  _normalizeTipo(t) {
    if (!t || t === 'regular') return 'publico';
    return t;
  },

  renderClients() {
    let customers = this._getAutoCustomers();
    const orders  = lsGet(KEYS.orders, []);
    const tipos   = this._getTipos();
    const tbody   = document.getElementById('cli-tbody');
    const results = document.getElementById('cli-results');

    // ── Aplicar filtros (búsqueda + tipo) ──
    const query = (document.getElementById('cli-search')?.value || '').trim().toLowerCase();
    const tipoF = document.getElementById('cli-tipo-filter')?.value || '';
    const totalCount = customers.length;

    if (query) {
      customers = customers.filter(c =>
        (c.nombre || '').toLowerCase().includes(query) ||
        (c.telefono || '').includes(query) ||
        (c.cedula || '').toLowerCase().includes(query) ||
        (c.rif || '').toLowerCase().includes(query) ||
        (c.razonSocial || '').toLowerCase().includes(query)
      );
    }
    if (tipoF) {
      customers = customers.filter(c => this._normalizeTipo(c.tipo) === tipoF);
    }

    // Contador de resultados (solo si hay filtros)
    if (results) {
      if (query || tipoF) {
        results.style.display = '';
        // C2 fix — escapar el query del admin: si pega un nombre que contiene HTML
        // (vino del checkout libre), evitamos XSS reflejado en su propia sesión.
        results.innerHTML = `<strong>${customers.length}</strong> de ${totalCount} clientes${query ? ` para "<em>${escapeHtmlAdm(query)}</em>"` : ''}`;
      } else { results.style.display = 'none'; }
    }

    if (!customers.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="no-data">${
        totalCount === 0
          ? 'Sin clientes registrados aún. Se crean automáticamente cuando hacen su primer pedido.'
          : 'Sin resultados para tu búsqueda.'
      }</td></tr>`;
      return;
    }

    // Ordenar: más recientes primero
    customers.sort((a, b) => new Date(b.ultimaCompra || b.creadoEn) - new Date(a.ultimaCompra || a.creadoEn));

    const vendedoras = window.Customers ? Customers.getAllVendedoras() : [];

    tbody.innerHTML = customers.map(c => {
      const nOrd = orders.filter(o => Customers?.normalizeTel ? Customers.normalizeTel(o.telefono) === c.id : o.telefono === c.telefono).length;
      const tipoKey = this._normalizeTipo(c.tipo);
      const tipo = tipos[tipoKey] || tipos.publico;
      const esNuevo = (c.totalPedidos || 1) <= 1;
      const pctAuto = tipo.pctSobreBase ?? 0;
      const pctFinal = typeof c.pctSobreBase === 'number' ? c.pctSobreBase : pctAuto;
      const vendedoraActual = c.vendedoraId ? Customers.getVendedora(c.vendedoraId) : null;
      return `
      <tr>
        <td>
          <strong>${c.nombre}</strong>
          ${esNuevo ? '<span class="badge bdg-ok" style="margin-left:6px">NUEVO</span>' : ''}
          ${c.requiereFactura ? '<span class="badge bdg-warn" style="margin-left:6px" title="Solicita factura fiscal">🧾</span>' : ''}
          ${c.rif ? `<div class="text-sm text-muted">${c.rif}${c.razonSocial ? ' · ' + c.razonSocial : ''}</div>` : ''}
        </td>
        <td>${c.telefono || '—'}</td>
        <td>${c.cedula || '<span class="text-muted">—</span>'}</td>
        <td>
          <select class="cli-tipo-sel" data-cid="${c.id}" onchange="Panel.changeCustomerTipo('${c.id}', this.value)" style="padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;background:${tipo.color}20;color:${tipo.color};font-weight:700">
            ${Object.entries(tipos).map(([k, v]) => `<option value="${k}" ${tipoKey===k?'selected':''}>${v.label} (${v.pctSobreBase>0?'+':''}${v.pctSobreBase}%)</option>`).join('')}
          </select>
        </td>
        <td>
          <input type="number" class="price-inp" style="width:65px" value="${pctFinal}" min="-50" max="100" step="1"
            onchange="Panel.setCustomerPct('${c.id}', this.value)" title="Override manual: % sobre precio base"/>
        </td>
        <td>
          <select class="cli-vend-sel" onchange="Panel.changeCustomerVendedora('${c.id}', this.value)" style="padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;background:#fff;min-width:130px">
            <option value="">— Sin asignar —</option>
            ${vendedoras.map(v => `<option value="${v.id}" ${c.vendedoraId===v.id?'selected':''} ${!v.activa?'disabled':''}>${v.nombre}${v.esDefault?' ⭐':''}${!v.activa?' (inactiva)':''}</option>`).join('')}
          </select>
        </td>
        <td><strong>${nOrd}</strong></td>
        <td><strong>$${(c.totalGastado||0).toFixed(2)}</strong></td>
        <td class="td-actions">
          <button class="btn btn-xs btn-ghost" onclick="Panel.viewCustomerHistory('${c.id}')" title="Ver historial">
            <i data-lucide="history" style="width:12px;height:12px"></i>
          </button>
          <button class="btn btn-xs btn-ghost" onclick="Panel.resetCustomerPassword('${c.id}')" title="Resetear contraseña" style="color:#dd6b20">
            <i data-lucide="key-round" style="width:12px;height:12px"></i>
          </button>
          ${c.telefono ? `<a href="https://wa.me/${c.telefono}" target="_blank" class="btn btn-xs btn-wa" title="WhatsApp">
            <i data-lucide="message-circle" style="width:12px;height:12px"></i>
          </a>` : ''}
          <button class="btn btn-xs btn-danger" onclick="Panel.deleteCustomer('${c.id}')" title="Eliminar">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  /** Filtra la lista de clientes en vivo */
  filterCustomers(_query) { this.renderClients(); },

  /** Establece % personalizado para un cliente (override del tipo) */
  setCustomerPct(id, val) {
    try {
      const db = JSON.parse(localStorage.getItem('aluvima_customers') || '{}');
      if (db[id]) {
        const num = parseFloat(val);
        db[id].pctSobreBase = isNaN(num) ? null : Math.max(-50, Math.min(100, num));
        // Limpiamos campo legacy 'descuento'
        delete db[id].descuento;
        localStorage.setItem('aluvima_customers', JSON.stringify(db));
        adminToast(`% personalizado: ${db[id].pctSobreBase > 0 ? '+' : ''}${db[id].pctSobreBase}% sobre base.`, 'ok');
      }
    } catch {}
  },

  changeCustomerTipo(id, tipo) {
    try {
      const db = JSON.parse(localStorage.getItem('aluvima_customers') || '{}');
      if (db[id]) {
        db[id].tipo = tipo;
        db[id].pctSobreBase = null;  // limpiar override → usa el % del tipo
        delete db[id].descuento;     // limpiar campo legacy
        localStorage.setItem('aluvima_customers', JSON.stringify(db));
        adminToast(`Cliente reclasificado como ${this._getTipos()[tipo]?.label}.`, 'ok');
        this.renderClients();
      }
    } catch {}
  },

  viewCustomerHistory(id) {
    try {
      const db = JSON.parse(localStorage.getItem('aluvima_customers') || '{}');
      const c  = db[id];
      if (!c) return;
      const orders = lsGet(KEYS.orders, []).filter(o => Customers?.normalizeTel ? Customers.normalizeTel(o.telefono) === id : o.telefono === c.telefono);
      const tipos = this._getTipos();
      const tipo = tipos[c.tipo] || tipos.regular;

      document.getElementById('modal-ord-title').textContent = `Historial de ${c.nombre}`;
      document.getElementById('modal-ord-body').innerHTML = `
        <div class="ord-grid">
          <div><strong>Teléfono</strong><p>${c.telefono}</p></div>
          <div><strong>Tipo</strong><p><span class="badge" style="background:${tipo.color}20;color:${tipo.color}">${tipo.label}</span></p></div>
          <div><strong>Pedidos totales</strong><p>${c.totalPedidos || 0}</p></div>
          <div><strong>Gastado total</strong><p>$${(c.totalGastado||0).toFixed(2)}</p></div>
          <div><strong>Cliente desde</strong><p>${fmtDate(c.creadoEn)}</p></div>
          <div><strong>Última compra</strong><p>${fmtDate(c.ultimaCompra)}</p></div>
          ${c.requiereFactura ? `<div><strong>RIF</strong><p>${c.rif || '—'}</p></div><div><strong>Razón Social</strong><p>${c.razonSocial || '—'}</p></div>` : ''}
        </div>
        <h4 style="margin:14px 0 8px;font-size:13px;font-weight:700">Pedidos (${orders.length})</h4>
        <div class="ord-items">
          ${orders.length === 0 ? '<p class="text-muted text-sm">Sin pedidos registrados.</p>' :
            [...orders].reverse().map(o => `
              <div class="ord-item">
                <span>${o.numero} · ${fmtDate(o.fecha)}</span>
                <strong>$${fmt(o.total)} <span class="badge ${this._statusBadge(o.estado)}" style="margin-left:6px">${o.estado||'nuevo'}</span></strong>
              </div>`).join('')}
        </div>`;
      this.openModal('modal-ord');
    } catch (e) { console.error(e); }
  },

  deleteCustomer(id) {
    if (!confirm('¿Eliminar este cliente y su historial? Los pedidos NO se borran.')) return;
    try {
      const db = JSON.parse(localStorage.getItem('aluvima_customers') || '{}');
      delete db[id];
      localStorage.setItem('aluvima_customers', JSON.stringify(db));
      adminToast('Cliente eliminado.', 'info');
      this.renderClients();
    } catch {}
  },

  /* ════════════════════════════════════════════════════════
     EDITOR DE TIPOS DE CLIENTE (descuentos configurables)
  ════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════
     EDITOR DE MAPEO: DEPARTAMENTO VALERY → CATEGORÍA
  ════════════════════════════════════════════════════════ */

  /** Lee el mapeo actual */
  _getDeptMapping() {
    return lsGet('aluvima_dept_mapping', {});
  },

  /** Detecta todos los departamentos únicos de los productos */
  _getAllDepartamentos() {
    const counts = {};
    const baseList = (typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || [];
    const imported = lsGet('aluvima_imported_products', []);
    [...baseList, ...imported].forEach(p => {
      if (p.departamento) counts[p.departamento] = (counts[p.departamento] || 0) + 1;
    });
    return counts;
  },

  /** Renderiza el editor de departamentos */
  renderDeptMappingEditor() {
    const cont = document.getElementById('dept-mapping-editor');
    if (!cont) return;

    const counts = this._getAllDepartamentos();
    const mapping = this._getDeptMapping();
    const deps = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (!deps.length) {
      cont.innerHTML = '<p class="text-muted text-sm">No se detectaron departamentos. Importa primero un Excel de Valery.</p>';
      return;
    }

    const catOptions = `
      <option value="">— Sin asignar (queda como departamento) —</option>
      <option value="vidrio">Vidrio</option>
      <option value="aluminio">Aluminio</option>
      <option value="acero">Acero Inoxidable</option>
      <option value="accesorios">Accesorios</option>`;

    // Buscador para filtrar departamentos en pantalla
    cont.innerHTML = `
      <div style="margin-bottom:12px">
        <input type="text" class="search-inp" id="dept-search" placeholder="🔍 Buscar departamento por código..."
          oninput="Panel.filterDeptMapping(this.value)" style="width:100%;max-width:380px"/>
      </div>
      <div class="tbl-wrap" style="max-height:520px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">
        <table style="font-size:13px">
          <thead style="position:sticky;top:0;background:#fff;z-index:1">
            <tr>
              <th>Código Departamento</th>
              <th>Productos</th>
              <th>Categoría Asignada</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody id="dept-tbody">
            ${deps.map(([dep, count]) => `
              <tr data-dept="${dep}">
                <td><code style="background:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:12px">${dep}</code></td>
                <td><strong>${count}</strong> productos</td>
                <td>
                  <select class="cfg-inp dept-sel" data-dept="${dep}" style="width:180px">
                    ${catOptions.replace(`value="${mapping[dep] || ''}"`, `value="${mapping[dep] || ''}" selected`)}
                  </select>
                </td>
                <td>
                  <button class="btn btn-xs btn-ghost" onclick="Panel.previewDept('${dep}')" title="Ver productos de este departamento">
                    <i data-lucide="eye" style="width:12px;height:12px"></i> Ver
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="flex-row" style="margin-top:12px;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost btn-xs" onclick="Panel.clearDeptMapping()">
          <i data-lucide="rotate-ccw" style="width:11px;height:11px"></i> Limpiar todo
        </button>
        <button class="btn btn-ghost btn-xs" onclick="Panel.autoMapDepts()">
          <i data-lucide="zap" style="width:11px;height:11px"></i> Auto-mapear por keywords
        </button>
      </div>`;

    // Re-aplicar las selecciones correctas
    Object.entries(mapping).forEach(([dep, cat]) => {
      const sel = cont.querySelector(`select[data-dept="${dep}"]`);
      if (sel) sel.value = cat;
    });

    if (window.lucide) lucide.createIcons();
  },

  filterDeptMapping(query) {
    const q = (query || '').toLowerCase();
    document.querySelectorAll('#dept-tbody tr').forEach(tr => {
      tr.style.display = tr.dataset.dept.toLowerCase().includes(q) ? '' : 'none';
    });
  },

  saveDeptMapping() {
    const mapping = {};
    document.querySelectorAll('.dept-sel').forEach(sel => {
      if (sel.value) mapping[sel.dataset.dept] = sel.value;
    });
    lsSet('aluvima_dept_mapping', mapping);
    adminToast(`✅ Mapeo guardado: ${Object.keys(mapping).length} departamentos asignados.`, 'ok');
  },

  clearDeptMapping() {
    if (!confirm('¿Borrar todas las asignaciones? Los productos volverán a su categoría original.')) return;
    localStorage.removeItem('aluvima_dept_mapping');
    adminToast('Mapeo borrado.', 'info');
    this.renderDeptMappingEditor();
  },

  /** Intenta mapear departamentos automáticamente viendo los nombres de productos */
  autoMapDepts() {
    const baseList = (typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || [];
    const imported = lsGet('aluvima_imported_products', []);
    const all = [...baseList, ...imported];

    // Por cada departamento, ver qué categoría predomina en los nombres
    const deptByName = {};
    all.forEach(p => {
      if (!p.departamento) return;
      const n = (p.name || '').toLowerCase();
      let cat = 'accesorios';
      if (/(acero|inox|baranda|pasamanos)/.test(n)) cat = 'acero';
      else if (/(vidrio|cristal|vitrina|espejo|templado|laminado|esmerilado|reflectivo)/.test(n)) cat = 'vidrio';
      else if (/(aluminio|perfil|ventana|puerta|cabezal|sabote|zocalo|riel|marco|pvc)/.test(n)) cat = 'aluminio';

      if (!deptByName[p.departamento]) deptByName[p.departamento] = {};
      deptByName[p.departamento][cat] = (deptByName[p.departamento][cat] || 0) + 1;
    });

    // Asignar a cada departamento la categoría más común
    const mapping = {};
    Object.entries(deptByName).forEach(([dep, cats]) => {
      const winner = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
      if (winner) mapping[dep] = winner[0];
    });

    lsSet('aluvima_dept_mapping', mapping);
    adminToast(`✅ Auto-mapeo: ${Object.keys(mapping).length} departamentos asignados.`, 'ok');
    this.renderDeptMappingEditor();
  },

  previewDept(dep) {
    const baseList = (typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || [];
    const imported = lsGet('aluvima_imported_products', []);
    const products = [...baseList, ...imported].filter(p => p.departamento === dep).slice(0, 20);

    const items = products.map(p => `<li style="padding:4px 0;border-bottom:1px solid #f0f0f0">${p.name} <span class="text-muted" style="font-size:11px">($${p.price})</span></li>`).join('');
    alert(`Departamento ${dep} — primeros ${products.length} productos:\n\n${products.map(p => '• ' + p.name).slice(0, 15).join('\n')}${products.length > 15 ? '\n... y más' : ''}`);
  },

  renderTiposEditor() {
    const tipos = this._getTipos();
    const cont  = document.getElementById('tipos-cliente-editor');
    if (!cont) return;
    cont.innerHTML = `
      <div class="adm-alert adm-alert-info" style="margin-bottom:14px">
        <i data-lucide="info" style="width:16px;height:16px;flex-shrink:0;margin-top:1px"></i>
        <div>El precio en <code>products.js</code> es el <strong>BASE (Cristalero / costo interno)</strong>. Cada tipo aplica un % sobre ese precio:
          <strong>positivo</strong> = markup (público / BCV), <strong>negativo</strong> = descuento (mayorista). Ejemplo: base $130 + 45% = <strong>$188.50 público</strong>.</div>
      </div>
      <table style="width:100%;font-size:13px">
        <thead><tr>
          <th>Tipo</th><th>Etiqueta visible</th><th>% sobre Base</th><th>Ejemplo (Base $130)</th>
        </tr></thead>
        <tbody>
          ${Object.entries(tipos).map(([key, t]) => {
            const pct = t.pctSobreBase ?? t.descuento ?? 0;
            const ejemplo = (130 * (1 + pct/100)).toFixed(2);
            const color = pct > 0 ? '#dd6b20' : (pct < 0 ? '#276749' : '#2b6cb0');
            return `
              <tr>
                <td><strong style="text-transform:capitalize">${key}</strong></td>
                <td><input type="text" class="cfg-inp" data-tipo="${key}" data-field="label" value="${t.label}" style="width:200px"/></td>
                <td>
                  <input type="number" class="cfg-inp" data-tipo="${key}" data-field="pctSobreBase" value="${pct}" min="-50" max="100" step="1" style="width:80px;color:${color};font-weight:700"/> %
                </td>
                <td style="font-family:Montserrat,sans-serif;font-weight:700;color:${color}">$${ejemplo}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    if (window.lucide) lucide.createIcons();
  },

  saveTiposCliente() {
    const tipos = this._getTipos();
    document.querySelectorAll('[data-tipo]').forEach(inp => {
      const k = inp.dataset.tipo, f = inp.dataset.field;
      if (!tipos[k]) return;
      if (f === 'pctSobreBase') {
        tipos[k][f] = parseFloat(inp.value) || 0;
        delete tipos[k].descuento; // limpiar campo legacy
      } else {
        tipos[k][f] = inp.value.trim();
      }
    });
    localStorage.setItem('aluvima_tipos_cliente', JSON.stringify(tipos));
    adminToast('Tipos de cliente actualizados.', 'ok');
    this.renderTiposEditor();
  },

  /* ════════════════════════════════════════════════════════
     USUARIOS (solo admin)
  ════════════════════════════════════════════════════════ */
  renderUsers() {
    if (!isAdmin()) {
      document.getElementById('users-wrap').innerHTML =
        '<div class="adm-alert adm-alert-danger">Solo el administrador puede gestionar usuarios.</div>';
      return;
    }
    const users = lsGet(KEYS.users, {});
    const roleColor = { admin:'#8B1A2B', propietario:'#2b6cb0' };
    const roleLabel = { admin:'🔑 Administrador', propietario:'👤 Propietario' };
    document.getElementById('users-wrap').innerHTML = Object.entries(users).map(([uname, u]) => `
      <div class="user-card">
        <div class="user-av" style="background:${roleColor[u.role]||'#555'}">${u.nombre.charAt(0).toUpperCase()}</div>
        <div style="flex:1">
          <div class="user-name">${u.nombre}</div>
          <div class="text-muted text-sm">@${uname}</div>
          <span class="badge ${u.role==='admin'?'bdg-danger':'bdg-neutral'} mt-4">${roleLabel[u.role]||u.role}</span>
        </div>
        <button class="btn btn-ghost" onclick="Panel.openPwModal('${uname}','${u.nombre}')">
          <i data-lucide="key" style="width:14px;height:14px"></i> Cambiar Contraseña
        </button>
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  },

  openPwModal(uname, nombre) {
    this._pwTarget = uname;
    document.getElementById('pw-desc').textContent = `Cambiar contraseña de: ${nombre} (@${uname})`;
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
    document.getElementById('pw-err').textContent = '';
    this.openModal('modal-pw');
  },

  async savePw() {
    const np = document.getElementById('pw-new').value;
    const cp = document.getElementById('pw-confirm').value;
    const errEl = document.getElementById('pw-err');
    if (np.length < 6) { errEl.textContent = 'Mínimo 6 caracteres.'; return; }
    if (np !== cp)     { errEl.textContent = 'Las contraseñas no coinciden.'; return; }
    const users = lsGet(KEYS.users, {});
    users[this._pwTarget].hash = await sha256(np + SALT);
    lsSet(KEYS.users, users);
    this.closeModal('modal-pw');
    adminToast('Contraseña actualizada.','ok');
    this._pwTarget = null;
  },

  /* ════════════════════════════════════════════════════════
     CONFIGURACIÓN
  ════════════════════════════════════════════════════════ */
  renderConfig() {
    const ov  = lsGet(KEYS.configOverrides, {});
    const cfg = window.ALUVIMA_CONFIG || {};
    document.getElementById('cfg-tasa').value    = ov.tasaCambio?.valorPorDefecto ?? cfg.tasaCambio?.valorPorDefecto ?? '';
    document.getElementById('cfg-horario').value = ov.empresa?.horario ?? cfg.empresa?.horario ?? '';
    document.getElementById('cfg-wa').value      = ov.contacto?.whatsapp ?? cfg.contacto?.whatsapp ?? '';
    document.getElementById('cfg-modo-tasa').value = ov.tasaCambio?.mostrarEnWeb !== undefined
      ? (ov.tasaCambio.mostrarEnWeb ? '1' : '0')
      : (cfg.tasaCambio?.mostrarEnWeb ? '1' : '0');
    this.renderTiposEditor();
    this.renderDeptMappingEditor();
  },

  saveConfig() {
    this.saveTiposCliente(); // guarda también los tipos de cliente
    const ov = lsGet(KEYS.configOverrides, {});
    const tasa    = parseFloat(document.getElementById('cfg-tasa').value);
    const horario = document.getElementById('cfg-horario').value.trim();
    const wa      = document.getElementById('cfg-wa').value.trim();
    const modoTasa = document.getElementById('cfg-modo-tasa').value;

    if (!isNaN(tasa) && tasa > 0) {
      ov.tasaCambio = { ...(ov.tasaCambio||{}), valorPorDefecto: tasa };
    }
    if (modoTasa !== '') {
      ov.tasaCambio = { ...(ov.tasaCambio||{}), mostrarEnWeb: modoTasa === '1', mostrarEnProductos: modoTasa === '1', mostrarEnCarrito: modoTasa === '1' };
    }
    if (horario) ov.empresa  = { ...(ov.empresa||{}),  horario };
    if (wa)      ov.contacto = { ...(ov.contacto||{}), whatsapp: wa };

    lsSet(KEYS.configOverrides, ov);
    adminToast('Configuración guardada. El sitio la aplica al instante.','ok');
  },

  /* ════════════════════════════════════════════════════════
     VENDEDORAS — CRUD
  ════════════════════════════════════════════════════════ */
  renderVendedoras() {
    if (!window.Customers) { document.getElementById('vend-tbody').innerHTML = '<tr><td colspan="7" class="no-data">Módulo Customers no cargado.</td></tr>'; return; }
    const vendedoras = Customers.getAllVendedoras();
    const customers  = this._getAutoCustomers();
    const tbody      = document.getElementById('vend-tbody');

    if (!vendedoras.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="no-data">
        Sin vendedoras registradas. Agrega la primera con el botón <strong>"Nueva Vendedora"</strong>.<br/>
        <small>Mientras tanto, los pedidos van al WhatsApp general de la empresa.</small>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = vendedoras.map(v => {
      const nClientes = customers.filter(c => c.vendedoraId === v.id).length;
      return `
      <tr ${!v.activa ? 'style="opacity:.55"' : ''}>
        <td>
          <strong>${v.nombre}</strong>
          ${v.esDefault ? '<span class="badge bdg-warn" style="margin-left:6px" title="Recibe los pedidos de clientes sin asignar">⭐ Default</span>' : ''}
        </td>
        <td>
          <a href="https://wa.me/${v.whatsapp}" target="_blank" style="color:#25d366;text-decoration:none">${v.whatsapp}</a>
        </td>
        <td class="text-sm text-muted">${v.especialidad || '—'}</td>
        <td>${v.activa ? '<span class="badge bdg-ok">Activa</span>' : '<span class="badge bdg-danger">Inactiva</span>'}</td>
        <td><strong>${nClientes}</strong></td>
        <td>${v.esDefault ? '✓' : '—'}</td>
        <td class="td-actions">
          <button class="btn btn-xs btn-ghost" onclick="Panel.editVendedora('${v.id}')" title="Editar">
            <i data-lucide="edit-2" style="width:12px;height:12px"></i>
          </button>
          <a href="https://wa.me/${v.whatsapp}" target="_blank" class="btn btn-xs btn-wa" title="WhatsApp">
            <i data-lucide="message-circle" style="width:12px;height:12px"></i>
          </a>
          <button class="btn btn-xs btn-danger" onclick="Panel.deleteVendedora('${v.id}')" title="Eliminar">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  newVendedora() {
    document.getElementById('vend-id').value = '';
    document.getElementById('vend-nombre').value = '';
    document.getElementById('vend-wa').value = '';
    document.getElementById('vend-esp').value = '';
    document.getElementById('vend-default').checked = false;
    document.getElementById('vend-activa').checked = true;
    document.getElementById('vend-err').textContent = '';
    document.getElementById('modal-vend-title').textContent = 'Nueva Vendedora';
    this.openModal('modal-vend');
  },

  editVendedora(id) {
    const v = Customers.getVendedora(id);
    if (!v) return;
    document.getElementById('vend-id').value = id;
    document.getElementById('vend-nombre').value = v.nombre;
    document.getElementById('vend-wa').value = v.whatsapp;
    document.getElementById('vend-esp').value = v.especialidad || '';
    document.getElementById('vend-default').checked = !!v.esDefault;
    document.getElementById('vend-activa').checked = v.activa !== false;
    document.getElementById('vend-err').textContent = '';
    document.getElementById('modal-vend-title').textContent = 'Editar Vendedora';
    this.openModal('modal-vend');
  },

  saveVendedora() {
    const err = document.getElementById('vend-err');
    try {
      Customers.saveVendedora({
        id:           document.getElementById('vend-id').value,
        nombre:       document.getElementById('vend-nombre').value,
        whatsapp:     document.getElementById('vend-wa').value,
        especialidad: document.getElementById('vend-esp').value,
        esDefault:    document.getElementById('vend-default').checked,
        activa:       document.getElementById('vend-activa').checked,
      });
      this.closeModal('modal-vend');
      adminToast('Vendedora guardada.', 'ok');
      this.renderVendedoras();
    } catch (e) { err.textContent = e.message; }
  },

  deleteVendedora(id) {
    const v = Customers.getVendedora(id);
    if (!v) return;
    if (!confirm(`¿Eliminar a "${v.nombre}"? Los clientes asignados a ella quedarán sin asignar.`)) return;
    Customers.deleteVendedora(id);
    adminToast('Vendedora eliminada.', 'info');
    this.renderVendedoras();
    // Si estamos viendo clientes, re-renderizar
    if (document.getElementById('sec-clientes')?.classList.contains('active')) this.renderClients();
  },

  /* Asignar vendedora a un cliente desde la tabla de clientes */
  changeCustomerVendedora(customerId, vendedoraId) {
    Customers.assignVendedora(customerId, vendedoraId || null);
    const v = vendedoraId ? Customers.getVendedora(vendedoraId) : null;
    adminToast(v ? `Cliente asignado a ${v.nombre}` : 'Cliente desasignado.', 'ok');
  },

  /* ════════════════════════════════════════════════════════
     RESET DE CONTRASEÑA (cliente)
  ════════════════════════════════════════════════════════ */
  async resetCustomerPassword(customerId) {
    const c = this._getAutoCustomers().find(c => c.id === customerId);
    if (!c) return;
    if (!confirm(`¿Resetear contraseña de ${c.nombre}?\n\nSe creará una contraseña temporal con los últimos 4 dígitos de su teléfono.`)) return;
    try {
      const temp = await Customers.resetPassword(customerId);
      document.getElementById('modal-reset-body').innerHTML = `
        <p style="margin-bottom:14px">Se reseteó la contraseña de <strong>${c.nombre}</strong>.</p>
        <div style="background:#fffbeb;border:2px solid #f6e05e;border-radius:10px;padding:16px;text-align:center;margin-bottom:14px">
          <div class="text-sm text-muted" style="margin-bottom:6px">Contraseña temporal:</div>
          <div style="font-family:Montserrat,sans-serif;font-size:32px;font-weight:700;letter-spacing:6px;color:#8B1A2B">${temp}</div>
        </div>
        <p class="text-sm">📲 <strong>Comparte esta contraseña con ${c.nombre.split(' ')[0]}</strong> (idealmente por WhatsApp). Dile que entre con su teléfono o cédula + esta clave, y que la cambie después desde "Mi cuenta".</p>
        <p style="margin-top:12px">
          <a href="https://wa.me/${c.telefono}?text=${encodeURIComponent(`Hola ${c.nombre.split(' ')[0]}, tu nueva contraseña temporal es: ${temp}\n\nEntra al sitio con tu teléfono o cédula y esta clave. Luego cámbiala desde "Mi cuenta".`)}" target="_blank" class="btn btn-wa" style="display:inline-flex;align-items:center;gap:6px">
            <i data-lucide="message-circle" style="width:13px;height:13px"></i> Enviar por WhatsApp
          </a>
        </p>
      `;
      this.openModal('modal-reset');
    } catch (e) { adminToast(e.message, 'err'); }
  },

  /* ════════════════════════════════════════════════════════
     📥 IMPORTADOR DESDE VALERY (.xlsx, .csv)
  ════════════════════════════════════════════════════════ */

  // Mapeo conocido de columnas Valery → nuestro modelo
  // Si el archivo del cliente usa otras cabeceras, se puede ajustar acá.
  _VALERY_COLS: {
    id:          'CODIGO_PRODUCTO',
    name:        'NOMBRE',
    nombreCorto: 'NOMBRE_CORTO',
    referencia:  'REFERENCIA',
    marca:       'MARCA',
    modelo:      'MODELO',
    departamento:'DEPARTAMENTO_CODIGO',
    unidad:      'UNIDAD',
    costo:       'COSTO_UNITARIO',
    precioMax:   'PRECIO_MAXIMO',   // → Público con IVA
    precioOft:   'PRECIO_OFERTA',   // → BCV sin IVA
    precioMay:   'PRECIO_MAYOR',    // → Cristalero (base)
    precioMin:   'PRECIO_MINIMO',   // → Mayorista
    estatus:     'ESTATUS',         // 'A' = activo
    descripcion: 'DESCRIPCION',
  },

  _importParsed: null,  // datos parseados temporales (entre paso 1 y paso 3)

  openImportModal() {
    this._importParsed = null;
    document.getElementById('import-body').innerHTML = this._renderImportStep1();
    document.getElementById('import-footer').innerHTML = `
      <button class="btn btn-ghost" onclick="Panel.closeModal('modal-import')">Cancelar</button>`;
    this.openModal('modal-import');
  },

  _renderImportStep1() {
    return `
      <div class="adm-alert adm-alert-info" style="margin-bottom:16px">
        <i data-lucide="info" style="width:18px;height:18px;flex-shrink:0;margin-top:1px"></i>
        <div>
          <strong>¿Cómo exportar desde Valery?</strong><br/>
          En Valery: <em>Inventario → Artículos → Exportar a Excel</em>. Sube ese mismo archivo aquí sin modificarlo.
          El sistema detecta automáticamente las columnas estándar de Valery.
        </div>
      </div>

      <div style="border:2px dashed #cbd5e0;border-radius:12px;padding:32px;text-align:center;background:#fafbfc">
        <i data-lucide="file-spreadsheet" style="width:48px;height:48px;color:#8B1A2B;margin-bottom:8px"></i>
        <h4 style="font-family:Montserrat,sans-serif;margin-bottom:6px;color:#2d3748">Selecciona tu archivo Excel</h4>
        <p class="text-sm text-muted" style="margin-bottom:14px">Formatos aceptados: .xlsx · .xls · .csv</p>
        <button class="btn btn-red" onclick="document.getElementById('valery-file-input').click()">
          <i data-lucide="folder-open" style="width:14px;height:14px"></i> Elegir archivo
        </button>
      </div>

      <p class="text-sm text-muted" style="margin-top:14px">
        💡 Si el archivo tiene más de 3000 productos puede tardar 2-5 segundos en procesarse.
      </p>
    `;
  },

  /** Llamado al seleccionar un archivo. Carga, parsea y muestra preview */
  handleValeryFile(file) {
    if (!file) return;
    if (!window.XLSX) { adminToast('Librería XLSX no cargada. Revisa tu conexión a internet.', 'err'); return; }

    document.getElementById('import-body').innerHTML = `
      <div style="text-align:center;padding:48px 20px">
        <div style="display:inline-block;width:48px;height:48px;border:4px solid #e2e8f0;border-top-color:#8B1A2B;border-radius:50%;animation:spin 0.9s linear infinite"></div>
        <p style="margin-top:16px;color:#4a5568">Procesando <strong>${file.name}</strong>…</p>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });

        // Buscar la hoja con los productos (suele ser 'Sheet 1' o la primera con muchas filas)
        let sheet = null;
        let sheetName = '';
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
          if (rows.length > 10) {  // hoja con datos
            sheet = rows;
            sheetName = name;
            break;
          }
        }
        if (!sheet) throw new Error('No se encontró una hoja con productos en el archivo.');

        const parsed = this._parseValeryRows(sheet);
        if (!parsed.products.length) throw new Error('No se detectaron productos válidos. ¿Es un export de Valery? Asegúrate de incluir las columnas CODIGO_PRODUCTO, NOMBRE y precios.');

        this._importParsed = { sheetName, ...parsed };
        document.getElementById('import-body').innerHTML = this._renderImportStep2();
        document.getElementById('import-footer').innerHTML = `
          <button class="btn btn-ghost" onclick="Panel.openImportModal()">← Cambiar archivo</button>
          <button class="btn btn-red" onclick="Panel.confirmImport()">
            <i data-lucide="check" style="width:13px;height:13px"></i>
            Importar ${parsed.products.length} productos
          </button>`;
        if (window.lucide) lucide.createIcons();
      } catch (err) {
        console.error(err);
        document.getElementById('import-body').innerHTML = `
          <div class="adm-alert adm-alert-danger">
            <i data-lucide="alert-circle" style="width:18px;height:18px;flex-shrink:0;margin-top:1px"></i>
            <div><strong>Error al procesar el archivo:</strong><br/>${err.message}</div>
          </div>
          <button class="btn btn-ghost" onclick="Panel.openImportModal()" style="margin-top:14px">← Volver</button>
        `;
        if (window.lucide) lucide.createIcons();
      } finally {
        document.getElementById('valery-file-input').value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  },

  /** Convierte filas del Excel a productos en nuestro formato */
  _parseValeryRows(rows) {
    const C = this._VALERY_COLS;
    const products = [];
    const departamentos = {};
    let inactivos = 0;
    let saltados  = 0;

    rows.forEach(row => {
      const id  = row[C.id];
      const nom = row[C.name];
      if (!id || !nom) { saltados++; return; }

      // Filtrar solo activos
      if (row[C.estatus] && row[C.estatus] !== 'A') { inactivos++; return; }

      // Precios — usamos PRECIO_MAYOR como base (cristalero)
      const precioMay  = parseFloat(row[C.precioMay])  || 0;
      const precioMax  = parseFloat(row[C.precioMax])  || 0;
      const precioOft  = parseFloat(row[C.precioOft])  || 0;
      const precioMin  = parseFloat(row[C.precioMin])  || 0;
      const costo      = parseFloat(row[C.costo])      || 0;

      // Si no tiene precio mayor, intentar usar costo como fallback
      const base = precioMay > 0 ? precioMay : costo;
      if (base <= 0) { saltados++; return; }

      const dep = String(row[C.departamento] || 'sin-dep');
      departamentos[dep] = (departamentos[dep] || 0) + 1;

      const marca  = (row[C.marca]  || '').trim();
      const modelo = (row[C.modelo] || '').trim();
      const desc   = [marca, modelo].filter(x => x && x !== marca).join(' · ') || marca || 'Importado de Valery';

      products.push({
        id:           String(id).trim(),
        name:         String(nom).trim(),
        description:  desc,
        category:     `dep-${dep}`,             // se renombra después con el mapeo
        unit:         (row[C.unidad] || 'unidad').trim().toLowerCase(),
        price:        +base.toFixed(2),         // base = cristalero
        // Precios por tier (Opción B) — si existen, ganan sobre el % global
        prices: (precioMax > 0 || precioOft > 0 || precioMin > 0) ? {
          publico:    precioMax > 0 ? +precioMax.toFixed(2) : null,
          bcv:        precioOft > 0 ? +precioOft.toFixed(2) : null,
          cristalero: +base.toFixed(2),
          mayorista:  precioMin > 0 ? +precioMin.toFixed(2) : null,
        } : null,
        costo:        costo > 0 ? +costo.toFixed(2) : null,
        badge:        'badge-imported',
        badgeLabel:   'Importado',
        image:        '',
        featured:     false,
        imported:     true,
        fromValery:   true,
      });
    });

    return { products, departamentos, inactivos, saltados };
  },

  _renderImportStep2() {
    const p = this._importParsed;
    if (!p) return 'Error: datos no parseados.';

    // Comparar con productos actuales
    const baseList = (typeof PRODUCTS !== 'undefined' ? PRODUCTS : window.PRODUCTS) || [];
    const importedAlready = lsGet('aluvima_imported_products', []);
    const currentIds = new Set([...baseList.map(p => String(p.id)), ...importedAlready.map(p => String(p.id))]);
    const newIds = new Set(p.products.map(p => String(p.id)));

    let nuevos = 0, actualizados = 0;
    p.products.forEach(prod => {
      if (currentIds.has(String(prod.id))) actualizados++;
      else nuevos++;
    });
    const desaparecidos = [...currentIds].filter(id => !newIds.has(id)).length;

    // Top departamentos
    const topDeps = Object.entries(p.departamentos)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 8);

    // Muestra de 5 productos
    const sample = p.products.slice(0, 5);

    return `
      <div class="adm-alert adm-alert-info" style="margin-bottom:14px">
        <i data-lucide="check-circle-2" style="width:18px;height:18px;flex-shrink:0;margin-top:1px"></i>
        <div>Archivo leído correctamente desde la hoja <strong>"${p.sheetName}"</strong>. Revisa el resumen y confirma.</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px">
        <div class="stat"><div class="stat-lbl">A importar</div><div class="stat-val" style="color:#8B1A2B">${p.products.length}</div></div>
        <div class="stat" style="border-color:#38a169"><div class="stat-lbl">Nuevos</div><div class="stat-val" style="color:#276749">${nuevos}</div></div>
        <div class="stat" style="border-color:#dd6b20"><div class="stat-lbl">Actualizados</div><div class="stat-val" style="color:#dd6b20">${actualizados}</div></div>
        <div class="stat" style="border-color:#718096"><div class="stat-lbl">Saltados</div><div class="stat-val" style="color:#718096">${p.saltados}</div></div>
      </div>

      ${p.inactivos > 0 ? `
        <p class="text-sm text-muted" style="margin-bottom:14px">
          ⚪ ${p.inactivos} productos inactivos del Excel fueron ignorados (ESTATUS ≠ "A").
        </p>` : ''}

      ${desaparecidos > 0 ? `
        <div class="adm-alert adm-alert-warn" style="margin-bottom:14px">
          <i data-lucide="alert-triangle" style="width:16px;height:16px;flex-shrink:0;margin-top:1px"></i>
          <div>Hay <strong>${desaparecidos}</strong> productos actualmente en el sitio que NO están en este Excel.
            Permanecerán en el sitio. Si quieres limpiar productos viejos, desactívalos manualmente desde la tabla.</div>
        </div>` : ''}

      <h4 style="font-size:13px;font-weight:700;margin:14px 0 8px">Top departamentos detectados:</h4>
      <div style="background:#f7fafc;border-radius:8px;padding:10px 14px;margin-bottom:14px">
        ${topDeps.map(([dep, count]) => `
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12.5px">
            <code style="background:#e2e8f0;padding:1px 7px;border-radius:4px">${dep}</code>
            <span><strong>${count}</strong> productos</span>
          </div>`).join('')}
        ${Object.keys(p.departamentos).length > 8 ? `<div class="text-muted text-sm" style="margin-top:6px">+ ${Object.keys(p.departamentos).length - 8} departamentos más</div>` : ''}
      </div>
      <p class="text-sm text-muted" style="margin-bottom:14px">
        💡 Los departamentos se importan con sus códigos originales (ej: <code>dep-4.1</code>). Después de importar, puedes renombrarlos a "Vidrio", "Aluminio", etc. desde la sección <strong>Configuración → Departamentos</strong>.
      </p>

      <h4 style="font-size:13px;font-weight:700;margin:14px 0 8px">Muestra de productos:</h4>
      <div class="tbl-wrap" style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">
        <table style="font-size:12px">
          <thead style="position:sticky;top:0;background:#fff;z-index:1"><tr>
            <th>Código</th><th>Nombre</th><th>Unidad</th><th class="text-right">Cristalero</th><th class="text-right">Público</th>
          </tr></thead>
          <tbody>
            ${sample.map(prod => `
              <tr>
                <td><code>${prod.id}</code></td>
                <td>${prod.name}</td>
                <td>${prod.unit}</td>
                <td class="text-right"><strong>$${prod.price.toFixed(2)}</strong></td>
                <td class="text-right">$${(prod.prices?.publico || prod.price * 1.45).toFixed(2)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  confirmImport() {
    if (!this._importParsed) return;
    const products = this._importParsed.products;

    // Guardar la lista importada
    lsSet('aluvima_imported_products', products);

    // Guardar timestamp del último import
    lsSet('aluvima_last_valery_import', { at: new Date().toISOString(), count: products.length });

    this.closeModal('modal-import');
    adminToast(`✅ ${products.length} productos importados de Valery. El catálogo se actualiza al instante.`, 'ok');

    // Re-render del catálogo en admin
    this.renderProducts();

    this._importParsed = null;
  },

  /* ════════════════════════════════════════════════════════
     💾 BACKUP / RESTAURACIÓN COMPLETA (Nivel 2)
  ════════════════════════════════════════════════════════ */

  /** Días desde el último backup. null = nunca. */
  daysSinceBackup() {
    const last = lsGet(KEYS.lastBackup);
    if (!last) return null;
    return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  },

  /** Cuenta cuántos registros hay en cada clave (para mostrar resumen) */
  _countRecords() {
    const counts = {};
    BACKUP_KEYS.forEach(k => {
      const v = lsGet(k);
      if (!v) { counts[k] = 0; return; }
      if (Array.isArray(v)) counts[k] = v.length;
      else if (typeof v === 'object') counts[k] = Object.keys(v).length;
      else counts[k] = 1;
    });
    return counts;
  },

  /** Descarga TODOS los datos del admin como JSON */
  backupAll() {
    try {
      const data = {};
      BACKUP_KEYS.forEach(k => {
        const raw = localStorage.getItem(k);
        if (raw !== null) {
          try { data[k] = JSON.parse(raw); }
          catch { data[k] = raw; }
        }
      });

      const counts = this._countRecords();
      const totalRecords = Object.values(counts).reduce((a,b) => a + b, 0);

      const backup = {
        version:    BACKUP_VERSION,
        siteName:   'Aluvima 2.0',
        exportedAt: new Date().toISOString(),
        exportedBy: lsGet(KEYS.session)?.username || 'admin',
        totalRecords,
        counts,
        data,
      };

      // Descargar archivo
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const fecha = new Date().toISOString().slice(0,10);
      const hora  = new Date().toTimeString().slice(0,5).replace(':','');
      const a = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: `aluvima-backup-${fecha}-${hora}.json`,
      });
      a.click();
      URL.revokeObjectURL(a.href);

      // Registrar fecha del último backup
      lsSet(KEYS.lastBackup, new Date().toISOString());

      adminToast(`✅ Backup descargado · ${totalRecords} registros · ${(blob.size/1024).toFixed(1)} KB`, 'ok');

      // Refrescar dashboard si está visible
      if (document.getElementById('sec-dashboard')?.classList.contains('active')) {
        setTimeout(() => this.renderDashboard(), 200);
      }
    } catch (e) {
      console.error(e);
      adminToast('❌ Error al crear el backup.', 'err');
    }
  },

  /** Abre el selector de archivo para restaurar */
  triggerRestore() {
    if (!isAdmin()) {
      adminToast('Solo el administrador puede restaurar backups.', 'err');
      return;
    }
    document.getElementById('restore-file-input')?.click();
  },

  /** Procesa el archivo JSON seleccionado */
  async handleRestoreFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      // Validación básica
      if (!backup.data || typeof backup.data !== 'object') {
        throw new Error('Archivo de backup inválido (falta "data").');
      }
      if (backup.version && backup.version !== BACKUP_VERSION) {
        if (!confirm(`Este backup es de la versión ${backup.version} y este sistema es la versión ${BACKUP_VERSION}. ¿Continuar de todas formas?`)) return;
      }

      // Resumen para el usuario
      const c = backup.counts || {};
      const resumen = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 RESUMEN DEL BACKUP A RESTAURAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Fecha:  ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('es-VE') : '—'}
👤 Por:    ${backup.exportedBy || '—'}

• Pedidos:           ${c['aluvima_orders'] || 0}
• Clientes:          ${c['aluvima_customers'] || 0}
• Usuarios admin:    ${c['aluvima_admin_users'] || 0}
• Precios editados:  ${c['aluvima_product_overrides'] || 0}
• Pagos editados:    ${c['aluvima_payment_overrides'] || 0}
• Config personal:   ${c['aluvima_config_overrides'] || 0}
• Tipos cliente:     ${c['aluvima_tipos_cliente'] || 0}

⚠️  ATENCIÓN: Se SOBREESCRIBIRÁN todos los datos actuales del sistema.
   Si tienes datos importantes ahora, descarga primero un backup actual.

¿Restaurar este backup?`;

      if (!confirm(resumen)) {
        adminToast('Restauración cancelada.', 'info');
        return;
      }

      // Crear backup automático del estado actual ANTES de restaurar
      try {
        const snapshot = {};
        BACKUP_KEYS.forEach(k => { snapshot[k] = localStorage.getItem(k); });
        localStorage.setItem('aluvima_pre_restore_snapshot', JSON.stringify({
          at: new Date().toISOString(),
          data: snapshot,
        }));
      } catch {}

      // Aplicar la restauración
      let restored = 0;
      Object.entries(backup.data).forEach(([key, val]) => {
        if (!BACKUP_KEYS.includes(key)) return; // ignorar claves desconocidas
        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        restored++;
      });

      adminToast(`✅ Restauradas ${restored} categorías. Recargando…`, 'ok');
      setTimeout(() => location.reload(), 1200);

    } catch (e) {
      console.error(e);
      adminToast(`❌ Error: ${e.message}`, 'err');
    } finally {
      // Limpiar input para permitir reseleccionar el mismo archivo
      const inp = document.getElementById('restore-file-input');
      if (inp) inp.value = '';
    }
  },

  /** Pinta la tarjeta de estado de backup en el dashboard.
      Lee `daysSinceBackup()` (definida arriba) y enseña al admin
      cuán reciente es su último respaldo, con un CTA para descargar
      uno nuevo o restaurar desde archivo. */
  _renderBackupWidget() {
    const host = document.getElementById('backup-widget');
    if (!host) return;

    const dias = this.daysSinceBackup();
    let tone, icon, titulo, mensaje;
    if (dias === null) {
      tone = 'backup-critical'; icon = '⚠️';
      titulo  = 'Nunca has hecho un backup';
      mensaje = 'Descarga ya tu primer respaldo: si pierdes el navegador, pierdes todos los datos.';
    } else if (dias > 30) {
      tone = 'backup-critical'; icon = '🚨';
      titulo  = `Último backup hace ${dias} días`;
      mensaje = 'Es momento de hacer uno nuevo — los datos pueden haber cambiado mucho.';
    } else if (dias > 7) {
      tone = 'backup-warning'; icon = '⏰';
      titulo  = `Último backup hace ${dias} día${dias === 1 ? '' : 's'}`;
      mensaje = 'Recomendado: respaldar al menos una vez por semana.';
    } else {
      tone = ''; icon = 'OK';
      titulo  = dias === 0 ? 'Backup hecho hoy' : 'Ultimo backup hace ' + dias + (dias === 1 ? ' dia' : ' dias');
      mensaje = 'Todo en orden.';
    }

    host.innerHTML =
      '<div class="backup-card ' + tone + '">' +
        '<div class="backup-card-head">' +
          '<span style="font-size:22px">' + icon + '</span>' +
          '<div class="backup-status">' +
            '<strong>' + escapeHtmlAdm(titulo) + '</strong>' +
            '<div class="backup-msg">' + escapeHtmlAdm(mensaje) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="backup-actions">' +
          '<button class="btn btn-primary btn-sm" onclick="Panel.backupAll()">Descargar backup</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="Panel.triggerRestore()">Restaurar</button>' +
        '</div>' +
      '</div>';
  },

};

// Init lo dispara admin.html tras `DOMContentLoaded` y `await PRODUCTS_READY`.
