/**
 * customers.js — Sistema de clientes Aluvima 2.0
 * ────────────────────────────────────────────────────────────
 * Gestión de cuentas de cliente final:
 *   • Auto-registro al hacer su primer pedido (sin fricción)
 *   • Login opcional con teléfono + contraseña corta (4 dígitos)
 *   • Tipos: regular | cristalero | mayorista → descuento automático
 *   • Historial de pedidos por cliente
 *   • Datos fiscales (RIF + Razón Social) para empresas
 *
 * Datos en localStorage:
 *   aluvima_customers          → { telefonoNormalizado: {...} }
 *   aluvima_customer_session   → { telefono, nombre, tipo, at }
 * ──────────────────────────────────────────────────────────── */

const Customers = (() => {

  const KEY_DB      = 'aluvima_customers';
  const KEY_SESSION = 'aluvima_customer_session';
  const KEY_TRIES   = 'aluvima_login_tries';
  const KEY_LOCK    = 'aluvima_login_lock_until';

  // SALT legacy (compat backward — solo para verificar hashes viejos creados
  // antes de la migración a PBKDF2). NO usar para nuevas contraseñas.
  const SALT_LEGACY = 'aluvima-customer-salt';

  // ── Parámetros PBKDF2 ──
  // 100k iteraciones es el mínimo recomendado por OWASP para SHA-256.
  // Tarda ~80-120 ms en un móvil de gama media — aceptable para un login.
  const PBKDF2_ITERATIONS = 100000;
  const PBKDF2_HASH       = 'SHA-256';
  const PBKDF2_KEY_BITS   = 256;

  // ── Anti brute-force local ──
  const MAX_TRIES = 5;
  const LOCK_MS   = 5 * 60 * 1000;   // 5 minutos

  /* ── Tipos de cliente con MULTIPLICADOR sobre precio base ──
     El precio en products.js = precio BASE (Cristalero / costo interno).
     Cada tipo aplica un % sobre ese base:
       publico   → +45% (con IVA)         → P1
       bcv       → +35% (sin IVA, factura)→ P2
       cristalero→  0%  (precio base)     → P3
       mayorista → -5%  (descuento volumen)→ P4
  ────────────────────────────────────────────────────────── */
  const DEFAULT_TIPOS = {
    publico: {
      label: 'Público (con IVA)',
      pctSobreBase: 45,
      color: '#8B1A2B', icon: 'user',
      descripcion: 'Precio público con IVA — por defecto para nuevos clientes',
    },
    bcv: {
      label: 'BCV (sin IVA)',
      pctSobreBase: 35,
      color: '#dd6b20', icon: 'file-text',
      descripcion: 'Precio con tasa BCV oficial, sin IVA. Requiere factura fiscal',
    },
    cristalero: {
      label: 'Cristalero',
      pctSobreBase: 0,
      color: '#2b6cb0', icon: 'wrench',
      descripcion: 'Precio base / costo interno (divisa) para cristaleros',
    },
    mayorista: {
      label: 'Cristalero x Cantidad (Mayorista)',
      pctSobreBase: -5,
      color: '#276749', icon: 'truck',
      descripcion: 'Cristalero con descuento por volumen',
    },
  };

  /** Migración: tipos antiguos → nuevos */
  function _normalizeTipo(t) {
    if (!t || t === 'regular') return 'publico';
    return t;
  }

  function getTipos() {
    try {
      const ov = JSON.parse(localStorage.getItem('aluvima_tipos_cliente') || 'null');
      if (ov) return { ...DEFAULT_TIPOS, ...ov };
    } catch {}
    return DEFAULT_TIPOS;
  }

  function saveTipos(tipos) {
    localStorage.setItem('aluvima_tipos_cliente', JSON.stringify(tipos));
  }

  /** Devuelve el % sobre base para un tipo dado (o 'publico' por defecto) */
  function pctOf(tipo) {
    const t = getTipos()[_normalizeTipo(tipo)];
    return t?.pctSobreBase ?? 45; // si no existe, asume público
  }

  /** Calcula el precio final aplicando el multiplicador del tipo */
  function priceFor(basePrice, tipo) {
    const pct = pctOf(tipo);
    return +(basePrice * (1 + pct/100)).toFixed(2);
  }

  /* ── Utilidades ── */
  function _db()      { try { return JSON.parse(localStorage.getItem(KEY_DB) || '{}'); } catch { return {}; } }
  function _saveDb(d) { localStorage.setItem(KEY_DB, JSON.stringify(d)); }

  /** Normaliza teléfono a formato 584XXXXXXXXX (sin + ni espacios) */
  function normalizeTel(tel) {
    let t = String(tel || '').replace(/[\s\-\(\)\.]/g, '');
    if (t.startsWith('+')) t = t.slice(1);
    if (t.startsWith('0'))  t = '58' + t.slice(1);     // 0414... → 58414...
    if (!t.startsWith('58') && /^4\d{9}$/.test(t)) t = '58' + t;
    return t;
  }

  /** Normaliza cédula venezolana a formato V-12345678 (o E-12345678 para extranjeros) */
  function normalizeCedula(c) {
    if (!c) return '';
    let s = String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return '';
    // Si empieza con V o E → mantener prefijo
    if (/^[VE]/.test(s)) return s[0] + '-' + s.slice(1);
    // Si son solo dígitos (entre 6 y 9) → asumir V
    if (/^\d{6,9}$/.test(s)) return 'V-' + s;
    return s;
  }

  /** Detecta si un input parece cédula (V-, E-, o solo dígitos de 6-9 caracteres) */
  function looksLikeCedula(input) {
    const s = String(input || '').replace(/[\s\-]/g, '').toUpperCase();
    return /^[VE]\d{6,9}$/.test(s) || /^\d{6,9}$/.test(s);
  }

  /** Busca un cliente por cédula (devuelve customer o null) */
  function findByCedula(cedula) {
    const target = normalizeCedula(cedula);
    if (!target) return null;
    return Object.values(_db()).find(c => normalizeCedula(c.cedula) === target) || null;
  }

  /* ════════════════════════════════════════════════════════════
     HASH DE CONTRASEÑAS — PBKDF2 con salt por-usuario
     ────────────────────────────────────────────────────────────
     Formato del hash almacenado:
       Nuevo (PBKDF2):  "pbkdf2$<iter>$<salt-hex>$<hash-hex>"
       Legacy (SHA-256): 64 chars hex (sin prefijo) — verificable pero
                         se re-hashea con PBKDF2 al primer login exitoso.

     Migración: transparente. En cuanto un cliente con hash legacy se
     loguea correctamente, su passwordHash se reescribe en formato nuevo.
  ════════════════════════════════════════════════════════════ */

  /** Hash legacy. Solo se usa para verificar contraseñas viejas. */
  async function _hashLegacy(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s + SALT_LEGACY));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /** Genera 16 bytes (128 bits) aleatorios en hex — salt por usuario. */
  function _genSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /** PBKDF2 con un salt dado. Devuelve solo el hash hex (sin formato). */
  async function _pbkdf2(password, saltHex, iterations = PBKDF2_ITERATIONS) {
    const enc = new TextEncoder();
    const saltBytes = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: PBKDF2_HASH },
      keyMaterial, PBKDF2_KEY_BITS
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /** Crea un hash NUEVO en formato "pbkdf2$iter$salt$hash" con salt aleatorio. */
  async function _createHash(password) {
    const salt = _genSalt();
    const hash = await _pbkdf2(password, salt);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
  }

  /** Verifica una contraseña contra un hash almacenado.
   *  Detecta el formato (nuevo vs legacy) y devuelve { ok, legacy }. */
  async function _verifyHash(password, stored) {
    if (!stored) return { ok: false, legacy: false };

    // Formato nuevo: pbkdf2$iter$salt$hash
    if (stored.startsWith('pbkdf2$')) {
      const parts = stored.split('$');
      if (parts.length !== 4) return { ok: false, legacy: false };
      const iter = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
      const salt = parts[2];
      const expected = parts[3];
      const computed = await _pbkdf2(password, salt, iter);
      return { ok: computed === expected, legacy: false };
    }

    // Formato legacy: 64 hex chars (SHA-256 + SALT estático)
    if (/^[0-9a-f]{64}$/.test(stored)) {
      const computed = await _hashLegacy(password);
      return { ok: computed === stored, legacy: true };
    }

    return { ok: false, legacy: false };
  }

  /** Reglas mínimas para una contraseña nueva.
   *  Retorna mensaje de error o null si está bien. */
  function _validatePasswordStrength(pw) {
    if (!pw || pw.length < 8) return 'Mínimo 8 caracteres.';
    if (!/\d/.test(pw))        return 'Debe contener al menos un número.';
    if (!/[a-zA-Z]/.test(pw))  return 'Debe contener al menos una letra.';
    return null;
  }

  /* ── Lockout anti brute-force ── */
  function _isLocked() {
    const lockUntil = +localStorage.getItem(KEY_LOCK) || 0;
    return Date.now() < lockUntil ? lockUntil : 0;
  }
  function _registerFailedAttempt() {
    const tries = (+localStorage.getItem(KEY_TRIES) || 0) + 1;
    if (tries >= MAX_TRIES) {
      localStorage.setItem(KEY_LOCK, String(Date.now() + LOCK_MS));
      localStorage.setItem(KEY_TRIES, '0');
    } else {
      localStorage.setItem(KEY_TRIES, String(tries));
    }
  }
  function _clearAttempts() {
    localStorage.removeItem(KEY_TRIES);
    localStorage.removeItem(KEY_LOCK);
  }

  /* ── Registro / Login ── */

  /**
   * Crea cuenta nueva o actualiza existente (sin pedir contraseña — para checkout sin fricción).
   * Si ya existe, solo actualiza datos.
   */
  /**
   * Crea o actualiza el cliente.
   * @param {object} data - datos del cliente
   * @param {boolean} [isPurchase=true] - si es por una compra, incrementa contador; si es solo
   *   actualización de perfil (ej. agregar cédula desde "Mi cuenta"), pasar false.
   */
  function upsertFromCheckout({ nombre, telefono, cedula, rif, razonSocial, requiereFactura }, isPurchase = true) {
    const db  = _db();
    const id  = normalizeTel(telefono);
    const now = new Date().toISOString();
    const ex  = db[id];

    db[id] = {
      id,
      nombre,
      telefono:    id,
      cedula:      normalizeCedula(cedula) || ex?.cedula || '',
      tipo:        _normalizeTipo(ex?.tipo),
      pctSobreBase: ex?.pctSobreBase ?? null,
      rif:         rif         || ex?.rif         || '',
      razonSocial: razonSocial || ex?.razonSocial || '',
      requiereFactura: !!requiereFactura,
      passwordHash:    ex?.passwordHash    || null,
      creadoEn:        ex?.creadoEn        || now,
      ultimaCompra:    isPurchase ? now : (ex?.ultimaCompra || now),
      totalPedidos:    (ex?.totalPedidos    || 0) + (isPurchase ? 1 : 0),
      totalGastado:    ex?.totalGastado    || 0,
      notasAdmin:      ex?.notasAdmin      || '',
    };
    _saveDb(db);

    setSession(db[id]);
    return db[id];
  }

  /** Suma al gasto total acumulado del cliente */
  function addToSpent(telefono, amount) {
    const db = _db();
    const id = normalizeTel(telefono);
    if (db[id]) {
      db[id].totalGastado = (db[id].totalGastado || 0) + amount;
      _saveDb(db);
    }
  }

  /**
   * Login con teléfono O cédula + contraseña.
   * Detecta automáticamente qué tipo de identificador es.
   */
  async function login(identifier, password) {
    // ── Lockout local ─────────────────────────────────
    // Tras 5 intentos fallidos, el dispositivo queda bloqueado 5 min.
    // El lock vive en localStorage — un atacante con DevTools puede
    // borrarlo, pero al menos frena ataques casuales y automáticos.
    const lockUntil = _isLocked();
    if (lockUntil) {
      const min = Math.ceil((lockUntil - Date.now()) / 60000);
      return { ok: false, error: `Demasiados intentos fallidos. Espera ~${min} min antes de reintentar.` };
    }

    let c = null;
    const inp = String(identifier || '').trim();

    // Detectar si parece cédula primero (formato VE)
    if (looksLikeCedula(inp)) {
      c = findByCedula(inp);
      // Si no se encontró como cédula, intentar como teléfono (por si el usuario solo metió dígitos del tel)
      if (!c) c = _db()[normalizeTel(inp)];
    } else {
      // Intentar como teléfono primero, luego como cédula
      c = _db()[normalizeTel(inp)] || findByCedula(inp);
    }

    if (!c) {
      _registerFailedAttempt();
      return { ok: false, error: 'No encontramos una cuenta con ese teléfono o cédula.' };
    }
    if (!c.passwordHash) {
      return { ok: false, error: 'Esta cuenta no tiene contraseña. Crea una desde "Soy nuevo" o haz un pedido primero.' };
    }

    // Verificación con detección de formato (PBKDF2 nuevo o SHA-256 legacy)
    const verify = await _verifyHash(password, c.passwordHash);
    if (!verify.ok) {
      _registerFailedAttempt();
      return { ok: false, error: 'Contraseña incorrecta.' };
    }

    // ── Login OK: limpiar intentos y migrar hash legacy si aplica ──
    _clearAttempts();
    if (verify.legacy) {
      // Re-hashear en formato PBKDF2 con salt aleatorio. Transparente
      // para el cliente — la próxima vez ya entra contra el formato nuevo.
      try {
        const db = _db();
        if (db[c.id]) {
          db[c.id].passwordHash = await _createHash(password);
          _saveDb(db);
          c = db[c.id];
          console.log('[Customers] Hash de contraseña migrado a PBKDF2 para', c.id);
        }
      } catch (e) {
        console.warn('[Customers] No se pudo migrar hash legacy:', e);
        // No bloqueamos el login si la migración falla
      }
    }

    setSession(c);
    return { ok: true, customer: c };
  }

  async function setPassword(telefono, password) {
    // Validación de fortaleza (8+ chars, al menos 1 número y 1 letra)
    const strengthErr = _validatePasswordStrength(password);
    if (strengthErr) throw new Error(strengthErr);

    const db = _db();
    const id = normalizeTel(telefono);
    if (!db[id]) throw new Error('Cliente no existe.');

    // Hash PBKDF2 con salt único por usuario
    db[id].passwordHash = await _createHash(password);
    // Si tenía contraseña temporal por reseteo, ya no lo está
    delete db[id].passwordTemp;
    _saveDb(db);
    setSession(db[id]);
    return db[id];
  }

  function logout() {
    localStorage.removeItem(KEY_SESSION);
    refreshUI();
  }

  /* ── Sesión ── */

  function setSession(customer) {
    localStorage.setItem(KEY_SESSION, JSON.stringify({
      telefono: customer.id,
      nombre:   customer.nombre,
      tipo:     customer.tipo,
      at:       Date.now(),
    }));
    refreshUI();
  }

  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY_SESSION) || 'null');
      if (!s) return null;
      // Expira en 30 días
      if (Date.now() - s.at > 30 * 24 * 3600 * 1000) {
        localStorage.removeItem(KEY_SESSION);
        return null;
      }
      return s;
    } catch { return null; }
  }

  /** Devuelve el customer completo de la sesión activa, o null */
  function current() {
    const s = getSession();
    if (!s) return null;
    return _db()[s.telefono] || null;
  }

  /* ── Precios según tipo de cliente (4 modelos) ── */

  /** Devuelve el tipo activo (default: 'publico' si no hay sesión) */
  function currentTipo() {
    const c = current();
    return c ? _normalizeTipo(c.tipo) : 'publico';
  }

  /** % sobre base que aplica al cliente actual (puede ser override manual o del tipo) */
  function getPctActual() {
    const c = current();
    if (!c) return 45; // sin login → público
    if (typeof c.pctSobreBase === 'number') return c.pctSobreBase;
    return pctOf(c.tipo);
  }

  /** Aplica el precio de tier al precio base del producto */
  function applyTierPrice(basePrice) {
    return +(basePrice * (1 + getPctActual()/100)).toFixed(2);
  }

  /**
   * Versión completa que recibe el producto entero. Si el producto trae
   * precios por tier (importados de Valery), usa el precio EXACTO.
   * Si no, cae a applyTierPrice (multiplicador global sobre base).
   */
  function priceForProduct(product) {
    if (!product) return 0;
    const tipo = currentTipo();
    const base = parseFloat(product.price) || 0;
    // Opción B: precio per-tier guardado en el producto (de Valery)
    if (product.prices && typeof product.prices[tipo] === 'number' && product.prices[tipo] > 0) {
      return +product.prices[tipo].toFixed(2);
    }
    // Fallback: multiplicador global
    return applyTierPrice(base);
  }

  /** Alias de compatibilidad: ya NO es un descuento, es un % sobre base.
      Negativo = descuento real (mayorista), Positivo = markup (público/BCV) */
  function getDescuentoActual() { return getPctActual(); }
  function applyDiscount(basePrice) { return applyTierPrice(basePrice); }

  /** Ahorro vs precio público (útil para mostrar "ahorras $X") */
  function ahorroVsPublico(basePrice) {
    const publico = priceFor(basePrice, 'publico');
    const tuyo    = applyTierPrice(basePrice);
    return +(publico - tuyo).toFixed(2);
  }

  /* ── UI helpers ── */

  function refreshUI() {
    const btn      = document.getElementById('customer-btn');
    const btnText  = document.getElementById('customer-btn-text');
    const banner   = document.getElementById('customer-banner');
    const c        = current();

    if (btn) {
      if (c) {
        btn.classList.add('logged-in');
        if (btnText) btnText.textContent = c.nombre.split(' ')[0];
      } else {
        btn.classList.remove('logged-in');
        if (btnText) btnText.textContent = 'Mi cuenta';
      }
    }

    if (banner) {
      // Mostrar banner solo si el cliente NO es tipo "publico" (el default)
      const tipoActivo = currentTipo();
      if (c && tipoActivo !== 'publico') {
        const tipo = getTipos()[tipoActivo];
        const pct  = getPctActual();
        const pctTxt = pct > 0 ? `+${pct}%` : `${pct}%`; // ya viene con signo si es negativo
        banner.innerHTML = `
          <i data-lucide="badge-check"></i>
          <span>Hola <strong>${c.nombre.split(' ')[0]}</strong> — Estás identificado como <strong>${tipo?.label || tipoActivo}</strong>.
            Ves <strong>precios ${tipo?.label.toLowerCase() || tipoActivo}</strong> (${pctTxt} sobre base) en todo el catálogo.</span>
          <button onclick="Customers.logout()" class="customer-banner-close" title="Cerrar sesión">
            <i data-lucide="log-out"></i>
          </button>`;
        banner.hidden = false;
        if (window.lucide) window.lucide.createIcons();
      } else {
        banner.hidden = true;
      }
    }

    // Forzar re-render del carrito para mostrar precios actualizados
    if (window.Cart?.refresh) window.Cart.refresh();

    // Re-render del catálogo para mostrar precios del nuevo tier
    if (typeof window.rerenderCatalog === 'function') window.rerenderCatalog();
  }

  /* ── Pedidos del cliente ── */

  function getMyOrders() {
    const s = getSession();
    if (!s) return [];
    try {
      const all = JSON.parse(localStorage.getItem('aluvima_orders') || '[]');
      return all.filter(o => normalizeTel(o.telefono) === s.telefono);
    } catch { return []; }
  }

  /* ════════════════════════════════════════════════════
     VENDEDORAS — equipo de ventas asignable a clientes
  ════════════════════════════════════════════════════ */
  const KEY_VENDEDORAS = 'aluvima_vendedoras';

  function _vendedorasDb() {
    try { return JSON.parse(localStorage.getItem(KEY_VENDEDORAS) || '{}'); } catch { return {}; }
  }
  function _saveVendedoras(d) { localStorage.setItem(KEY_VENDEDORAS, JSON.stringify(d)); }

  function getAllVendedoras() {
    return Object.values(_vendedorasDb()).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }

  function getVendedora(id) {
    return _vendedorasDb()[id] || null;
  }

  /** Devuelve la vendedora marcada como "default" (para clientes sin asignar) */
  function getDefaultVendedora() {
    const all = getAllVendedoras();
    return all.find(v => v.esDefault && v.activa) || null;
  }

  /** Resuelve qué vendedora atiende a este cliente (o null = ir a WhatsApp general) */
  function getVendedoraForCustomer(customer) {
    if (!customer) return getDefaultVendedora();
    const v = customer.vendedoraId ? getVendedora(customer.vendedoraId) : null;
    if (v && v.activa) return v;
    return getDefaultVendedora();
  }

  function saveVendedora(vData) {
    if (!vData.nombre || !vData.whatsapp) throw new Error('Nombre y WhatsApp son obligatorios');
    const db = _vendedorasDb();
    const id = vData.id || `v-${Date.now()}`;
    const ex = db[id];

    // Si esta es default, quitar default de las demás
    if (vData.esDefault) {
      Object.values(db).forEach(v => { v.esDefault = false; });
    }

    db[id] = {
      id,
      nombre:        vData.nombre.trim(),
      whatsapp:      normalizeTel(vData.whatsapp),
      email:         vData.email || '',
      especialidad:  vData.especialidad || '',
      activa:        vData.activa !== false,
      esDefault:     !!vData.esDefault,
      color:         vData.color || '#8B1A2B',
      creadoEn:      ex?.creadoEn || new Date().toISOString(),
    };
    _saveVendedoras(db);
    return db[id];
  }

  function deleteVendedora(id) {
    const db = _vendedorasDb();
    delete db[id];
    _saveVendedoras(db);
    // Desasignar clientes que tenían esta vendedora
    const cdb = _db();
    Object.values(cdb).forEach(c => { if (c.vendedoraId === id) c.vendedoraId = null; });
    _saveDb(cdb);
  }

  /** Asigna (o desasigna con null) una vendedora a un cliente */
  function assignVendedora(customerId, vendedoraId) {
    const db = _db();
    if (!db[customerId]) return false;
    db[customerId].vendedoraId = vendedoraId || null;
    _saveDb(db);
    return true;
  }

  /* ════════════════════════════════════════════════
     RECUPERACIÓN DE CONTRASEÑA
  ════════════════════════════════════════════════ */

  /** Resetea la contraseña a una temporal (los 4 últimos dígitos del teléfono).
      Devuelve la contraseña temporal generada. */
  async function resetPassword(customerId) {
    const db = _db();
    const c  = db[customerId];
    if (!c) throw new Error('Cliente no existe');
    // Contraseña temporal intencionalmente simple para que la vendedora
    // la pueda comunicar por voz. El flag passwordTemp obliga al cliente
    // a crear una nueva (con _validatePasswordStrength) en su próximo login.
    const temp = c.telefono.slice(-4);
    c.passwordHash = await _createHash(temp);
    c.passwordTemp = true;
    _saveDb(db);
    return temp;
  }

  /* ── Init ── */
  function init() {
    refreshUI();
  }

  return {
    init, refreshUI,
    normalizeTel, normalizeCedula, looksLikeCedula, findByCedula,
    upsertFromCheckout, addToSpent,
    login, setPassword, logout,
    current, getSession,
    /* tiers (4 precios) */
    currentTipo, getPctActual, applyTierPrice, priceFor, priceForProduct, pctOf, ahorroVsPublico,
    /* compatibilidad */
    getDescuentoActual, applyDiscount,
    getTipos, saveTipos,
    getMyOrders,
    /* vendedoras */
    getAllVendedoras, getVendedora, getDefaultVendedora, getVendedoraForCustomer,
    saveVendedora, deleteVendedora, assignVendedora,
    /* recuperación */
    resetPassword,
    /* utilidades expuestas */
    validatePasswordStrength: _validatePasswordStrength,
  };

})();

// Expone global para que admin.js / cart.js puedan llamarlo
window.Customers = Customers;
