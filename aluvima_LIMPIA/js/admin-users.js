/**
 * admin-users.js — Extensión del panel admin para crear usuarios
 * ────────────────────────────────────────────────────────────
 * Vive en un archivo aparte porque admin.js está cerca del límite
 * de tamaño manejable y romper ese archivo es costoso. Aquí se
 * añaden métodos al objeto global `Panel` desde fuera:
 *   • Panel.openNewUserModal()  → muestra el modal #modal-new-user
 *   • Panel.saveNewUser()       → valida y guarda en aluvima_admin_users
 *
 * Carga: después de admin.js en admin.html (orden importa porque
 * Panel debe existir antes de extenderlo).
 *
 * Permisos:
 *   • Solo el rol "admin" puede crear nuevos usuarios.
 *   • El propietario puede operar pero no gestionar cuentas.
 *
 * Hash:
 *   • Por ahora SHA-256(password + SALT) — mismo formato que el
 *     resto del admin.js. Migrar a PBKDF2 cuando se haga el refactor
 *     de admin.js completo (auditoría C4 — fase 2).
 * ──────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // Espera a que Panel exista (lo crea admin.js)
  if (typeof Panel === 'undefined' || typeof sha256 !== 'function') {
    console.warn('[admin-users] Panel o sha256 no disponibles. ¿Orden de scripts incorrecto?');
    return;
  }

  // Reutilizamos las mismas constantes que admin.js
  // (están en el closure del módulo principal, pero los nombres
  // de las claves de localStorage los conocemos)
  const USERS_KEY = 'aluvima_admin_users';
  const ADMIN_SALT = 'aluvima-admin-salt-2026';

  // Helpers locales (réplica mínima de admin.js)
  function _ls(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
    catch { return fallback; }
  }
  function _save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function _isAdmin() {
    const s = _ls('aluvima_admin_session');
    return s?.role === 'admin';
  }
  function _toast(msg, type = 'ok') {
    if (typeof adminToast === 'function') return adminToast(msg, type);
    console.log('[admin-users]', msg);
  }

  /** Abre el modal "Nuevo Usuario". Solo el admin puede crear cuentas. */
  Panel.openNewUserModal = function () {
    if (!_isAdmin()) {
      _toast('Solo el administrador puede crear usuarios.', 'err');
      return;
    }
    ['nu-username', 'nu-nombre', 'nu-pass', 'nu-pass2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const errEl = document.getElementById('nu-err');
    if (errEl) errEl.textContent = '';
    // Rol por defecto: propietario (es el caso de uso más común)
    const roleEl = document.getElementById('nu-role');
    if (roleEl) roleEl.value = 'propietario';
    Panel.openModal('modal-new-user');
    setTimeout(() => document.getElementById('nu-username')?.focus(), 80);
  };

  /** Valida y guarda el nuevo usuario en aluvima_admin_users. */
  Panel.saveNewUser = async function () {
    if (!_isAdmin()) { _toast('No autorizado.', 'err'); return; }

    const username = document.getElementById('nu-username').value.trim().toLowerCase();
    const nombre   = document.getElementById('nu-nombre').value.trim();
    const role     = document.getElementById('nu-role').value;
    const pass     = document.getElementById('nu-pass').value;
    const pass2    = document.getElementById('nu-pass2').value;
    const errEl    = document.getElementById('nu-err');
    if (errEl) errEl.textContent = '';

    // ── Validaciones ─────────────────────────────────────────
    if (!/^[a-z0-9-]{3,20}$/.test(username)) {
      if (errEl) errEl.textContent = 'Usuario inválido: 3-20 caracteres, solo letras minúsculas, números y guiones.';
      return;
    }
    if (nombre.length < 2)  { if (errEl) errEl.textContent = 'Nombre visible muy corto.'; return; }
    if (!['admin','propietario'].includes(role)) { if (errEl) errEl.textContent = 'Rol inválido.'; return; }
    if (pass.length < 8)    { if (errEl) errEl.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
    if (pass !== pass2)     { if (errEl) errEl.textContent = 'Las contraseñas no coinciden.'; return; }

    const users = _ls(USERS_KEY, {});
    if (users[username]) {
      if (errEl) errEl.textContent = `Ya existe un usuario "@${username}". Usa otro nombre.`;
      return;
    }

    // ── Guardar ──────────────────────────────────────────────
    users[username] = {
      hash: await sha256(pass + ADMIN_SALT),
      role,
      nombre,
    };
    _save(USERS_KEY, users);

    Panel.closeModal('modal-new-user');
    const roleLabel = role === 'admin' ? '🔑 Administrador' : '👤 Propietario';
    _toast(`Usuario "${nombre}" (${roleLabel}) creado.`, 'ok');
    if (typeof Panel.renderUsers === 'function') Panel.renderUsers();
  };

  console.log('[admin-users] Panel.openNewUserModal y Panel.saveNewUser registrados.');
})();
