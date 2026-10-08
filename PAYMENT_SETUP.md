# DALIGO Payment & Rider Wallet Setup

## New payment model

DALIGO now uses three separate money records:

1. **Rider wallet** — an internal DALIGO balance belonging to the rider account. Top-ups increase this balance after a verified payment-gateway webhook.
2. **DALIGO platform revenue** — created only when a delivery is successfully completed. The default platform fee is 20% of the delivery fare.
3. **Rider earnings** — the rider's share of a completed delivery. For cash jobs the rider already holds the cash; for GCash jobs the amount is recorded as payable to the rider.

The customer/rider web app does **not** display or store the owner's personal GCash number.

## Cash booking flow

Example: delivery fare = ₱200.

- Rider must have at least ₱300 in the DALIGO wallet before admin can assign the cash job.
- Customer gives ₱200 cash to the rider.
- DALIGO fee = ₱40 (20%).
- Rider keeps ₱160 as rider earnings.
- At delivery completion, ₱40 is debited from the rider's DALIGO wallet and a `platformRevenue` ledger entry is created.
- Wallet history records the debit and the new balance.

The rider wallet does not disappear when a job is completed. It remains an account balance with a transaction history.

## GCash booking flow

- Customer selects GCash.
- DALIGO creates a hosted payment checkout through the payment gateway.
- The customer pays on the gateway's secure checkout page.
- The booking is not eligible for rider assignment until the verified payment webhook marks it paid.
- At delivery completion, DALIGO records its platform fee as revenue.
- The rider's earnings are recorded separately as payable; the rider wallet is **not** incorrectly debited for a GCash job.

## Rider wallet top-up flow

- Rider enters a top-up amount in the Rider app.
- DALIGO opens a secure GCash checkout page.
- The rider pays through the gateway.
- Only the verified gateway webhook can credit the rider's wallet.
- A `walletLedger` entry records the credit and resulting balance.
- A wallet top-up is **not** counted as DALIGO revenue.

## Production backend

The project now includes Firebase Functions under `functions/`.

Important files:

- `functions/index.js` — payment checkout, payment webhook, secure rider assignment, pickup confirmation, and delivery settlement.
- `functions/.env.example` — environment variable template.
- `firebase.json` — Firebase Functions source configuration.

### 1. Create your PayMongo merchant account

Use a PayMongo merchant account that is eligible for the payment methods you want to accept. GCash is supported through PayMongo's hosted checkout/payment flows.

PayMongo's current Hosted Checkout documentation recommends creating Checkout Sessions from a backend, then redirecting the customer to the returned checkout URL. Payment completion should be confirmed by webhook rather than by trusting the browser redirect. citeturn2search1turn2search3turn3search1

### 2. Configure the server secrets

Copy:

`functions/.env.example` → `functions/.env`

Then put your real PayMongo credentials in `functions/.env`.

Never put the PayMongo secret key in `index.html`, `rider.html`, `admin.html`, `shared.js`, or the Android app.

### 3. Deploy the backend

From the DALIGO project root:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

The important endpoints are:

- `createCheckout`
- `assignRider`
- `markPickedUp`
- `completeDelivery`
- `paymongoWebhook`

### 4. Register the PayMongo webhook

In PayMongo Developer Tools → Webhooks, create an HTTPS webhook endpoint:

`https://us-central1-butuan-delivery.cloudfunctions.net/paymongoWebhook`

Subscribe to:

`checkout_session.payment.paid`

Copy the webhook signing secret into `functions/.env` as `PAYMONGO_WEBHOOK_SECRET`, then redeploy the functions.

PayMongo signs webhook requests with the `Paymongo-Signature` header. The backend verifies the signature before processing the payment event and uses event IDs to prevent duplicate processing. citeturn3search0turn3search2

### 5. Test before going live

Use PayMongo test mode first. Confirm all of these cases:

- rider top-up → wallet credit
- cash booking → wallet fee debit at delivery
- GCash booking → payment confirmation → rider assignment → delivery → platform revenue
- failed GCash payment → no assignment
- duplicate webhook → no duplicate wallet credit/revenue
- insufficient cash-job wallet → assignment blocked

PayMongo provides test-mode Hosted Checkout and webhook testing tools. citeturn2search7turn3search7

## Important financial/legal note

The rider wallet in this project is implemented as an internal commission/reserve ledger. If DALIGO will allow riders to withdraw wallet balances, transfer balances to other users, or otherwise operate the wallet as a stored-value account, get payment/legal advice and confirm the appropriate regulated product with your payment provider before launch.

Also, do not assume that a personal GCash wallet can be used as the business settlement destination for an app. Use the merchant/payment-provider settlement options available to your verified account.
