// Network first, falls back to the last saved copy when offline
var CACHE = "daligo-v1";
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function(e){
  var r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(function(res){
    var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(r, copy); }); return res;
  }).catch(function(){ return caches.match(r); }));
});
