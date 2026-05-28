/* ════════════════════════════════════════════════════════════════════════
   ALUVIMA MÉRIDA 2.0 — ARCHIVO DE CONFIGURACIÓN EDITABLE
   ────────────────────────────────────────────────────────────────────────
   👉 ESTE ES EL ÚNICO ARCHIVO QUE DEBES EDITAR PARA CAMBIAR:
        • Datos del negocio (nombre, RIF, dirección, contacto)
        • Tasa de cambio del día ($ → Bs.)
        • Pasarelas de pago (Pago Móvil, Zelle, Binance, etc.)
        • Ubicación de Google Maps
        • Redes sociales

   No hace falta tocar el HTML ni el CSS. Cambia los valores entre
   comillas, guarda, refresca el navegador y listo.
   ════════════════════════════════════════════════════════════════════════ */

const ALUVIMA_CONFIG = {

  /* ─── 1. DATOS DE LA EMPRESA ─── */
  empresa: {
    nombre:    "Aluvima Mérida",
    eslogan:   "Modernizando espacios con calidad y categoría",
    rif:       "J-XXXXXXXXX-X",                      // ← pon tu RIF aquí
    direccion: "Sector El Caucho, Av. Los Próceres",
    ciudad:    "Mérida, Venezuela",
    horario:   "Lun–Vie: 7:30 AM – 12:00 PM · 1:00 PM – 4:00 PM",
    sitioWeb:  "aluvima.com.ve",
  },

  /* ─── 2. CONTACTO ─── */
  contacto: {
    whatsapp:  "584147126441",                       // ← NÚMERO DE PRUEBA (cambiar al real en producción)
    telefono1: "0424-724 7358",
    telefono2: "0274-416 0252",
    email:     "ventas@aluvimamerida.com",
    instagram: "https://instagram.com/aluvimamerida",
    facebook:  "https://facebook.com/aluvimamerida",
  },

  /* ─── 3. TASA DE CAMBIO USD → BS ───
     Actualiza valorPorDefecto cada mañana con la tasa Binance P2P del día.
     mostrarEnWeb: true → muestra el banner verde arriba del header. */
  tasaCambio: {
    modo:             "manual",                       // 'manual' | 'api-binance' | 'api-bcv' (futuro)
    valorPorDefecto:  90.00,                          // ← Bs. por cada $1 (ACTUALIZA CADA DÍA)
    fechaActualizada: "2026-05-14",                   // formato YYYY-MM-DD
    mostrarEnWeb:     true,                           // mostrar el banner
    mostrarEnProductos: true,                         // mostrar precio en Bs bajo cada producto
    mostrarEnCarrito:   true,                         // mostrar total en Bs en el carrito
  },

  /* ─── 4. GOOGLE MAPS ─── */
  mapa: {
    consulta: "Sector El Caucho, Av. Los Próceres, Mérida, Venezuela",
    zoom:     16,
  },

  /* ─── 5. PASARELAS DE PAGO — VENEZUELA 🇻🇪 ───
     Activa/desactiva con `activo: true|false`.
     Las pasarelas inactivas no salen ni en el grid de pagos ni en el selector del checkout. */
  pasarelas: [

    {
      id:        "pago-movil",
      nombre:    "Pago Móvil",
      moneda:    "Bs",
      icono:     "smartphone",
      color:     "#0066B3",
      activo:    true,
      destacado: true,
      etiqueta:  "Más usado",
      datos: [
        { campo: "Banco",    valor: "Mercantil (0105)" },
        { campo: "Cédula",   valor: "V-XXXXXXXX" },
        { campo: "Teléfono", valor: "0424-7247358" },
      ],
      nota: "Envía el comprobante al WhatsApp para confirmar tu pedido.",
    },

    {
      id:        "zelle",
      nombre:    "Zelle",
      moneda:    "USD",
      icono:     "dollar-sign",
      color:     "#6D1ED4",
      activo:    true,
      destacado: false,
      etiqueta:  "",
      datos: [
        { campo: "Correo",  valor: "pagos@aluvimamerida.com" },
        { campo: "Titular", valor: "Aluvima Mérida C.A." },
      ],
      nota: "Coloca tu nombre y el número de pedido en el concepto.",
    },

    {
      id:        "binance",
      nombre:    "Binance Pay (USDT)",
      moneda:    "USDT",
      icono:     "bitcoin",
      color:     "#F0B90B",
      activo:    true,
      destacado: false,
      etiqueta:  "Cripto",
      datos: [
        { campo: "Pay ID",  valor: "XXXXXXXX" },
        { campo: "Usuario", valor: "@aluvimamerida" },
        { campo: "Red",     valor: "BSC / TRON (USDT)" },
      ],
      nota: "Solo USDT. Verifica la red antes de enviar.",
    },

    {
      id:        "transferencia",
      nombre:    "Transferencia Bancaria",
      moneda:    "Bs",
      icono:     "landmark",
      color:     "#1E3A8A",
      activo:    true,
      destacado: false,
      etiqueta:  "",
      datos: [
        { campo: "Banco",   valor: "Banesco (0134)" },
        { campo: "Cuenta",  valor: "Corriente 0134-XXXX-XX-XXXXXXXXXX" },
        { campo: "Titular", valor: "Aluvima Mérida C.A." },
        { campo: "RIF",     valor: "J-XXXXXXXXX-X" },
      ],
      nota: "Envía el comprobante al WhatsApp con el número de pedido.",
    },

    {
      id:        "efectivo-usd",
      nombre:    "Efectivo USD",
      moneda:    "USD",
      icono:     "banknote",
      color:     "#198754",
      activo:    true,
      destacado: false,
      etiqueta:  "Presencial",
      datos: [
        { campo: "Modalidad", valor: "Pago en sede al retirar" },
        { campo: "Dirección", valor: "Sector El Caucho, Av. Los Próceres" },
      ],
      nota: "Disponible solo en nuestra sala de exhibición en Mérida.",
    },

    {
      id:        "cashea",
      nombre:    "Cashea",
      moneda:    "USD",
      icono:     "credit-card",
      color:     "#FF6B00",
      activo:    false,                                 // ← actívalo cuando ya estén afiliados
      destacado: false,
      etiqueta:  "Cuotas",
      datos: [
        { campo: "Modalidad", valor: "Financiamiento en cuotas sin tarjeta" },
        { campo: "Nivel",     valor: "Consulta tu nivel en la app Cashea" },
      ],
      nota: "Aplica para compras desde $50. Solicita la cotización por WhatsApp.",
    },

  ],

  /* ─── 6. OPCIONES DEL CHECKOUT ─── */
  checkout: {
    prefijoPedido:     "ALV-",                         // así salen las órdenes: ALV-00023
    paddingPedido:     5,                               // dígitos: 5 → 00023
    incluirAvisoDemo:  true,                            // agrega ⚠️ MODO DEMO al mensaje
    abrirEnNuevaPestana: true,
    confirmacionPrevia:  false,                         // false = no muestra el confirm() nativo (mejor UX)
  },

};

// Acceso global (no editar)
window.ALUVIMA_CONFIG = ALUVIMA_CONFIG;
