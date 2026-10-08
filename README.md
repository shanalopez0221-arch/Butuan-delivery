# DALIGO — GitHub + Firebase

DALIGO is a Firebase-powered delivery platform with separate customer, rider and admin web apps.

## Architecture

- **GitHub** — source control and automatic deployment workflow.
- **Firebase Hosting** — serves `index.html`, `rider.html`, `admin.html` and static assets.
- **Firebase Authentication** — customer/rider/admin sign-in.
- **Cloud Firestore** — users, riders, bookings, wallet ledger and platform revenue.
- **Firebase Cloud Functions** — trusted server-side booking assignment, delivery settlement and PayMongo webhook processing.
- **PayMongo** — customer GCash checkout and rider wallet top-up checkout.

## Important money-flow rules

1. Rider wallet top-ups are **wallet credit**, not DALIGO revenue.
2. Cash delivery: customer pays the rider cash; when delivery is completed, the DALIGO platform fee is debited from the rider's DALIGO wallet.
3. GCash delivery: customer pays through the DALIGO/PayMongo checkout; the server records the booking payment and DALIGO fee. The rider wallet is not treated as the customer's payment account.
4. The owner's personal GCash number is never placed in frontend HTML/JavaScript.
5. Browser code never decides that a payment succeeded. PayMongo webhook confirmation is processed by Cloud Functions.

## First-time setup

### 1. Firebase

Make sure the Firebase project is `butuan-delivery` and enable:

- Authentication → Email/Password
- Firestore Database
- Hosting
- Cloud Functions

### 2. Local Firebase CLI

Install/login once:

```bash
npm install -g firebase-tools
firebase login
firebase use butuan-delivery
```

Deploy Firebase configuration:

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
firebase deploy --only hosting
```

Or deploy everything:

```bash
firebase deploy
```

### 3. PayMongo secrets

Create `functions/.env` locally from `.env.example` and put the real server secrets there. Never commit it.

```text
PAYMONGO_SECRET_KEY=...
PAYMONGO_WEBHOOK_SECRET=...
```

For production, configure the secrets/environment using the Firebase Functions deployment environment appropriate to your Firebase setup.

### 4. GitHub automatic deployment

Create a GitHub repository and push this folder to the `main` branch.

Add this repository secret:

`FIREBASE_SERVICE_ACCOUNT`

The value should be the Firebase service-account JSON used by the GitHub Actions deployment.

After that, every push to `main` runs `.github/workflows/firebase-deploy.yml` and deploys the Hosting site.

## Firebase Hosting URLs

With the current project ID, the normal Firebase Hosting domain is:

`https://butuan-delivery.web.app/`

Customer: `/`
Rider: `/rider.html`
Admin: `/admin.html`

## Before accepting real money

- Complete PayMongo merchant/KYC setup.
- Configure the correct live API key and webhook signing secret.
- Test rider wallet top-up with a test payment.
- Test a cash delivery and verify the wallet ledger debit.
- Test a GCash delivery and verify the booking/payment/revenue records.
- Test duplicate webhook delivery; it must not credit a wallet twice.
- Do not put PayMongo secret keys, Firebase service-account JSON, or personal GCash credentials in GitHub source files.
