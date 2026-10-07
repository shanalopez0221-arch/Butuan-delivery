# DALIGO Payment & Revenue Update

## Payment/Revenue logic

- Owner GCash settlement/top-up number: **09066483582**
- Default DALIGO platform fee: **20% of completed delivery fare**
- Rider minimum wallet for CASH bookings: **₱300**
- CASH booking:
  1. Rider must have at least ₱300 in the DALIGO wallet before admin can assign the booking.
  2. Customer pays the rider in cash.
  3. When delivery is completed, the DALIGO platform fee is deducted from the rider wallet.
  4. The platform fee is recorded in `platformRevenue`.
- GCash booking:
  1. Customer pays the rider's registered GCash number.
  2. The rider must have enough wallet balance to reserve the DALIGO platform fee.
  3. When delivery is completed, the platform fee is deducted from the rider wallet and recorded in `platformRevenue`.
- Rider wallet top-up:
  1. Rider sends money to **09066483582**.
  2. Rider enters the amount and GCash reference in the Rider app.
  3. Admin verifies and approves the request.
  4. The rider wallet is credited.

## Important limitation

This project is still a Firebase/HTML client application. It cannot directly move money from one GCash account to another just because a GCash number is stored in JavaScript. The owner GCash number is used as the manual top-up/settlement destination, while the app records the platform revenue.

For fully automatic customer GCash collection and automatic settlement, DALIGO needs a supported payment gateway/merchant integration and a secure backend/server-side payment verification flow. Do not put payment-gateway secret keys in `index.html`, `rider.html`, or `admin.html`.

## Production security

The wallet deduction and revenue ledger should ultimately be moved to trusted server-side code (for example Firebase Cloud Functions) and protected by Firestore Security Rules. Otherwise a malicious client could attempt to modify wallet/revenue fields.

## Android build

`DALIGO.aab` inside the supplied ZIP is the original Android App Bundle. The HTML/PWA files in this update are changed, but the existing AAB is not rebuilt. If the Android app uses these web files through a WebView/TWA, rebuild the AAB after deploying the updated web files.
