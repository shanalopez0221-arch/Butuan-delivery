const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v1/https');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const CONFIG = {
  adminEmail: 'shanalopez0221@gmail.com',
  platformFeeRate: 0.20,
  riderMinWallet: 300
};

function send(res, code, body) {
  res.status(code).set('Content-Type', 'application/json').send(JSON.stringify(body));
}
function cors(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return true; }
  return false;
}
async function requireUser(req) {
  const h = req.get('authorization') || '';
  if (!h.startsWith('Bearer ')) throw new Error('Sign-in required.');
  return admin.auth().verifyIdToken(h.slice(7));
}
function money(n) { return Math.max(0, Math.round(Number(n) || 0)); }
function fee(fare) { return Math.max(0, Math.round(money(fare) * CONFIG.platformFeeRate)); }
function earnings(fare) { return Math.max(0, money(fare) - fee(fare)); }
async function paymongo(path, body, idempotencyKey) {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error('PAYMONGO_SECRET_KEY is not configured on the server.');
  const headers = {
    'Authorization': 'Basic ' + Buffer.from(key + ':').toString('base64'),
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const r = await fetch('https://api.paymongo.com' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('PayMongo error', r.status, j && j.errors ? j.errors.map(x => x.code || x.detail) : r.statusText);
    throw new Error('Payment checkout could not be created. Please try again.');
  }
  return j;
}

exports.createCheckout = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
    const token = await requireUser(req);
    const body = req.body || {};
    const kind = body.kind;
    const amount = money(body.amount);
    if (amount < 1 || amount > 100000) return send(res, 400, { error: 'Invalid payment amount.' });

    let referenceNumber = '';
    let description = '';
    let metadata = {};
    let billing = { email: token.email || undefined };

    if (kind === 'rider_topup') {
      if (amount < CONFIG.riderMinWallet) return send(res, 400, { error: 'Minimum rider wallet top-up is ₱' + CONFIG.riderMinWallet + '.' });
      const riderRef = db.collection('riders').doc(token.uid);
      const riderSnap = await riderRef.get();
      if (!riderSnap.exists || riderSnap.data().status !== 'approved') return send(res, 403, { error: 'Only approved riders can top up their wallet.' });
      const r = riderSnap.data();
      const topupRef = db.collection('walletTopups').doc();
      referenceNumber = 'DALIGO-TU-' + topupRef.id;
      description = 'DALIGO rider wallet top-up';
      metadata = { kind: 'rider_wallet_topup', walletTopupId: topupRef.id, riderUid: token.uid };
      billing = { name: r.name || undefined, email: r.email || token.email || undefined, phone: r.phone || undefined };
      await topupRef.set({
        riderUid: token.uid, riderEmail: token.email || '', riderName: r.name || '', amount,
        status: 'pending', paymentStatus: 'pending', referenceNumber, provider: 'paymongo',
        createdAt: FieldValue.serverTimestamp()
      });
    } else if (kind === 'booking') {
      const bookingId = String(body.bookingId || '');
      if (!bookingId) return send(res, 400, { error: 'Booking ID is required.' });
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) return send(res, 404, { error: 'Booking not found.' });
      const b = bookingSnap.data();
      if (b.customerUid !== token.uid) return send(res, 403, { error: 'Not your booking.' });
      if (b.pay !== 'GCash') return send(res, 400, { error: 'This booking does not use GCash.' });
      if (b.paymentStatus === 'paid') return send(res, 409, { error: 'This booking is already paid.' });
      if (amount !== money(b.fare)) return send(res, 400, { error: 'Payment amount does not match the booking.' });
      referenceNumber = 'DALIGO-BOOK-' + bookingId;
      description = 'DALIGO delivery booking ' + bookingId;
      metadata = { kind: 'booking', bookingId, customerUid: token.uid };
      billing = { name: b.name || undefined, email: token.email || undefined, phone: b.phone || undefined };
    } else {
      return send(res, 400, { error: 'Unknown checkout type.' });
    }

    const successUrl = String(body.successUrl || 'https://example.com/');
    const cancelUrl = String(body.cancelUrl || successUrl);
    const session = await paymongo('/v2/checkout_sessions', {
      data: { attributes: {
        line_items: [{ name: description, amount: amount * 100, currency: 'PHP', quantity: 1 }],
        payment_method_types: ['gcash'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        reference_number: referenceNumber,
        description,
        metadata,
        billing,
        send_email_receipt: false
      }}
    }, referenceNumber);
    const a = session.data.attributes;
    if (kind === 'rider_topup') {
      await db.collection('walletTopups').doc(metadata.walletTopupId).update({
        checkoutSessionId: session.data.id, checkoutUrl: a.checkout_url, updatedAt: FieldValue.serverTimestamp()
      });
    } else {
      await db.collection('bookings').doc(metadata.bookingId).update({
        paymentProvider: 'paymongo', paymentSessionId: session.data.id, paymentReference: referenceNumber,
        paymentStatus: 'pending', updatedAt: FieldValue.serverTimestamp()
      });
    }
    return send(res, 200, { checkoutUrl: a.checkout_url, sessionId: session.data.id });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message || 'Could not create checkout.' });
  }
});

