/**
 * censo-sw.js — Service Worker para CensoBolivia App
 * Permite uso offline después de la primera carga con internet.
 * Colocar este archivo en la MISMA carpeta que CensoBolivia_App.html
 */

const CACHE_NAME = 'censo-bolivia-v6';
const CACHE_STATIC = 'censo-static-v6';

// Archivos core de la app (ajustar nombres según tu carpeta)
const APP_SHELL = [
  './CensoBolivia_App.html',
  './datos_comunidades.json',
  './jerarquia.json',
];

// CDNs que cachear para uso offline
const CDN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// ── INSTALL: cachear todo al instalar ─────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Instalando v6...');
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(function(cache) {
        // App shell (archivos locales) — pueden fallar si no existen aún
        return Promise.allSettled(
          APP_SHELL.map(url =>
            cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err.message))
          )
        );
      }),
      caches.open(CACHE_STATIC).then(function(cache) {
        // CDN scripts — solo los que se puedan descargar
        return Promise.allSettled(
          CDN_URLS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] CDN no cacheado:', url))
          )
        );
      })
    ]).then(function() {
      console.log('[SW] Instalación completada');
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: limpiar cachés viejos ───────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CACHE_STATIC)
          .map(k => { console.log('[SW] Eliminando caché viejo:', k); return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH: Cache-First para JSON pesados, Network-First para HTML ──
self.addEventListener('fetch', function(event) {
  const url = event.request.url;

  // Solo interceptar GET
  if (event.request.method !== 'GET') return;

  // Para los JSON grandes (datos del censo): cache-first
  if (url.includes('datos_comunidades.json') || url.includes('jerarquia.json')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) {
          // Actualizar en background si hay red
          fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(function() {
          return new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  // Para CDN scripts: cache-first
  if (CDN_URLS.some(cdn => url.startsWith(cdn.split('/').slice(0,3).join('/') + '/'))) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Para tiles del mapa OSM y Esri: cache-first con límite de 500 tiles
  if (url.includes('tile.openstreetmap.org') || url.includes('arcgisonline.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open('censo-tiles-v1').then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Para el HTML principal: network-first con fallback a caché
  if (url.includes('CensoBolivia_App.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(function() {
        return caches.match(event.request).then(c => c ||
          caches.match('./CensoBolivia_App.html')
        );
      })
    );
    return;
  }

  // Resto: network con fallback a caché
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});

// ── MENSAJE: forzar actualización desde la app ─────────────────────
self.addEventListener('message', function(event) {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
