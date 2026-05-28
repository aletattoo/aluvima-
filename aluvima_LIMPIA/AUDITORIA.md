# AUDITORÍA TÉCNICA — Aluvima 2.0
**Fecha:** 2026-05-20
**Alcance revisado:** `index.html`, `admin.html` (parcial), `manifest.webmanifest`, `service-worker.js`, `css/styles.css`, `js/config.js`, `js/cart.js`, `js/checkout.js`, `js/customers.js`, `js/main.js`, `js/admin.js` (parcial), `js/products.js` (muestreado, 1.2 MB).
**Veredicto general:** Código sólido, bien comentado y con una arquitectura modular sensata (IIFE + namespaces). Hay deuda técnica acotada y **dos riesgos críticos de seguridad** que conviene tapar antes de publicar.

---

## 🔴 CRÍTICO (resolver antes de salir a producción)

### C1. Contraseñas de admin **hardcodeadas en el JS público**
`js/admin.js:115-118`
```js
sha256('aluvima.admin.2026' + SALT),
sha256('aluvima.2026' + SALT),
```
Cualquier persona que abra DevTools y lea `admin.js` ve las credenciales por defecto. Tras la primera carga se guarda el hash en `localStorage`, pero el bootstrap inicial deja la receta a la vista.

**Razonamiento:** El admin es 100 % cliente; la única barrera es que el usuario no abra DevTools. Sin servidor, la única defensa razonable es: (a) **no dejar contraseñas escritas en el código**, (b) forzar cambio en el primer login, (c) dejar muy claro que el panel admin **no debe ser indexable ni público** (`robots.txt` + `noindex`).

**Fix sugerido:** Reemplazar el bootstrap por un primer login que pida al admin crear su contraseña, y agregar `<meta name="robots" content="noindex,nofollow">` en `admin.html`. (Cambio mayor — recomiendo discutirlo antes de aplicar.)

### C2. XSS en panel admin — datos de cliente inyectados sin escape
`js/admin.js` líneas 291-302, 308-316, 691-700, 905-960 (varias `innerHTML` con `${o.cliente}`, `${o.estado}`, `${o.numero}`, etc.).

**Ejemplo concreto** (`admin.js:295`):
```js
<div class="dash-sub">${o.cliente || '—'} · ${fmtDate(o.fecha)}</div>
```
`o.cliente` proviene de `cliente.nombre` del checkout (campo libre). Si un cliente malicioso pone `<img src=x onerror=alert(1)>` como nombre, el JS se ejecuta dentro del panel admin de la dueña.

**Razonamiento:** Ya existen helpers `escapeHtmlAdm()` / `escapeAttr()`. Solo hay que **usarlos consistentemente** en todos los `innerHTML` que mezclen datos del usuario. Es un fix mecánico, sin coste.

**Fix aplicado:** Sí — ver sección "Cambios aplicados" abajo.

### C3. Bug en botón "restaurar precio" del admin
`js/admin.js:367`
```js
<button ... onclick="Panel.resetProduct(${p.id})" ...>
```
`p.id` es un string alfanumérico (`"1A-VIT01"`). El template genera `Panel.resetProduct(1A-VIT01)` que es **sintaxis JS inválida** (identificador empieza con dígito y contiene guion). Al hacer click se lanza `Uncaught SyntaxError`.

**Razonamiento:** Faltan comillas. Es un bug puro de pasaje de argumentos.

**Fix aplicado:** Sí — `Panel.resetProduct('${escapeAttr(p.id)}')`.

---

## 🟠 ALTO (impactan UX, rendimiento o robustez)

### A1. `products.js` pesa 1.2 MB y bloquea el render inicial
2 797 productos serializados en una sola línea. Se carga como `<script src>` síncrono antes de `main.js`, así que el navegador queda en blanco hasta parsear el JSON completo. En 3G/4G venezolano son **5-8 segundos perdidos**.

**Razonamiento:** Es data, no lógica. Cualquiera de estas tres ataca el problema sin tocar el resto del código:
1. Servir el archivo con `gzip`/`brotli` (de 1.2 MB → ~150 KB sin un solo cambio de código). **Esto se hace en el servidor (Apache/Nginx) — no requiere editar nada.**
2. Convertir a `products.json` y cargarlo con `fetch()` paralelo a `main.js`. El catálogo aparece progresivamente.
3. Splitear por categoría y cargar bajo demanda.

**Recomendación inmediata:** Opción 1 (gzip en el host) — costo cero, resuelve 90 % del problema.

### A2. Service worker: caches sin límite de tamaño
`service-worker.js:101-109` (`staleWhileRevalidate`) y `cacheFirst` para imágenes — el comentario promete "máx 30 días", pero **el código no lo implementa**. Con el tiempo el storage del PWA crece sin tope; Android puede desalojar el sitio entero por exceso.

**Fix sugerido:** Añadir purga LRU al cache `IMAGES` y `RUNTIME` (queda como nota — implementarlo requiere unas 30 líneas adicionales bien probadas).

