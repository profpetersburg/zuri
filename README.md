# Zuri live

Run: `node server.js` (Node 22+, no install). Opens in **sandbox** (fake providers, full flow works). Open http://localhost:3000.

## What is real in live mode
| Piece | Provider | Endpoint |
|---|---|---|
| FX rates (mid-market minus your margin) | Open Exchange Rates | GET /api/rates |
| Rate lock (10 min, single use) | this server | POST /api/quotes |
| KYC (ID + selfie, AML) | Sumsub WebSDK | POST /api/kyc/session, webhook /webhooks/kyc |
| Collect money | Stripe Checkout | POST /api/transfers, webhook /webhooks/payment |
| Pay out | Flutterwave Transfers | webhook /webhooks/payout |

Flow: KYC approved -> quote -> transfer (awaiting_payment) -> Stripe webhook (processing) -> Flutterwave payout -> delivered, or refund_due. Ledger entries are written at each money step. Transfers are only advanced by signed webhooks, never by the browser.

## Before you go live (not optional)
1. **Licence or partner.** Moving customers' money requires authorisation (UK: FCA payment institution; US: FinCEN MSB plus state licences; plus licences or partners in each payout country). Without your own licence, operate as an agent of a licensed provider (e.g. Wise Platform, Thunes, Flutterwave) under their terms.
2. **Compliance programme:** sanctions/PEP screening (stub at the TODO in server.js), transaction monitoring, record keeping, a MLRO, and customer terms.
3. **Authentication:** `/api/login` is sandbox-only. Plug in Auth0, Clerk or Firebase and verify their JWTs in `verify()`.
4. **Recipient bank codes:** the app's recipient form needs a bank / mobile-money network code (Flutterwave `account_bank`). Live mode rejects recipients without one. Add a bank picker per country, and use name-resolution before paying out.
5. **Database:** replace data.json with Postgres (transactions, unique constraints on references, real ledger).
6. **Verify the adapters** against current provider docs and test in each provider's own test mode. They were written from API knowledge and have only been run against the sandbox fakes here.
7. HTTPS, rate limiting, logging/alerting, a refund job for `refund_due`, and a reconciliation job against provider statements.