exports.assignRider = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
    const token = await requireUser(req);
    if ((token.email || '').toLowerCase() !== CONFIG.adminEmail.toLowerCase()) return send(res, 403, { error: 'Admin access required.' });
    const { bookingId, riderUid, riderEmail } = req.body || {};
    if (!bookingId || !riderUid || !riderEmail) return send(res, 400, { error: 'Booking and rider are required.' });
    const bookingRef = db.collection('bookings').doc(String(bookingId));
    const riderRef = db.collection('riders').doc(String(riderUid));
    await db.runTransaction(async tx => {
      const [bs, rs] = await Promise.all([tx.get(bookingRef), tx.get(riderRef)]);
      if (!bs.exists || !rs.exists) throw new Error('Booking or rider not found.');
      const b = bs.data(), r = rs.data();
      if (!['new', 'assigned'].includes(b.status)) throw new Error('This booking is no longer available for assignment.');
      if (r.status !== 'approved') throw new Error('Rider is not approved.');
      if (b.pay === 'GCash' && b.paymentStatus !== 'paid') throw new Error('GCash booking must be paid before a rider can be assigned.');
      const w = money(r.walletBalance);
      if (b.pay === 'Cash' && w < CONFIG.riderMinWallet) throw new Error('Rider needs at least ₱' + CONFIG.riderMinWallet + ' in DALIGO wallet for cash jobs.');
      const f = fee(b.fare);
      tx.update(bookingRef, {
        riderUid: riderUid, riderEmail: String(riderEmail).toLowerCase(), riderName: r.name || '', riderPhone: r.phone || '',
        riderGcash: r.gcash || '', status: 'assigned', platformFee: f, riderEarnings: earnings(b.fare),
        settlementStatus: 'pending', updatedAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e); return send(res, 400, { error: e.message || 'Could not assign rider.' });
  }
});

exports.markPickedUp = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
    const token = await requireUser(req);
    const { bookingId, photoUrl } = req.body || {};
    if (!bookingId) return send(res, 400, { error: 'Booking ID is required.' });
    const bookingRef = db.collection('bookings').doc(String(bookingId));
    const snap = await bookingRef.get();
    if (!snap.exists) return send(res, 404, { error: 'Booking not found.' });
    const b = snap.data();
    if (b.riderUid !== token.uid && String(b.riderEmail || '').toLowerCase() !== String(token.email || '').toLowerCase()) return send(res, 403, { error: 'This booking is not assigned to you.' });
    if (b.status !== 'assigned') return send(res, 400, { error: 'This booking is not waiting for pickup.' });
    if (b.pay === 'GCash' && b.paymentStatus !== 'paid') return send(res, 400, { error: 'Payment has not been confirmed yet.' });
    await bookingRef.update({ status: 'picked_up', pickupPhoto: String(photoUrl || ''), pickedUpAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return send(res, 200, { ok: true });
  } catch (e) { console.error(e); return send(res, 400, { error: e.message || 'Could not mark pickup.' }); }
});

