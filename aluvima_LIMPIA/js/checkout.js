/**
 * checkout.js — Aluvima Mérida 2.0
 * ────────────────────────────────────────────────────────────
 * Flujo:
 *   1. Click en "Continuar al Pedido"      → abre el modal
 *   2. Cliente llena nombre/teléfono/etc.  → validación
 *   3. Submit                              → genera mensaje + abre WhatsApp
 *
 * Incluye:
 *   • Numeración secuencial (ALV-00001, ALV-00002, ...)
 *   • Validación de teléfono venezolano (0412/14/16/24/26)
 *   • Conversión automática USD → Bs según tasa del día
 *   • Mensaje formateado con sección de pago y datos del cliente
 * ──────────────────────────────────────────────────────────── */

const Checkout = (() => {

  const COUNTER_KEY      = 'aluvima_pedido_counter';
  const LAST_CUSTOMER_KEY = 'aluvima_last_customer';
  const FALLBACK_WHATSAPP = '584247247358';

  // ── Helpers ────────────────────────────────────────────────
  const cfg = () => window.ALUVIMA_CONFIG || {};
  const getWhatsApp = () => cfg().contacto?.whatsapp || FALLBACK_WHATSAPP;
  const getTasa     = () => cfg().tasaCambio?.valorPorDefecto || null;
  const getPrefijo  = () => cfg().checkout?.prefijoPedido  || 'ALV-';
  const getPadding  = () => cfg().checkout?.paddingPedido  || 5;

  function generarNumeroPedido() {
    let n = parseInt(localStorage.getItem(COUNTER_KEY) || '0', 10) + 1;
    localStorage.setItem(COUNTER_KEY, String(n));
    return getPrefijo() + String(n).padStart(getPadding(), '0');
  }

  function getPasarelaSeleccionada() {
    const select = document.getElementById('cart-payment-method');
    const id = select?.value;
    const list = cfg().pasarelas || [];
    return list.find(p => p.id === id) || null;
  }

  function validarTelVE(tel) {
    const limpio = String(tel || '').replace(/[\s\-\(\)\.]/g, '');
    return /^(\+?58|0)?4(12|14|16|24|26)\d{7}$/.test(limpio);
  }

  function validarEmail(email) {
    if (!email) return true; // opcional
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function formatBs(usd) {
    const tasa = getTasa();
    if (!tasa) return null;
    const bs = usd * tasa;
    return 'Bs. ' + bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Construcción del mensaje ───────────────────────────────
  function buildWhatsAppMessage(items, total, cliente, numeroPedido, tipoCliente, tipoLabel, pctTier, vendedora, saludo, pdfFileName, pdfUrl) {
    const now = new Date();
    const fecha = now.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora  = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const empresa  = cfg().empresa || {};
    const tasa     = getTasa();
    const totalBs  = formatBs(total);
    const isDemo   = cfg().checkout?.incluirAvisoDemo;

    let msg = '';
    if (isDemo) {
      msg += `⚠️ *PEDIDO DE PRUEBA / MODO DEMO* ⚠️\n`;
      msg += `_Mensaje generado desde el sitio en desarrollo._\n\n`;
    }

    if (saludo) msg += saludo;
    msg += `te envío mi pedido:\n\n`;

    msg += `🏗️ *PEDIDO #${numeroPedido}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;

    if (pdfUrl) {
      msg += `📎 *DESCARGAR PDF DEL PEDIDO:*\n${pdfUrl}\n`;
      msg += `_Link de un solo uso · expira al descargar_\n\n`;
    } else if (pdfFileName) {
      msg += `📎 *PDF generado:* _${pdfFileName}_\n`;
      msg += `_(Sin internet — el cliente lo adjuntará manualmente)_\n\n`;
    }

    msg += `👤 *CLIENTE*\n`;
    msg += `• Nombre: ${cliente.nombre}\n`;
    msg += `• Teléfono: ${cliente.telefono}\n`;
    const pctTxt = pctTier > 0 ? `+${pctTier}%` : `${pctTier}%`;
    msg += `• Tipo: *${tipoLabel || 'Público'}* (${pctTxt} sobre base)\n\n`;

    if (cliente.requiereFactura) {
      msg += `🧾 *FACTURACIÓN FISCAL*\n`;
      msg += `• RIF: ${cliente.rif}\n`;
      msg += `• Razón Social: ${cliente.razonSocial}\n`;
      msg += `_Emitir factura con tasa BCV del día._\n\n`;
    }

    msg += `🛍️ *PRODUCTOS*\n`;
    items.forEach((item, i) => {
      const sub = (item.price * item.qty).toFixed(2);
      msg += `${i + 1}. ${item.name}\n`;
      msg += `   ${item.qty} ${item.unit} × $${item.price.toFixed(2)} = *$${sub}*\n`;
    });
    msg += `\n`;

    msg += `💰 *RESUMEN*\n`;
    if (totalBs) msg += `${totalBs} _(tasa BCV: Bs. ${tasa.toFixed(2)}/$)_\n`;
    msg += `*TOTAL: $${total.toFixed(2)} USD*\n\n`;

    const pasarela = getPasarelaSeleccionada();
    if (pasarela) {
      msg += `💳 *MÉTODO DE PAGO PREFERIDO*\n`;
      msg += `${pasarela.nombre} (${pasarela.moneda})\n`;
      pasarela.datos.forEach(d => { msg += `• ${d.campo}: ${d.valor}\n`; });
      if (pasarela.nota) msg += `_${pasarela.nota}_\n`;
      msg += `\n`;
    }

    msg += `📝 *NOTAS:* ${cliente.notas || 'Ninguna'}\n\n`;

    msg += `━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📅 ${fecha} · 🕐 ${hora}\n`;
    msg += `🌐 ${empresa.sitioWeb || 'aluvima.com.ve'}\n`;
    if (isDemo) msg += `\n⚠️ _MODO DEMO — Pedido de prueba._`;

    return msg;
  }

  // ── Modal: lectura + validación ───────────────────────────
  function readCustomerForm() {
    const get = id => (document.getElementById(id)?.value || '').trim();
    const facturaCheck = document.getElementById('cf-factura');
    return {
      nombre:    get('cf-nombre'),
      telefono:  get('cf-telefono'),
      cedula:    get('cf-cedula'),
      notas:     get('cf-notas'),
      requiereFactura: !!facturaCheck?.checked,
      rif:         get('cf-rif'),
      razonSocial: get('cf-razon'),
    };
  }

  function setFieldError(fieldId, msg) {
    const el = document.querySelector(`.form-error[data-for="${fieldId}"]`);
    const input = document.getElementById(fieldId);
    if (el) el.textContent = msg || '';
    if (input) input.classList.toggle('invalid', !!msg);
  }

  function validarCliente(c) {
    let ok = true;
    setFieldError('cf-nombre', '');
    setFieldError('cf-telefono', '');
    setFieldError('cf-cedula', '');
    setFieldError('cf-rif', '');
    setFieldError('cf-razon', '');

    if (c.nombre.length < 3)         { setFieldError('cf-nombre',    'Ingresa tu nombre.');                  ok = false; }
    if (!validarTelVE(c.telefono))   { setFieldError('cf-telefono',  'Teléfono inválido. Ej: 0424-7247358'); ok = false; }
    // Cédula opcional, pero si se ingresa debe ser válida
    if (c.cedula && window.Customers && !Customers.looksLikeCedula(c.cedula)) {
      setFieldError('cf-cedula', 'Cédula inválida. Ej: V-12345678'); ok = false;
    }
    if (c.requiereFactura) {
      if (!/^[JGVE]-?\d{8,9}-?\d?$/i.test(c.rif.replace(/\s/g,''))) {
        setFieldError('cf-rif', 'RIF inválido. Formato: J-12345678-9'); ok = false;
      }
      if (c.razonSocial.length < 3) {
        setFieldError('cf-razon', 'Razón social obligatoria para factura.'); ok = false;
      }
    }
    return ok;
  }

  function rememberCustomer(c) {
    try { localStorage.setItem(LAST_CUSTOMER_KEY, JSON.stringify(c)); } catch {}
  }

  /** Pre-llena con: 1) cliente logueado, 2) último cliente local */
  function prefillCustomer() {
    let data = {};
    // Prioridad 1: cliente con sesión activa
    if (window.Customers) {
      const c = Customers.current();
      if (c) {
        data = {
          nombre: c.nombre, telefono: c.telefono, cedula: c.cedula,
          rif: c.rif, razonSocial: c.razonSocial,
          requiereFactura: c.requiereFactura,
        };
      }
    }
    // Prioridad 2: último cliente del navegador
    if (!data.nombre) {
      try { data = JSON.parse(localStorage.getItem(LAST_CUSTOMER_KEY) || '{}'); } catch {}
    }
    if (data.nombre)      document.getElementById('cf-nombre').value   = data.nombre;
    if (data.telefono)    document.getElementById('cf-telefono').value = data.telefono;
    if (data.cedula)      document.getElementById('cf-cedula').value   = data.cedula;
    if (data.rif)         document.getElementById('cf-rif').value      = data.rif;
    if (data.razonSocial) document.getElementById('cf-razon').value    = data.razonSocial;
    if (data.requiereFactura) {
      const chk = document.getElementById('cf-factura');
      if (chk) { chk.checked = true; toggleFacturaFields(true); }
    }
  }

  function toggleFacturaFields(show) {
    const row = document.getElementById('cf-factura-fields');
    if (row) row.hidden = !show;
  }

  function renderModalSummary() {
    const summary = document.getElementById('modal-summary');
    if (!summary) return;
    const items   = Cart.getItems();
    const total   = Cart.getTotal();
    const totalBs = formatBs(total);
    const tipoAct = window.Customers ? Customers.currentTipo() : 'publico';
    const tipoLbl = window.Customers?.getTipos()[tipoAct]?.label || 'Público';

    summary.innerHTML = `
      <div class="modal-summary-title">📋 Resumen de tu pedido</div>
      <div class="modal-tier-info">Precios: <strong>${tipoLbl}</strong></div>
      <ul class="modal-summary-list">
        ${items.map(i => `
          <li><span>${i.qty}× ${i.name}</span><strong>$${(i.price * i.qty).toFixed(2)}</strong></li>
        `).join('')}
      </ul>
      <div class="modal-summary-total">
        <span>Total:</span>
        <strong>$${total.toFixed(2)}${totalBs ? ` <small>· ${totalBs}</small>` : ''}</strong>
      </div>
    `;
  }

  // ── Apertura/cierre del modal ──────────────────────────────
  function openModal() {
    const modal = document.getElementById('checkout-modal');
    if (!modal) return;
    if (Cart.getItems().length === 0) {
      if (typeof showToast === 'function') showToast('⚠️ Tu carrito está vacío.', 'error');
      return;
    }
    prefillCustomer();
    renderModalSummary();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('cf-nombre')?.focus(), 100);
    if (window.lucide) window.lucide.createIcons();
  }

  function closeModal() {
    const modal = document.getElementById('checkout-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  // ── Submit → enviar a WhatsApp con PDF adjunto ─────────────
  // PATRÓN: abrir tab inmediatamente con "about:blank" para preservar
  // el gesto de usuario, luego hacer upload async y redirigir el tab.
  function handleSubmit(e) {
    e.preventDefault();
    const cliente = readCustomerForm();
    if (!validarCliente(cliente)) return;

    rememberCustomer(cliente);

    if (window.Customers) {
      try {
        Customers.upsertFromCheckout({
          nombre: cliente.nombre, telefono: cliente.telefono, cedula: cliente.cedula,
          rif: cliente.rif, razonSocial: cliente.razonSocial,
          requiereFactura: cliente.requiereFactura,
        });
      } catch (err) { console.warn('[Checkout] upsert falló:', err); }
    }

    const numero   = generarNumeroPedido();
    const items    = Cart.getItems();
    const total    = Cart.getTotal();
    const pasarela = getPasarelaSeleccionada();
    const tipoCli  = window.Customers?.currentTipo?.() || 'publico';
    const pctTier  = window.Customers?.getPctActual?.() ?? 45;
    const tipoLbl  = window.Customers?.getTipos?.()[tipoCli]?.label || 'Público';

    if (window.Customers) {
      try { Customers.addToSpent(cliente.telefono, total); } catch {}
    }
    _saveOrderToHistory({ numero, cliente, items, total, tipoCli, tipoLbl, pctTier, pasarela });

    // ── Vendedora asignada (o WhatsApp general) ──
    let waDestino = getWhatsApp();
    let vendedora = null;
    let saludo    = '';
    if (window.Customers) {
      vendedora = Customers.getVendedoraForCustomer(Customers.current());
      if (vendedora) {
        waDestino = vendedora.whatsapp;
        saludo    = `Hola *${vendedora.nombre.split(' ')[0]}*, `;
      }
    }

    if (!/^\d{10,15}$/.test(waDestino)) {
      alert(`⚠️ Número de WhatsApp inválido: "${waDestino}"\nRevisa config.js o la vendedora asignada.`);
      return;
    }

    // ── PASO 1: Abrir tab inmediato (preserva user-gesture) ──
    const target  = cfg().checkout?.abrirEnNuevaPestana !== false ? '_blank' : '_self';
    const newTab  = target === '_blank' ? window.open('about:blank', '_blank') : null;
    if (newTab) {
      newTab.document.write(`
        <!doctype html><html><head><meta charset="utf-8"><title>Preparando pedido…</title></head>
        <body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;color:#666;background:#f8f9fa">
          <div style="max-width:380px;margin:auto">
            <div style="font-size:48px;animation:spin 1.5s linear infinite;display:inline-block">⏳</div>
            <h2 style="color:#8B1A2B;margin:18px 0 8px">Preparando tu pedido…</h2>
            <p style="color:#888;font-size:14px">Subiendo el PDF para tu vendedora. Te redirigimos a WhatsApp en un segundo.</p>
          </div>
          <style>@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}</style>
        </body></html>
      `);
    }

    closeModal();
    if (typeof showToast === 'function') showToast(`✅ Pedido ${numero} listo`, 'success', 3000);

    // ── PASO 2 (async): generar PDF, subir, abrir WhatsApp ──
    _processOrderAsync({ numero, cliente, items, total, tipoCli, tipoLbl, pctTier, pasarela, vendedora, saludo, waDestino, newTab, target });

    setTimeout(() => Cart.clear(), 1000);
  }

  /**
   * Genera el PDF, intenta subirlo a file.io, y redirige el tab a WhatsApp.
   * Si no hay internet o falla la subida → solo descarga PDF + WhatsApp con texto.
   */
  async function _processOrderAsync({ numero, cliente, items, total, tipoCli, tipoLbl, pctTier, pasarela, vendedora, saludo, waDestino, newTab, target }) {
    const filename = `Pedido-${numero}.pdf`;
    let pdfBlob = null;
    let pdfUrl  = '';   // link público al PDF subido

    // 1) Generar PDF como blob (sin descargar todavía)
    try {
      pdfBlob = _buildOrderPDF({ numero, cliente, items, total, tipoLbl, pctTier, pasarela, vendedora });
    } catch (err) {
      console.warn('[PDF] generación falló:', err);
    }

    // 2) Intentar subir a file.io (solo si hay http/https — no funciona desde file://)
    if (pdfBlob && location.protocol !== 'file:') {
      try {
        const fd = new FormData();
        fd.append('file', pdfBlob, filename);
        // expires=1d, autoDelete=true (1 descarga y se borra)
        const res = await fetch('https://file.io/?expires=1d', { method: 'POST', body: fd });
        const data = await res.json();
        if (data && data.success && data.link) {
          pdfUrl = data.link;
          console.log('[PDF] Subido a:', pdfUrl);
        }
      } catch (err) {
        console.warn('[PDF] upload a file.io falló:', err);
      }
    }

    // 3) SIEMPRE descargar el PDF local también (por si el upload falló, o como respaldo)
    if (pdfBlob) {
      try {
        const dlUrl = URL.createObjectURL(pdfBlob);
        const a = Object.assign(document.createElement('a'), { href: dlUrl, download: filename });
        a.click();
        setTimeout(() => URL.revokeObjectURL(dlUrl), 1500);
      } catch {}
    }

    // 4) Construir mensaje final con link si está disponible
    const message = buildWhatsAppMessage(items, total, cliente, numero, tipoCli, tipoLbl, pctTier, vendedora, saludo, filename, pdfUrl);
    const url     = `https://wa.me/${waDestino}?text=${encodeURIComponent(message)}`;

    // 5) Redirigir el tab ya abierto (preservó user-gesture) a WhatsApp
    if (newTab && !newTab.closed) {
      newTab.location.href = url;
    } else if (target === '_self') {
      window.location.href = url;
    } else {
      // Último recurso: intentar abrir nueva ventana (puede fallar por popup-blocker)
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  /** Genera PDF y lo devuelve como Blob (no descarga aquí) */
  function _buildOrderPDF(data) {
    if (!window.jspdf?.jsPDF) throw new Error('jsPDF no cargado');
    const { jsPDF } = window.jspdf;
    const doc = _renderPDFContent(new jsPDF({ unit: 'mm', format: 'a4' }), data);
    return doc.output('blob');
  }

  // ════════════════════════════════════════════════════
  //  GENERADOR DE PDF (jsPDF)
  // ════════════════════════════════════════════════════
  /** Renderiza el contenido del PDF sobre un doc jsPDF existente (no descarga) */
  function _renderPDFContent(doc, { numero, cliente, items, total, tipoLbl, pctTier, pasarela, vendedora }) {
    const W   = 210;       // ancho A4 en mm
    let y     = 18;
    const cfgE  = cfg().empresa || {};
    const tasa  = getTasa();
    const totalBs = formatBs(total);
    const now   = new Date();
    const fecha = now.toLocaleDateString('es-VE', { day:'2-digit', month:'long', year:'numeric' });
    const hora  = now.toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit' });

    // ── Header con marca ──
    doc.setFillColor(139, 26, 43);              // crimson
    doc.rect(0, 0, W, 24, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text((cfgE.nombre || 'Aluvima').toUpperCase(), 14, 15);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(cfgE.eslogan || '', 14, 20);

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`PEDIDO ${numero}`, W - 14, 15, { align: 'right' });

    // ── Datos de la empresa (derecha bajo header) ──
    y = 32;
    doc.setTextColor(80);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    if (cfgE.rif)       doc.text(`RIF: ${cfgE.rif}`, W - 14, y, { align:'right' });
    if (cfgE.direccion) doc.text(cfgE.direccion, W - 14, y + 4, { align:'right' });
    if (cfgE.ciudad)    doc.text(cfgE.ciudad, W - 14, y + 8, { align:'right' });

    // ── Datos del pedido (izquierda) ──
    doc.setTextColor(50);
    doc.setFontSize(9);
    doc.text(`Fecha: ${fecha} · ${hora}`, 14, y);
    if (vendedora) {
      doc.setFont('helvetica', 'bold');
      doc.text(`Vendedora: ${vendedora.nombre}`, 14, y + 5);
      doc.setFont('helvetica', 'normal');
    }

    y = 50;
    _drawSectionTitle(doc, 'DATOS DEL CLIENTE', y);
    y += 7;
    doc.setFontSize(10);
    doc.setTextColor(30);
    doc.text(`Nombre: ${cliente.nombre}`, 14, y); y += 5;
    doc.text(`Teléfono: ${cliente.telefono}`, 14, y); y += 5;
    if (cliente.cedula) { doc.text(`Cédula: ${cliente.cedula}`, 14, y); y += 5; }

    const pctTxt = pctTier > 0 ? `+${pctTier}%` : `${pctTier}%`;
    doc.text(`Tipo de cliente: ${tipoLbl} (${pctTxt} sobre base)`, 14, y); y += 5;

    if (cliente.requiereFactura) {
      y += 3;
      _drawSectionTitle(doc, 'FACTURACIÓN FISCAL', y);
      y += 7;
      doc.text(`RIF: ${cliente.rif}`, 14, y); y += 5;
      doc.text(`Razón Social: ${cliente.razonSocial}`, 14, y); y += 5;
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(120);
      doc.text('Factura a emitir con tasa BCV oficial del día.', 14, y); y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30);
    }

    // ── Tabla de productos ──
    y += 5;
    _drawSectionTitle(doc, 'PRODUCTOS', y);
    y += 7;

    // Header tabla
    doc.setFillColor(245, 247, 250);
    doc.rect(14, y - 5, W - 28, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(50);
    doc.text('Producto', 16, y);
    doc.text('Cant.', 130, y, { align:'right' });
    doc.text('Precio', 160, y, { align:'right' });
    doc.text('Subtotal', W - 16, y, { align:'right' });
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    items.forEach((it, i) => {
      // Salto de página simple si nos pasamos
      if (y > 250) { doc.addPage(); y = 20; }
      if (i % 2 === 1) {
        doc.setFillColor(252, 252, 252);
        doc.rect(14, y - 4, W - 28, 7, 'F');
      }
      const name = it.name.length > 55 ? it.name.slice(0, 52) + '…' : it.name;
      doc.text(name, 16, y);
      doc.text(`${it.qty} ${it.unit || ''}`, 130, y, { align:'right' });
      doc.text(`$${it.price.toFixed(2)}`, 160, y, { align:'right' });
      doc.text(`$${(it.price * it.qty).toFixed(2)}`, W - 16, y, { align:'right' });
      y += 7;
    });

    // ── Total ──
    y += 4;
    doc.setDrawColor(139, 26, 43);
    doc.setLineWidth(0.5);
    doc.line(14, y, W - 14, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(50);
    if (totalBs && tasa) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`${totalBs}  (tasa BCV: Bs. ${tasa.toFixed(2)}/$)`, W - 16, y, { align:'right' });
      y += 6;
    }
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(139, 26, 43);
    doc.text(`TOTAL: $${total.toFixed(2)} USD`, W - 16, y, { align:'right' });
    y += 10;

    // ── Método de pago ──
    if (pasarela) {
      doc.setTextColor(50);
      doc.setFontSize(10);
      _drawSectionTitle(doc, 'MÉTODO DE PAGO PREFERIDO', y);
      y += 7;
      doc.setFont('helvetica', 'bold');
      doc.text(`${pasarela.nombre} (${pasarela.moneda})`, 14, y); y += 5;
      doc.setFont('helvetica', 'normal');
      (pasarela.datos || []).forEach(d => {
        doc.text(`${d.campo}: ${d.valor}`, 14, y); y += 4.5;
      });
    }

    // ── Notas ──
    if (cliente.notas) {
      y += 5;
      _drawSectionTitle(doc, 'NOTAS', y);
      y += 7;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(80);
      const lines = doc.splitTextToSize(cliente.notas, W - 28);
      doc.text(lines, 14, y);
      y += lines.length * 4.5;
    }

    // ── Footer ──
    doc.setTextColor(160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Generado en ${cfgE.sitioWeb || ''} · ${now.toLocaleString('es-VE')}`, 14, 290);
    doc.text(`Pedido ${numero}`, W - 14, 290, { align:'right' });

    return doc;
  }

  function _drawSectionTitle(doc, title, y) {
    doc.setFillColor(139, 26, 43);
    doc.rect(14, y - 4, 4, 5, 'F');                // bullet rojo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(139, 26, 43);
    doc.text(title, 20, y);
    doc.setTextColor(50);
  }

  // ── Guardar historial de pedidos (para admin.html) ─────────
  function _saveOrderToHistory({ numero, cliente, items, total, tipoCli, tipoLbl, pctTier, pasarela }) {
    try {
      const orders = JSON.parse(localStorage.getItem('aluvima_orders') || '[]');
      orders.push({
        id:           `o-${Date.now()}`,
        numero,
        cliente:      cliente.nombre,
        telefono:     cliente.telefono,
        nota:         cliente.notas || '',
        requiereFactura: !!cliente.requiereFactura,
        rif:          cliente.rif || '',
        razonSocial:  cliente.razonSocial || '',
        tipoCliente:  tipoCli || 'publico',
        tipoLabel:    tipoLbl || 'Público',
        pctTier:      pctTier ?? 45,
        fecha:        new Date().toISOString(),
        total,
        metodoPago:   pasarela?.nombre || '',
        metodoPagoId: pasarela?.id || '',
        estado:       'nuevo',
        items:        items.map(it => ({
          name:      it.name,
          qty:       it.qty,
          basePrice: it.basePrice ?? it.price,
          price:     it.price,
          subtotal:  +(it.price * it.qty).toFixed(2),
        })),
      });
      if (orders.length > 1000) orders.splice(0, orders.length - 1000);
      localStorage.setItem('aluvima_orders', JSON.stringify(orders));
    } catch (_e) { /* fail silently */ }
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const checkoutBtn = document.getElementById('checkout-btn');
    const modalClose  = document.getElementById('checkout-modal-close');
    const modalCancel = document.getElementById('checkout-modal-cancel');
    const form        = document.getElementById('checkout-form');
    const facturaChk  = document.getElementById('cf-factura');
    const overlay     = document.getElementById('checkout-modal');

    if (checkoutBtn) checkoutBtn.addEventListener('click', () => { window.closeCartPanel?.(); openModal(); });
    if (modalClose)  modalClose.addEventListener('click', closeModal);
    if (modalCancel) modalCancel.addEventListener('click', closeModal);
    if (form)        form.addEventListener('submit', handleSubmit);
    if (facturaChk)  facturaChk.addEventListener('change', e => toggleFacturaFields(e.target.checked));
    if (overlay)     overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('checkout-modal');
        if (modal && !modal.hidden) closeModal();
      }
    });
  }

  return { init, openModal, closeModal };
})();
