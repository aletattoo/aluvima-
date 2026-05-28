/**
 * products.js — Loader del catálogo Aluvima 2.0
 * ────────────────────────────────────────────────────────────
 * Antes: este archivo tenía el array PRODUCTS literal (~1.2 MB) y bloqueaba
 * el render inicial hasta que el navegador parseaba todo el JSON-en-JS.
 *
 * Ahora: el array vive en `products.json` y se descarga en paralelo al HTML.
 * El navegador puede pintar la primera vista (hero + nav) mientras llega
 * el catálogo. En cuanto está listo, se dispara el evento `products-loaded`
 * y `main.js` re-renderiza el catálogo.
 *
 * Beneficios:
 *   • TTI ~4-6 s más rápido en 3G/4G venezolano.
 *   • El JSON comprime ~85 % con gzip/brotli (1.2 MB → ~150 KB en el aire).
 *   • Permite cachear con un `Cache-Control: max-age=...` agresivo.
 *
 * Cómo lo consumen los otros módulos:
 *   • Sincrónico:  window.PRODUCTS         (array vacío hasta que esté listo)
 *   • Asíncrono:   await window.PRODUCTS_READY   (Promise<Product[]>)
 *   • Evento:      window.addEventListener('products-loaded', e => …)
 *
 * Para actualizar el catálogo: regenerar products.json desde el admin
 * (Productos → Importar Valery) o reemplazar el archivo manualmente.
 * ──────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // Valor inicial: array vacío para que cualquier acceso síncrono no falle.
  // Una vez resuelto el fetch, se reasigna con el catálogo real.
  window.PRODUCTS = [];

  // Promesa que resuelve con el array cuando el JSON está cargado.
  // El consumidor recomendado es: `await window.PRODUCTS_READY`.
  window.PRODUCTS_READY = (async function loadProducts() {
    const URL = 'js/products.json';
    try {
      const res = await fetch(URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Formato inválido');
      window.PRODUCTS = data;
      window.dispatchEvent(new CustomEvent('products-loaded', { detail: data }));
      return data;
    } catch (err) {
      console.error('[products] No se pudo cargar el catálogo:', err);
      // Emitimos el evento con array vacío para que la UI muestre
      // el estado "catálogo en mantenimiento" en lugar de colgarse.
      window.dispatchEvent(new CustomEvent('products-loaded', { detail: [] }));
      return [];
    }
  })();
})();