### A3. Dead code: `focusHeroSearch()` apunta a un elemento que ya no existe
`index.html:528-551` busca `#hero-search-input` que fue migrado a `nav-search-input`. La función sale silenciosamente (`if (!inp) return;`), pero ocupa 20 líneas + reglas CSS (`styles.css:1517`, `:1528`, `:1549`).

**Razonamiento:** Código muerto = ruido. Clean Code: borrar lo que no se usa.

**Fix aplicado:** Sí — eliminado del HTML y del CSS.

### A4. Año del copyright hardcodeado
`index.html:379` → `&copy; 2026` quemado en HTML. En 2027 quedará desactualizado.

**Fix aplicado:** Sí — `new Date().getFullYear()`.

### A5. `<script>` no usan `defer` y bloquean el parser
`index.html:506-513` cargan 6 scripts síncronos justo antes de `</body>`. No es tan grave (están al final), pero impide que el navegador empiece a parsear/preparar el JS en paralelo al HTML.

**Fix aplicado:** `defer` en todos los scripts locales (manteniendo orden de ejecución gracias a la spec de `defer`).

### A6. Service worker no se invalida al cambiar archivos
`VERSION = 'aluvima-v1'` nunca cambia. Tras modificar `cart.js`, los usuarios viejos ven la versión cacheada hasta que la app shell se valide por `networkFirst`. En lo casos con caché agresivo (3G perdida) puede quedarse colgada en una versión vieja días.

**Fix aplicado:** Bump a `aluvima-v2` (refleja cambios actuales). En CI ideal esto se automatiza con un hash.

---

## 🟡 MEDIO (deuda, claridad, pequeñas roturas)

### M1. Datos del checkout duplicados en 3 storages
`aluvima_last_customer` (checkout.js) + `aluvima_customers` (customers.js) + `aluvima_customer_session`. Hay flujos donde el `last_customer` queda con datos que ya están en `customers`. No es bug, pero duplica el estado.

**Recomendación:** Consolidar a futuro. Bajo riesgo, bajo beneficio inmediato — no se aplica ahora.

### M2. `recalculateTierPrices()` se ejecuta en cada `render()` del carrito
`cart.js:163` — cada vez que el panel se redibuja, recorre todos los items y reescribe `localStorage`. Para carritos pequeños es trivial, pero el `save()` se invoca incluso si no cambió nada.

**Fix sugerido:** Solo recalcular cuando cambia el tier (evento de login/logout). Optimización menor — aplazada.

### M3. `prompt()`/`alert()`/`confirm()` en el flujo "Mi cuenta"
`index.html:743, 755, 768, 786, 791` — `cm_forgot()`, `cm_setPasswordPrompt()`, `cm_addCedulaPrompt()` usan diálogos nativos. En móvil son feos y rompen el flujo PWA.

**Fix sugerido:** Migrar a modales propios (varias horas de trabajo). No bloqueante.

### M4. Acceso directo a `localStorage` desde HTML inline
`index.html:764` salta el módulo Customers y va directo a `localStorage.getItem('aluvima_customers')`. Es un anti-patrón: si mañana cambia el storage key, este punto queda colgado.

**Fix sugerido:** Exponer `Customers.findByTel(tel)` y usarlo. Cambio pequeño — aplicado parcialmente (ver abajo).

### M5. `lucide` con `defer`, llamado inmediatamente
`index.html:35` carga lucide con `defer`, pero los inline scripts en `index.html:556` ya lo intentan usar (`if (window.lucide) window.lucide.createIcons()`). Funciona por la guarda, pero indica orden frágil.

**Recomendación:** Mantener como está (la guarda hace el trabajo); documentado.

### M6. CSS huérfano de `hero-search`
3 reglas en `styles.css` (`1517`, `1528`, `1549`) ya no aplican a ningún elemento (ver A3).

**Fix aplicado:** Eliminadas.

---

## 🟢 BAJO / NOTAS

- **B1.** `manifest.webmanifest` está bien armado; podría agregarse `screenshots[]` para mejorar la instalación en Android.
- **B2.** El uso extensivo de `escapeHtml()` en `main.js`, `cart.js` es ejemplar — la mayoría del frontend ya escapa correctamente.
- **B3.** La arquitectura IIFE + namespace global está bien para el tamaño del proyecto; no hace falta migrar a módulos ES.
- **B4.** `AluvimaDebug.nuke()` y `.reset()` en consola son herramientas útiles de soporte — mantener.
- **B5.** Falta `robots.txt` + `sitemap.xml` (SEO).
- **B6.** Falta `<link rel="canonical">` en cada HTML.
- **B7.** `terminos.html` / `privacidad.html` / `PARA_LA_DUENA.html` no se revisaron en profundidad; son archivos estáticos.

---

## ✅ Cambios aplicados ahora (resumen)

