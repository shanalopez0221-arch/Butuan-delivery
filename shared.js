// ===== Edit these =====
var CONFIG = {
  adminEmail: "shanalopez0221@gmail.com",   // the only account that can see all bookings
  baseFare: 0, includedKm: 0, perKm: 50,   // fare = km x perKm (+ item size fee)
  firebase: {
    apiKey: "AIzaSyCWyH0IcE6uZgzsToisEeom2l8SkbQjYa0",
    authDomain: "butuan-delivery.firebaseapp.com",
    projectId: "butuan-delivery",
    storageBucket: "butuan-delivery.firebasestorage.app",
    messagingSenderId: "662503139863",
    appId: "1:662503139863:web:f400a69cf41be256ff4a52"
  }
};
// ======================
firebase.initializeApp(CONFIG.firebase);
var db = firebase.firestore();
var col = db.collection("bookings");
var auth = firebase.auth();
var $ = function(i){ return document.getElementById(i); };
var LABEL = { new: "Waiting for rider", assigned: "Rider assigned", picked_up: "Picked up", delivered: "Delivered" };
var user = null, unsubs = {};
function el(tag, text, cls){ var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function stop(k){ if (unsubs[k]){ unsubs[k](); unsubs[k] = null; } }
function isAdmin(){ return user && user.email.toLowerCase() === CONFIG.adminEmail.toLowerCase(); }

// Sign-in bar used by all three apps. cb(user) runs whenever someone signs in or out.
function startAuth(cb){
  $("login").addEventListener("submit", function(e){
    e.preventDefault(); $("lmsg").textContent = "";
    auth.signInWithEmailAndPassword($("em").value.trim(), $("pw").value).then(function(){ $("pw").value = ""; })
      .catch(function(){ $("lmsg").textContent = "Wrong email or password."; });
  });
  $("out").onclick = function(){ auth.signOut(); };
  auth.onAuthStateChanged(function(u){
    Object.keys(unsubs).forEach(stop);
    user = u;
    $("login").classList.toggle("hide", !!u);
    $("who").classList.toggle("hide", !u);
    if (u) $("whotxt").textContent = "Signed in as " + u.email + ". ";
    cb(u);
  });
}

function squeeze(file, max, q){
  return new Promise(function(ok, no){
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function(){
      var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      ok(c.toDataURL("image/jpeg", q));
    };
    img.onerror = no; img.src = u;
  });
}
function proofBtn(text, field, status, d){
  var l = el("label", null, "sm"), t = el("span", text), f = el("input");
  l.style.display = "inline-block"; f.type = "file"; f.accept = "image/*"; f.setAttribute("capture", "environment"); f.hidden = true;
  f.onchange = function(){
    if (!f.files[0]) return; t.textContent = "Uploading…";
    squeeze(f.files[0], 720, 0.6).then(function(url){ var u = { status: status }; u[field] = url; return d.ref.update(u); })
      .catch(function(){ t.textContent = "Upload failed. Tap to try again."; });
  };
  l.appendChild(t); l.appendChild(f); return l;
}
function ts(d){ var t = d.data().createdAt; return t ? t.toMillis() : Infinity; }
// ---- job cards (admin and rider) ----
function card(d, mode){
  var b = d.data(), c = el("div", null, "box job");
  c.appendChild(el("b", b.pickup + " to " + b.dropoff));
  var s = el("p"); s.appendChild(el("span", LABEL[b.status] || b.status, "st")); c.appendChild(s);
  var pr = el("div", null, "prog"), n = ["new", "assigned", "picked_up", "delivered"].indexOf(b.status) + 1;
  for (var k = 0; k < 4; k++) pr.appendChild(el("i", null, k < n ? "on" : ""));
  c.appendChild(pr);
  c.appendChild(el("p", (b.cat ? b.cat + " · " : "") + "₱" + b.fare + " · " + b.pay + " · " + b.size + " · " + b.km + " km"));
  var ph = el("p"); var a = el("a", b.name + " " + b.phone); a.href = "tel:" + b.phone; ph.appendChild(a); c.appendChild(ph);
  var url = null;
  if (b.puLat != null && b.doLat != null) url = "https://www.google.com/maps/dir/?api=1&origin=" + b.puLat + "," + b.puLng + "&destination=" + b.doLat + "," + b.doLng;
  else if (b.puLat != null) url = "https://www.google.com/maps/search/?api=1&query=" + b.puLat + "," + b.puLng;
  if (url){ var mp = el("p"), ma = el("a", b.doLat != null ? "Open route in Maps" : "Open pickup in Maps"); ma.href = url; ma.target = "_blank"; ma.rel = "noopener"; mp.appendChild(ma); c.appendChild(mp); }
  if (mode === "admin" && b.riderLat != null){ var lp = el("p"), la = el("a", "Rider live location"); la.href = "https://www.google.com/maps/search/?api=1&query=" + b.riderLat + "," + b.riderLng; la.target = "_blank"; la.rel = "noopener"; lp.appendChild(la); c.appendChild(lp); }
  [["pickupPhoto", "Pickup proof"], ["deliveryPhoto", "Delivery proof"]].forEach(function(p){
    if (b[p[0]]){ c.appendChild(el("p", p[1], "hint")); var im = el("img", null, "proof"); im.src = b[p[0]]; im.alt = p[1]; c.appendChild(im); }
  });
  if (b.note) c.appendChild(el("p", "Note: " + b.note, "hint"));
  if (mode === "admin"){
    if (b.status === "new" || b.status === "assigned"){
      var i = el("input"); i.type = "email"; i.placeholder = "Rider email"; i.setAttribute("list", "riderlist"); i.value = b.riderEmail || ""; c.appendChild(i);
      var g = el("button", b.riderEmail ? "Change rider" : "Assign rider", "sm"); g.type = "button";
      g.onclick = function(){ var r = i.value.trim().toLowerCase(), f = (window.RIDERS || {})[r] || {}; if (r) d.ref.update({ riderEmail: r, riderName: f.name || "", riderPhone: f.phone || "", status: "assigned" }); };
      c.appendChild(g);
    } else if (b.riderEmail) c.appendChild(el("p", "Rider: " + b.riderEmail));
  } else if (mode === "rider") {
    if (b.status === "assigned") c.appendChild(proofBtn("Take pickup photo", "pickupPhoto", "picked_up", d));
    else if (b.status === "picked_up") c.appendChild(proofBtn("Take delivery photo", "deliveryPhoto", "delivered", d));
  }
  if (mode === "customer" && (b.status === "assigned" || b.status === "picked_up") && window.openTrack){
    var tb = el("button", "Track rider", "sm"); tb.type = "button"; tb.onclick = function(){ openTrack(d.id); }; c.appendChild(tb);
  }
  return c;
}
function draw(box, snap, mode, empty){
  box.textContent = ""; box.classList.remove("box", "err");
  var n = 0;
  snap.forEach(function(d){ if (mode === "rider" && d.data().status === "delivered") return; box.appendChild(card(d, mode)); n++; });
  if (!n) box.appendChild(el("p", empty, "box hint"));
}
function fail(box){ return function(){ box.textContent = "Could not load jobs. Check your internet and Firebase rules."; box.classList.add("box", "err"); }; }


// Shrink a photo until it fits under limit characters (keeps documents readable)
function squeezeTo(file, limit, i){
  i = i || 0; var t = [[900, 0.65], [800, 0.55], [700, 0.45], [600, 0.4]][i];
  return squeeze(file, t[0], t[1]).then(function(u){ return (u.length <= limit || i >= 3) ? u : squeezeTo(file, limit, i + 1); });
}
// Tap any photo to enlarge it, tap again to shrink
document.addEventListener("click", function(e){ if (e.target.classList && e.target.classList.contains("proof")) e.target.classList.toggle("big"); });

// Lets the apps be installed on a phone
if ("serviceWorker" in navigator) window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