exports.completeDelivery = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
    const token = await requireUser(req);
    const { bookingId, photoUrl, photoField } = req.body || {};
    if (!bookingId) return send(res, 400, { error: 'Booking ID is required.' });
    const bookingRef = db.collection('bookings').doc(String(bookingId));
    const riderRef = db.collection('riders').doc(token.uid);
    await db.runTransaction(async tx => {
      const [bs, rs] = await Promise.all([tx.get(bookingRef), tx.get(riderRef)]);
      if (!bs.exists || !rs.exists) throw new Error('Booking or rider not found.');
      const b = bs.data(), r = rs.data();
      if (b.riderUid !== token.uid && String(b.riderEmail || '').toLowerCase() !== String(token.email || '').toLowerCase()) throw new Error('This booking is not assigned to you.');
      if (b.status !== 'picked_up') throw new Error('The delivery must be picked up before it can be completed.');
      if (b.paymentStatus === 'pending' && b.pay === 'GCash') throw new Error('Payment has not been confirmed yet.');
      const f = fee(b.fare), e = earnings(b.fare);
      const updates = { status: 'delivered', platformFee: f, riderEarnings: e, settlementStatus: 'settled', settledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      if (photoUrl && ['deliveryPhoto'].includes(photoField)) updates[photoField] = String(photoUrl);
      if (b.pay === 'Cash') {
        const old = money(r.walletBalance);
        if (old < f) throw new Error('Your DALIGO wallet has only ₱' + old + '. Please top up at least ₱' + f + ' before completing this cash delivery.');
        tx.update(riderRef, { walletBalance: old - f, walletUpdatedAt: FieldValue.serverTimestamp() });
        tx.set(db.collection('walletLedger').doc(), {
          riderUid: token.uid, type: 'cash_commission', direction: 'debit', amount: f, balanceBefore: old, balanceAfter: old - f,
          bookingId: bookingRef.id, description: 'DALIGO platform fee for cash delivery', createdAt: FieldValue.serverTimestamp()
        });
      }
      tx.update(bookingRef, updates);
      tx.set(db.collection('platformRevenue').doc(), {
        bookingId: bookingRef.id, riderUid: token.uid, riderEmail: token.email || '', amount: f,
        paymentMethod: b.pay || 'Unknown', source: b.pay === 'Cash' ? 'rider_wallet' : 'paymongo_booking',
        createdAt: FieldValue.serverTimestamp()
      });
      tx.set(db.collection('riderEarnings').doc(), {
        bookingId: bookingRef.id, riderUid: token.uid, amount: e, paymentMethod: b.pay || 'Unknown',
        status: b.pay === 'Cash' ? 'paid_to_rider_cash' : 'payable', createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e); return send(res, 400, { error: e.message || 'Could not complete delivery.' });
  }
});

function verifySignature(rawBody, header, secret, livemode) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(x => x.split('=')));
  const t = parts.t, supplied = livemode ? parts.li : parts.te;
  if (!t || !supplied) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(t) + '.' + rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(supplied, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.paymongoWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  try {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const event = JSON.parse(raw);
    const livemode = !!event?.data?.attributes?.livemode;
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
    if (!verifySignature(raw, req.get('Paymongo-Signature'), secret, livemode)) return send(res, 401, { error: 'Invalid webhook signature.' });
    const eventId = event?.data?.id || '';
    const type = event?.data?.attributes?.type || '';
    if (type !== 'checkout_session.payment.paid') return send(res, 200, { ok: true, ignored: true });
    const session = event?.data?.attributes?.data;
    const a = session?.attributes || {};
    const md = a.metadata || {};
    if (md.kind === 'rider_wallet_topup' && md.walletTopupId && md.riderUid) {
      const topRef = db.collection('walletTopups').doc(md.walletTopupId);
      const riderRef = db.collection('riders').doc(md.riderUid);
      const eventRef = db.collection('paymentWebhookEvents').doc(eventId || crypto.createHash('sha256').update(raw).digest('hex'));
      await db.runTransaction(async tx => {
        const [ev, ts, rs] = await Promise.all([tx.get(eventRef), tx.get(topRef), tx.get(riderRef)]);
        if (ev.exists) return;
        if (!ts.exists || !rs.exists) throw new Error('Top-up or rider not found.');
        const top = ts.data();
        if (top.status !== 'approved') {
          const amount = money(top.amount);
          const old = money(rs.data().walletBalance);
          tx.update(riderRef, { walletBalance: old + amount, walletUpdatedAt: FieldValue.serverTimestamp() });
          tx.update(topRef, { status: 'approved', paymentStatus: 'paid', paidAt: FieldValue.serverTimestamp(), approvedAt: FieldValue.serverTimestamp(), providerPaymentStatus: 'paid' });
          tx.set(db.collection('walletLedger').doc(), {
            riderUid: md.riderUid, type: 'topup', direction: 'credit', amount, balanceBefore: old, balanceAfter: old + amount,
            topupId: topRef.id, description: 'Rider wallet top-up via secure checkout', createdAt: FieldValue.serverTimestamp()
          });
        }
        tx.set(eventRef, { type, createdAt: FieldValue.serverTimestamp() });
      });
    } else if (md.kind === 'booking' && md.bookingId) {
      const bookingRef = db.collection('bookings').doc(md.bookingId);
      const eventRef = db.collection('paymentWebhookEvents').doc(eventId || crypto.createHash('sha256').update(raw).digest('hex'));
      await db.runTransaction(async tx => {
        const [ev, bs] = await Promise.all([tx.get(eventRef), tx.get(bookingRef)]);
        if (ev.exists) return;
        if (!bs.exists) throw new Error('Booking not found.');
        tx.update(bookingRef, { paymentStatus: 'paid', paymentPaidAt: FieldValue.serverTimestamp(), providerPaymentStatus: 'paid', updatedAt: FieldValue.serverTimestamp() });
        tx.set(eventRef, { type, createdAt: FieldValue.serverTimestamp() });
      });
    }
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e); return send(res, 500, { error: 'Webhook processing failed.' });
  }
});
