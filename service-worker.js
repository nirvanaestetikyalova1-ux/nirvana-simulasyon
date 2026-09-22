// Nirvana Yapay Zeka — basit uygulama kabuğu (app shell) service worker.
// Yalnızca sitenin kendi statik dosyalarını (HTML, manifest, ikonlar) önbelleğe alır;
// Google Gemini API çağrıları, stok fotoğraflar ve font/CDN istekleri her zaman
// doğrudan ağdan (internetten) çekilir — bunlar önbelleğe alınmaz.
var CACHE_NAME = "nirvana-shell-v2";
var SHELL_FILES = [
  "./Nirvana-Once-Sonra-Simulasyon.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./nirvana-logo.svg"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(SHELL_FILES);
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event){
  var req = event.request;
  // Sadece GET ve aynı origin (bu sitenin kendi dosyaları) için önbellek devreye girer.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin){
    return; // diğer her şey (Gemini API, dış görseller, fontlar) doğrudan ağa gider
  }
  event.respondWith(
    caches.match(req).then(function(cached){
      var networkFetch = fetch(req).then(function(res){
        if (res && res.status === 200){
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        }
        return res;
      }).catch(function(){ return cached; });
      // Önce önbellek varsa hızlıca onu göster, arka planda ağdan güncelle (stale-while-revalidate).
      return cached || networkFetch;
    })
  );
});