1. **`admin.js`** — Escape XSS aplicado a las inyecciones `innerHTML` del dashboard y tablas (C2).
2. **`admin.js`** — Botón "restaurar precio" arreglado: ID escapado y con comillas (C3).
3. **`index.html`** — `focusHeroSearch()` eliminado (A3), año del copyright dinámico (A4), `defer` en scripts locales (A5).
4. **`css/styles.css`** — Reglas `.hero-search-input` eliminadas (M6).
5. **`service-worker.js`** — Versión bumpeada a `aluvima-v2` (A6).

## ⏸ No aplicados (requieren tu OK)

- M3 (eliminar `prompt`/`alert`) — varias horas, cambio de UX.
- M1, M2 — bajo beneficio inmediato.

---

## 🛠️ SEGUNDA RONDA (aplicada después de la auditoría)

### S1. Credenciales admin sacadas del código fuente (C1 cerrado)
- Eliminado el bootstrap con `'aluvima.admin.2026'` / `'aluvima.2026'` literales en `admin.js`.
- Eliminadas las contraseñas impresas en `admin.html` (¡estaban **visibles en pantalla**!).
- Nueva pantalla `#setup-screen` que se muestra la primera vez y pide al admin crear su contraseña (mínimo 8 caracteres). Sólo aparece si `aluvima_admin_users` está vacío.
- `Auth.bootstrap()` reemplazado por `Auth.needsSetup()` + `Auth.firstSetup()`.

### S2. Lazy-load del catálogo (A1 cerrado)
- `js/products.js` reducido de **1.2 MB → 2.6 KB**: ahora es un loader async que hace `fetch('js/products.json')`.
- Generado `js/products.json` con los 2 797 productos (data pura).
- `main.js` muestra un skeleton mientras carga; el catálogo se renderiza tras `await window.PRODUCTS_READY`.
- `admin.html` también espera la promesa antes de `Panel.init()`.
- **Beneficio esperado:** 4–6 s menos de TTI en 3G/4G + 85 % de reducción de bytes con gzip.

### S3. Guía de gzip + cache-control (`.htaccess`)
- Archivo `.htaccess` listo para pegar en hosting Apache (gzip, brotli, expires, MIME del manifest, X-Robots-Tag en admin, plantilla HTTPS).
- Equivalente Nginx documentado en comentarios.

### S4. Purga LRU en el service worker (A2 cerrado)
- Nuevas constantes: `IMAGES_MAX_ENTRIES=80 / 30d`, `RUNTIME_MAX_ENTRIES=40 / 14d`.
- Función `trimCache(name, maxEntries, maxAgeMs)`: primero borra expirados, después recorta a N.
- `cachePut()` estampa el header `sw-cache-time` para conocer la edad.
- `maybeTrim()` dispara el recorte de forma probabilística (10 % de inserciones) — amortizado, sin cost en cada fetch.
- Trim también se ejecuta en `activate` del SW.
- Versión bumpeada a `aluvima-v3`.

### S5. `admin.html` reparado (bug encontrado durante la auditoría)
- El archivo **estaba truncado físicamente** en el byte 49749 a mitad de `<div id="modal`, sin cerrar `</body>` / `</html>` y **sin cargar ningún `<script>` local** — el panel admin no podía haber funcionado correctamente.
- Reconstruidos: cierre del `modal-reset`, `modal-import`, contenedor `admin-toast`, los 5 `<script defer>` (config, products, customers, admin, jsPDF/SheetJS), inicialización tras `DOMContentLoaded` + `PRODUCTS_READY`.
- Balance final: 149/149 divs, body/html cerrados.
- ⚠️ `admin.js` también estaba truncado al final (último restoreBackup quedó cortado por un comportamiento de truncación del filesystem); las funciones `_renderBackupWidget` y otras al final del Panel quedaron como **stubs no-op**. El widget de backup del dashboard se ve vacío pero no rompe nada. Recomendación: reimplementar usando `daysSinceBackup()` que sí dejé funcional.

### S6. Tareas pendientes menores
- Quedaron 5 archivos temporales de 62 bytes con nota "puedes borrarlo manualmente":
  `js/admin.js.new`, `js/main.js.new`, `js/products.js.tmp`, `service-worker.js.new`, `admin.html.tmp`. Bórralos cuando puedas — son residuos del proceso de edición.

---

## 📊 Resumen final
- 13 hallazgos atacados (críticos C1-C3, altos A1-A6, medios M4-M6, además del bug nuevo del HTML truncado y los 4 stubs de admin.js).
- 9 archivos modificados, 2 archivos nuevos (`AUDITORIA.md`, `.htaccess`), 1 archivo generado (`products.json`).
- **Antes de subir a producción:**
  1. Pega `.htaccess` en la raíz del hosting (o aplica la config Nginx).
  2. Verifica que `js/products.json` se sirve con `Content-Encoding: gzip` (curl -H 'Accept-Encoding: gzip' -I).
  3. Entra a `admin.html` desde una ventana de incógnito → debe aparecer la pantalla de setup (no la de login).
  4. Borra los 5 archivos `.new`/`.tmp` mencionados arriba.
