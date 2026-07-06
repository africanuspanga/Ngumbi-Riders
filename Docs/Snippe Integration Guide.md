\# Snippe Integration Guide

\> Snippe is a payment processing API for Tanzania. It enables collecting payments via mobile money, cards, and QR codes, and sending disbursements (payouts) to mobile money wallets and bank accounts.

This is the canonical AI-readable reference for integrating Snippe. It covers everything you need to integrate end-to-end: authentication, all payment methods, hosted checkout sessions, disbursements, webhooks, and error handling, with working request/response examples extracted from the live documentation. Each section links back to the full documentation page for deeper context (open the linked URL with \`.mdx\` appended to get the full markdown of that page).

\- API version: \`2026-01-25\`  
\- Base URL: \`https://api.snippe.sh\`  
\- Website: \`https://snippe.sh\`  
\- Currency: \`TZS\` only (Tanzanian Shilling)  
\- Authentication: Bearer token (API key)

\---

\#\# Table of Contents

1\. \[Authentication\](\#authentication)  
2\. \[Core Concepts\](\#core-concepts)  
3\. \[Quick Start: Accept a Mobile Money Payment\](\#quick-start-accept-a-mobile-money-payment)  
4\. \[Payments\](\#payments)  
5\. \[Checkout Sessions & Payment Links\](\#checkout-sessions--payment-links)  
6\. \[Disbursements (Payouts)\](\#disbursements-payouts)  
7\. \[Webhooks\](\#webhooks)  
8\. \[Error Handling\](\#error-handling)  
9\. \[Idempotency\](\#idempotency)  
10\. \[Rate Limits\](\#rate-limits)  
11\. \[SDKs & Plugins\](\#sdks--plugins)  
12\. \[Reference Links\](\#reference-links)

\---

\#\# Authentication

All API requests require an API key in the \`Authorization\` header:

\`\`\`http  
Authorization: Bearer snp\_your\_api\_key\_here  
\`\`\`

Get your API key from the \[Snippe Dashboard\](https://snippe.sh) under \*\*Settings → API Keys\*\*. The key is shown once at creation — store it securely.

\#\#\# Scopes

| Scope                 | Description               |  
| \--------------------- | \------------------------- |  
| \`collection:read\`     | View payments and balance |  
| \`collection:create\`   | Create payment intents    |  
| \`disbursement:read\`   | View payouts              |  
| \`disbursement:create\` | Create payouts            |

Select only the scopes your application needs.

\#\#\# Example

\`\`\`bash  
curl \-X GET https://api.snippe.sh/v1/payments \\  
  \-H "Authorization: Bearer snp\_your\_api\_key\_here"  
\`\`\`

Full guide: https://snippe.sh/docs/2026-01-25/authentication

\---

\#\# Core Concepts

Snippe has four main resource types:

| Resource         | Purpose                                                                            | Endpoint prefix     |  
| \---------------- | \---------------------------------------------------------------------------------- | \------------------- |  
| \*\*Payments\*\*     | Collect money from customers (mobile money, card, QR)                              | \`/v1/payments\`      |  
| \*\*Sessions\*\*     | Hosted checkout pages — Snippe handles the UI and method selection for you         | \`/api/v1/sessions\`  |  
| \*\*Disbursements\*\*| Send money out to recipients (mobile money wallets or bank accounts)               | \`/v1/payouts\`       |  
| \*\*Webhooks\*\*     | Real-time event notifications for payment and payout status changes                | (your URL)          |

\*\*When to use payments vs sessions:\*\* Use the Payments API when you want full control over the UI and you build the payment form yourself. Use Sessions when you want Snippe to host a pre-built, mobile-optimized checkout page.

\---

\#\# Quick Start: Accept a Mobile Money Payment

The simplest end-to-end flow.

\#\#\# 1\. Create the payment

\`\`\`http  
POST /v1/payments  
Authorization: Bearer snp\_your\_api\_key\_here  
Content-Type: application/json  
Idempotency-Key: order-12345-attempt-1  
\`\`\`

\`\`\`json  
{  
  "payment\_type": "mobile",  
  "details": {  
    "amount": 500,  
    "currency": "TZS"  
  },  
  "phone\_number": "255781000000",  
  "customer": {  
    "firstname": "FirstName",  
    "lastname": "LastName",  
    "email": "customer@email.com"  
  },  
  "webhook\_url": "https://yoursite.com/webhooks/snippe",  
  "metadata": {  
    "order\_id": "ORD-12345"  
  }  
}  
\`\`\`

\#\#\# 2\. Receive the response

\`\`\`json  
{  
  "status": "success",  
  "code": 201,  
  "data": {  
    "amount": { "currency": "TZS", "value": 500 },  
    "api\_version": "2026-01-25",  
    "expires\_at": "2026-01-25T05:04:54.063993853Z",  
    "object": "payment",  
    "payment\_type": "mobile",  
    "reference": "9015c155-9e29-4e8e-8fe6-d5d81553c8e6",  
    "status": "pending"  
  }  
}  
\`\`\`

The customer's phone receives a USSD push to authorize. Payment expires after 4 hours if not completed.

\#\#\# 3\. Wait for the webhook

Snippe sends \`payment.completed\` (or \`payment.failed\`) to your \`webhook\_url\` once the customer authorizes. See \[Webhooks\](\#webhooks) below for verification.

\#\#\# 4\. (Optional) Verify status manually

\`\`\`http  
GET /v1/payments/{reference}  
Authorization: Bearer snp\_your\_api\_key\_here  
\`\`\`

\---

\#\# Payments

The Payments API collects money from customers via three channels: mobile money, card, and dynamic QR.

\#\#\# Endpoints

| Endpoint                        | Method | Description           |  
| \------------------------------- | \------ | \--------------------- |  
| \`/v1/payments\`                  | POST   | Create payment intent |  
| \`/v1/payments\`                  | GET    | List all payments     |  
| \`/v1/payments/{reference}\`      | GET    | Get payment status    |  
| \`/v1/payments/{reference}/push\` | POST   | Trigger USSD push     |  
| \`/v1/payments/balance\`          | GET    | Get account balance   |  
| \`/v1/payments/search\`           | GET    | Search payments       |

\#\#\# Payment Status Lifecycle

| Status      | Description                               |  
| \----------- | \----------------------------------------- |  
| \`pending\`   | Payment created, awaiting customer action |  
| \`completed\` | Payment successful, funds received        |  
| \`failed\`    | Payment failed (declined, timeout, etc.)  |  
| \`voided\`    | Payment cancelled before completion       |  
| \`expired\`   | Payment expired (4 hour timeout)          |

\#\#\# Currency Rules

Only \`TZS\` is supported. Amounts are integers in the smallest currency unit. Minimum payment amount is \*\*500 TZS\*\*. Other currencies (USD, EUR, KES) return a \`400 validation\_error\`.

Full guide: https://snippe.sh/docs/2026-01-25/payments

\#\#\# Mobile Money Payments

Customer receives a USSD push to authorize on their phone. Supported networks: Airtel Money, M-Pesa, Mixx by Yas, Halotel.

\*\*Request:\*\*

\`\`\`json  
{  
  "payment\_type": "mobile",  
  "details": {  
    "amount": 500,  
    "currency": "TZS"  
  },  
  "phone\_number": "255781000000",  
  "customer": {  
    "firstname": "FirstName",  
    "lastname": "LastName",  
    "email": "customer@email.com"  
  },  
  "webhook\_url": "https://yoursite.com/webhooks/snippe",  
  "metadata": { "order\_id": "ORD-12345" }  
}  
\`\`\`

\*\*Required fields:\*\* \`payment\_type\` (\`"mobile"\`), \`details.amount\`, \`details.currency\`, \`phone\_number\`, \`customer.firstname\`, \`customer.lastname\`, \`customer.email\`.

\*\*Phone number format:\*\* \`255XXXXXXXXX\` (no plus sign required, but \`+255XXXXXXXXX\` also accepted).

\*\*Flow:\*\*  
1\. Create the payment intent.  
2\. Customer receives USSD push on their phone.  
3\. Customer enters PIN to authorize.  
4\. Snippe sends webhook with result.

Full guide: https://snippe.sh/docs/2026-01-25/payments/mobile-money

\#\#\# Card Payments

Customer is redirected to a secure hosted checkout page. Supported cards: Visa, Mastercard, local debit cards.

\*\*Request:\*\*

\`\`\`json  
{  
  "payment\_type": "card",  
  "details": {  
    "amount": 1000,  
    "currency": "TZS",  
    "redirect\_url": "https://your\_domain.com/payment\_done",  
    "cancel\_url": "https://your\_domain.com/payment\_failed"  
  },  
  "phone\_number": "255781000000",  
  "customer": {  
    "firstname": "FirstName",  
    "lastname": "LastName",  
    "email": "customer@email.com",  
    "address": "Customer Address",  
    "city": "Customer City",  
    "state": "DSM",  
    "postcode": "14101",  
    "country": "TZ"  
  },  
  "webhook\_url": "https://yoursite.com/webhooks/snippe",  
  "metadata": { "order\_id": "ORD-12345" }  
}  
\`\`\`

\*\*Response includes a \`payment\_url\`\*\* to redirect the customer to:

\`\`\`json  
{  
  "status": "success",  
  "code": 201,  
  "data": {  
    "amount": { "currency": "TZS", "value": 1000 },  
    "expires\_at": "2026-01-25T01:32:10.476693917Z",  
    "payment\_url": "https://tz.selcom.online/paymentgw/checkout/...",  
    "payment\_token": "63891931",  
    "payment\_type": "card",  
    "reference": "2e0bcc5f-92ca-44f9-8c1b-4d2966d9921f",  
    "status": "pending"  
  }  
}  
\`\`\`

\*\*Required customer fields for card:\*\* firstname, lastname, email, address, city, state, postcode, country (ISO 3166-1 alpha-2).

\*\*Flow:\*\*  
1\. Create the payment.  
2\. Redirect the customer to \`payment\_url\`.  
3\. Customer enters card details on secure checkout.  
4\. Customer is redirected back to your \`redirect\_url\` or \`cancel\_url\`.  
5\. Webhook is sent with the result.

Full guide: https://snippe.sh/docs/2026-01-25/payments/card

\#\#\# Dynamic QR Payments

Generate a QR code that customers scan with their mobile money app. Used for in-person/POS payments.

\*\*Request:\*\*

\`\`\`json  
{  
  "payment\_type": "dynamic-qr",  
  "details": {  
    "amount": 500,  
    "currency": "TZS",  
    "redirect\_url": "https://your\_domain.com/payment\_done",  
    "cancel\_url": "https://your\_domain.com/payment\_failed"  
  },  
  "phone\_number": "255781000000",  
  "customer": {  
    "firstname": "FirstName",  
    "lastname": "LastName",  
    "email": "customer@email.com"  
  },  
  "webhook\_url": "https://yoursite.com/webhooks/snippe",  
  "metadata": { "order\_id": "ORD-12345" }  
}  
\`\`\`

\*\*Response includes \`payment\_qr\_code\`\*\* (the data string to render as a QR image):

\`\`\`json  
{  
  "status": "success",  
  "code": 201,  
  "data": {  
    "amount": { "currency": "TZS", "value": 500 },  
    "expires\_at": "2026-01-25T04:47:50.159178853Z",  
    "payment\_qr\_code": "000201010212041552545429990002026390014tz.go.bot.tips...",  
    "payment\_token": "63890400",  
    "payment\_url": "https://tz.selcom.online/paymentgw/checkout/...",  
    "payment\_type": "dynamic-qr",  
    "reference": "6a490816-799b-4fc9-b9b6-2ec67c54e17e",  
    "status": "pending"  
  }  
}  
\`\`\`

For QR payments, only \`payment\_type\`, \`details.amount\`, and \`details.currency\` are required — customer fields are optional.

Full guide: https://snippe.sh/docs/2026-01-25/payments/dynamic-qr

\#\#\# Get Account Balance

\`\`\`http  
GET /v1/payments/balance  
Authorization: Bearer snp\_your\_api\_key\_here  
\`\`\`

\`\`\`json  
{  
  "status": "success",  
  "code": 200,  
  "data": {  
    "available": { "currency": "TZS", "value": 6943 },  
    "balance": { "currency": "TZS", "value": 6943 },  
    "object": "balance"  
  }  
}  
\`\`\`

\---

\#\# Checkout Sessions & Payment Links

Sessions provide a hosted checkout page so you don't need to build your own payment form. Snippe handles the UI, method selection, and status polling.

\#\#\# When to use sessions

\- You want a pre-built, mobile-optimized checkout UI.  
\- You want a single URL that handles multiple payment methods.  
\- You want to share a payment link via SMS/WhatsApp/email.

\#\#\# Create a Session

\`\`\`http  
POST /api/v1/sessions  
Authorization: Bearer \<api\_key\>  
Content-Type: application/json  
\`\`\`

\*\*Basic example:\*\*

\`\`\`json  
{  
  "amount": 50000,  
  "currency": "TZS",  
  "allowed\_methods": \["mobile\_money", "qr"\],  
  "customer": {  
    "name": "John Doe",  
    "phone": "+255712345678",  
    "email": "john@example.com"  
  },  
  "redirect\_url": "https://yoursite.com/success",  
  "webhook\_url": "https://yoursite.com/webhooks/snippe",  
  "description": "Order \#12345",  
  "metadata": { "order\_id": "12345" },  
  "expires\_in": 3600  
}  
\`\`\`

\*\*Response:\*\*

\`\`\`json  
{  
  "code": 201,  
  "data": {  
    "reference": "sess\_abc123def456",  
    "status": "pending",  
    "amount": 50000,  
    "currency": "TZS",  
    "checkout\_url": "https://snippe.me/checkout/W0SzdUSHQm",  
    "short\_code": "Ax7kM2",  
    "payment\_link\_url": "https://snippe.me/p/Ax7kM2",  
    "expires\_at": "2026-02-26T11:00:00Z"  
  }  
}  
\`\`\`

\*\*Two URLs are returned:\*\*  
\- \`checkout\_url\` — full hosted checkout URL (embed in apps)  
\- \`payment\_link\_url\` — short link (e.g. \`snippe.me/p/Ax7kM2\`) ideal for SMS/WhatsApp/print

\#\#\# URL metadata on payment links

Append a base64-encoded JSON blob to any payment link as \`?meta=...\` to attach context that comes back on the webhook. Useful for SaaS top-ups, WhatsApp orders, affiliate attribution, or anything where the webhook needs to know "what was this payment for" without a separate lookup.

\`\`\`python  
import base64, json  
meta \= base64.b64encode(json.dumps({"ref": "ORDER-4421", "user\_id": "usr\_882"}).encode()).decode()  
url \= f"https://snippe.me/p/your-page-slug?meta={meta}"  
\`\`\`

The decoded object is delivered on \`payment.completed\` at \`data.metadata.url\_metadata\`:

\`\`\`json  
{  
  "type": "payment.completed",  
  "data": {  
    "metadata": {  
      "url\_metadata": { "ref": "ORDER-4421", "user\_id": "usr\_882" }  
    }  
  }  
}  
\`\`\`

The blob is base64-encoded for transport, \*\*not encrypted\*\* — don't put secrets or PII in it. Always verify the webhook signature before trusting \`url\_metadata\`.

Full guide: https://snippe.sh/docs/2026-01-25/sessions/payment-links\#url-metadata

\#\#\# Allowed payment methods

| Value          | Description                                    |  
| \-------------- | \---------------------------------------------- |  
| \`mobile\_money\` | Mobile money (Airtel, M-Pesa, Mixx, Halotel)   |  
| \`qr\`           | QR code payments                               |  
| \`card\`         | Credit/debit card payments                     |

\#\#\# Custom amounts (donations, tips)

\`\`\`json  
{  
  "allow\_custom\_amount": true,  
  "min\_amount": 1000,  
  "max\_amount": 500000,  
  "description": "Donation"  
}  
\`\`\`

\#\#\# Session Status

| Status      | Description                       |  
| \----------- | \--------------------------------- |  
| \`pending\`   | Session created, awaiting payment |  
| \`active\`    | Payment in progress               |  
| \`completed\` | Payment successful                |  
| \`expired\`   | Session expired before payment    |  
| \`cancelled\` | Session cancelled                 |

\#\#\# Endpoints

| Endpoint                              | Method | Description         |  
| \------------------------------------- | \------ | \------------------- |  
| \`/api/v1/sessions\`                    | POST   | Create session      |  
| \`/api/v1/sessions\`                    | GET    | List sessions       |  
| \`/api/v1/sessions/:reference\`         | GET    | Get session details |  
| \`/api/v1/sessions/:reference/cancel\`  | POST   | Cancel session      |

\#\#\# Payment Profiles

Profiles store reusable branding (merchant name, logo, brand color, locale, default URLs) so every session inherits the same look. Create profiles in the \[Snippe Dashboard\](https://snippe.me/dashboard) under \*\*Settings → Payment Profiles\*\*, then reference them by \`profile\_id\` when creating sessions:

\`\`\`json  
{  
  "profile\_id": "prof\_550e8400-e29b-41d4-a716-446655440000",  
  "amount": 50000,  
  "description": "Order \#12345"  
}  
\`\`\`

Branding fields (\`merchant\_name\`, \`merchant\_logo\`, \`brand\_color\`, \`locale\`, \`collect\_email\`) come exclusively from the profile. Configuration fields (\`redirect\_url\`, \`webhook\_url\`, \`allowed\_methods\`) can be overridden per request.

Full guides:  
\- Sessions: https://snippe.sh/docs/2026-01-25/sessions  
\- Payment Profiles: https://snippe.sh/docs/2026-01-25/sessions/profiles  
\- Payment Links: https://snippe.sh/docs/2026-01-25/sessions/payment-links

\---

\#\# Disbursements (Payouts)

The Disbursements API sends money out to mobile money wallets or bank accounts. The total amount (payout \+ fees) is deducted from your available balance immediately. If a payout fails, funds are automatically returned to your balance.

\#\#\# Endpoints

| Endpoint                  | Method | Description          |  
| \------------------------- | \------ | \-------------------- |  
| \`/v1/payouts/send\`        | POST   | Create payout        |  
| \`/v1/payouts\`             | GET    | List payouts         |  
| \`/v1/payouts/{reference}\` | GET    | Get payout status    |  
| \`/v1/payouts/fee\`         | GET    | Calculate payout fee |

\#\#\# Payout Status Lifecycle

| Status      | Description                                 |  
| \----------- | \------------------------------------------- |  
| \`pending\`   | Payout created, awaiting processing         |  
| \`completed\` | Payout successful, recipient received funds |  
| \`failed\`    | Payout failed (see \`failure\_reason\`)        |  
| \`reversed\`  | Payout was reversed after completion        |

\#\#\# Mobile Money Payout

Send to Airtel Money, M-Pesa, Mixx by Yas, or HaloPesa. Snippe auto-detects the provider from the phone number.

\*\*Request:\*\*

\`\`\`http  
POST /v1/payouts/send  
Authorization: Bearer \<api\_key\>  
Content-Type: application/json  
Idempotency-Key: payout-emp-001-jan-2026  
\`\`\`

\`\`\`json  
{  
  "amount": 5000,  
  "channel": "mobile",  
  "recipient\_phone": "255781000000",  
  "recipient\_name": "Recipient Name",  
  "narration": "Salary payment January 2026",  
  "webhook\_url": "https://yoursite.com/webhooks/snippe",  
  "metadata": {  
    "employee\_id": "EMP-001",  
    "payroll\_id": "PAY-2026-01"  
  }  
}  
\`\`\`

\*\*Response:\*\*

\`\`\`json  
{  
  "status": "success",  
  "code": 201,  
  "data": {  
    "amount": { "currency": "TZS", "value": 5000 },  
    "channel": { "provider": "airtel", "type": "mobile\_money" },  
    "external\_reference": "fVJQRPGYbtN3",  
    "fees": { "currency": "TZS", "value": 1500 },  
    "recipient": { "name": "Recipient Name", "phone": "255781000000" },  
    "reference": "667c9279-846f-4001-b046-fdecab204f4f",  
    "status": "pending",  
    "total": { "currency": "TZS", "value": 6500 }  
  }  
}  
\`\`\`

\*\*Required:\*\* \`amount\`, \`channel\` (\`"mobile"\`), \`recipient\_phone\`, \`recipient\_name\`.

Full guide: https://snippe.sh/docs/2026-01-25/disbursements/mobile-money

\#\#\# Bank Transfer Payout

Send to 40+ Tanzanian banks (CRDB, NMB, NBC, ABSA, Equity, KCB, Stanbic, Standard Chartered, etc.).

\*\*Request:\*\*

\`\`\`json  
{  
  "amount": 5000,  
  "channel": "bank",  
  "recipient\_bank": "ABSA",  
  "recipient\_account": "0200000000",  
  "recipient\_name": "Recipient Name",  
  "narration": "Invoice payment INV-2026-001",  
  "webhook\_url": "https://yoursite.com/webhooks/snippe",  
  "metadata": { "invoice\_id": "INV-2026-001" }  
}  
\`\`\`

\*\*Required:\*\* \`amount\`, \`channel\` (\`"bank"\`), \`recipient\_bank\` (bank code), \`recipient\_account\`, \`recipient\_name\`.

\*\*Common bank codes:\*\* \`ABSA\`, \`ACCESS\`, \`AKIBA\`, \`AMANA\`, \`AZANIA\`, \`BARODA\`, \`BOA\`, \`CITI\`, \`CRDB\`, \`DTB\`, \`ECOBANK\`, \`EQUITY\`, \`EXIM\`, \`FNB\`, \`HABIB\`, \`IMBANK\`, \`KCB\`, \`NBC\`, \`NCBA\`, \`NMB\`, \`PBZ\`, \`SCB\`, \`STANBIC\`, \`TCB\`, \`UBA\`. See the full bank list at the link below.

Full guide: https://snippe.sh/docs/2026-01-25/disbursements/bank-transfer

\#\#\# Calculate Fee Before Payout

Always calculate fees before creating payouts to ensure sufficient balance:

\`\`\`http  
GET /v1/payouts/fee?amount=5000  
Authorization: Bearer \<api\_key\>  
\`\`\`

\`\`\`json  
{  
  "status": "success",  
  "code": 200,  
  "data": {  
    "amount": 50000,  
    "fee\_amount": 1000,  
    "total\_amount": 51000,  
    "currency": "TZS"  
  }  
}  
\`\`\`

Full guide: https://snippe.sh/docs/2026-01-25/disbursements

\---

\#\# Webhooks

Webhooks deliver real-time notifications when events occur (payment completed, payout failed, etc.). Snippe sends an HTTP POST to your configured \`webhook\_url\`.

\#\#\# Event Types

| Event               | Description                              |  
| \------------------- | \---------------------------------------- |  
| \`payment.completed\` | Payment was successfully processed       |  
| \`payment.failed\`    | Payment failed (declined, timeout, etc.) |  
| \`payment.voided\`    | Payment was cancelled before completion  |  
| \`payment.expired\`   | Payment expired                          |  
| \`payout.completed\` | Payout was successfully delivered         |  
| \`payout.failed\`    | Payout failed to process                  |  
| \`payout.reversed\`  | Payout was reversed after completion      |

\#\#\# Webhook Headers

| Header                | Description                            |  
| \--------------------- | \-------------------------------------- |  
| \`Content-Type\`        | \`application/json\`                     |  
| \`User-Agent\`          | \`Snippe-Webhook/1.0\`                   |  
| \`X-Webhook-Event\`     | Event type (e.g. \`payment.completed\`)  |  
| \`X-Webhook-Timestamp\` | Unix timestamp of the event            |  
| \`X-Webhook-Signature\` | HMAC-SHA256 signature                  |

\#\#\# Webhook Payload (API v2026-01-25)

Events use an envelope with \`id\`, \`type\`, \`api\_version\`, \`created\_at\`, and \`data\`:

\`\`\`json  
{  
  "id": "evt\_a1b2c3d4e5f6g7h8i9j0",  
  "type": "payment.completed",  
  "api\_version": "2026-01-25",  
  "created\_at": "2026-01-24T10:30:00Z",  
  "data": {  
    "reference": "pi\_a1b2c3d4e5f6",  
    "external\_reference": "SEL123456789",  
    "status": "completed",  
    "amount": { "value": 50000, "currency": "TZS" },  
    "settlement": {  
      "gross": { "value": 50000, "currency": "TZS" },  
      "fees":  { "value": 1000,  "currency": "TZS" },  
      "net":   { "value": 49000, "currency": "TZS" }  
    },  
    "channel": { "type": "mobile\_money", "provider": "mpesa" },  
    "customer": {  
      "phone": "+255712345678",  
      "name": "John Doe",  
      "email": "john@example.com"  
    },  
    "metadata": { "order\_id": "ORD-12345" },  
    "completed\_at": "2026-01-24T10:30:00Z"  
  }  
}  
\`\`\`

\*\*Important:\*\* In webhook payloads \`data.amount\` is an object (\`{value, currency}\`), not a plain integer like in request bodies. Parse \`data.amount.value\` and \`data.amount.currency\` separately.

\#\#\# Signature Verification

Snippe signs every webhook with HMAC-SHA256. Verify signatures in production to prevent spoofing.

\*\*Get your signing key\*\* from the dashboard under \*\*Settings → Webhook Secret\*\*, or via API:

\`\`\`bash  
GET /api/v1/settings/webhook-secret  
Authorization: Bearer \<jwt\_token\>  
\`\`\`

\*\*How signatures are computed:\*\*

\`\`\`  
X-Webhook-Signature \= hex(HMAC-SHA256(signing\_key, "{timestamp}.{raw\_body}"))  
\`\`\`

\*\*Verification steps:\*\*

1\. Extract \`X-Webhook-Timestamp\` and \`X-Webhook-Signature\` from headers.  
2\. Read the \*\*raw request body\*\* as a string. Do NOT parse and re-serialize the JSON — whitespace or key ordering changes will break the signature.  
3\. Construct the message: \`{timestamp}.{raw\_body}\`.  
4\. Compute HMAC-SHA256 with your signing key, hex-encoded.  
5\. Compare with \`X-Webhook-Signature\` using \*\*constant-time comparison\*\* (e.g. \`crypto.timingSafeEqual\` in Node.js, \`hmac.compare\_digest\` in Python, \`hash\_equals\` in PHP, \`hmac.Equal\` in Go).  
6\. \*\*Recommended:\*\* Reject requests where the timestamp is more than 5 minutes old to prevent replay attacks.

\*\*Node.js example:\*\*

\`\`\`javascript  
const crypto \= require("crypto");

function verifyWebhook(payload, headers, signingKey) {  
  const timestamp \= headers\["x-webhook-timestamp"\];  
  const signature \= headers\["x-webhook-signature"\];

  // Prevent replay attacks  
  const eventTime \= parseInt(timestamp, 10);  
  const currentTime \= Math.floor(Date.now() / 1000);  
  if (currentTime \- eventTime \> 300\) {  
    throw new Error("Webhook timestamp too old");  
  }

  const message \= \`${timestamp}.${payload}\`;  
  const expectedSignature \= crypto  
    .createHmac("sha256", signingKey)  
    .update(message)  
    .digest("hex");

  if (  
    \!crypto.timingSafeEqual(  
      Buffer.from(signature),  
      Buffer.from(expectedSignature),  
    )  
  ) {  
    throw new Error("Invalid webhook signature");  
  }

  return JSON.parse(payload);  
}

// Express.js handler — use express.raw to keep the body as bytes  
app.post(  
  "/webhooks/snippe",  
  express.raw({ type: "application/json" }),  
  (req, res) \=\> {  
    try {  
      const event \= verifyWebhook(  
        req.body.toString(),  
        req.headers,  
        process.env.SNIPPE\_WEBHOOK\_SECRET,  
      );

      switch (event.type) {  
        case "payment.completed":  
          handlePaymentCompleted(event.data);  
          break;  
        case "payment.failed":  
          handlePaymentFailed(event.data);  
          break;  
      }

      res.status(200).send("OK");  
    } catch (err) {  
      res.status(400).send("Invalid signature");  
    }  
  },  
);  
\`\`\`

For Python, PHP, and Go examples (and the full security checklist), see the full webhooks guide below.

\#\#\# Retry Logic

If your endpoint returns non-2xx or times out, Snippe retries with exponential backoff:

| Attempt | Delay After Failure |  
| \------- | \------------------- |  
| 1       | Immediate           |  
| 2       | 3 minutes           |  
| 3       | 6 minutes           |  
| 4       | 12 minutes          |  
| 5       | 24 minutes          |

After 5 failed attempts the webhook is marked \`abandoned\`. Return a 2xx within 30 seconds and process asynchronously to avoid retries.

\#\#\# Best Practices

\- \*\*Always verify signatures in production.\*\*  
\- \*\*Read the raw body\*\* — don't parse and re-serialize.  
\- \*\*Use constant-time comparison\*\* for the signature check.  
\- \*\*Validate timestamp freshness\*\* (reject if \> 5 minutes old).  
\- \*\*Deduplicate events\*\* using the \`id\` field — the same event may be delivered more than once.  
\- \*\*Respond with 2xx quickly\*\* (under 30 seconds) and process asynchronously.  
\- \*\*Use HTTPS\*\* for your webhook endpoint.

Full guide (with Python, PHP, Go examples and security checklist): https://snippe.sh/docs/2026-01-25/webhooks

\---

\#\# Error Handling

\#\#\# Response Format

All responses follow the same envelope:

\*\*Success:\*\*  
\`\`\`json  
{  
  "status": "success",  
  "code": 200,  
  "data": { /\* ... \*/ }  
}  
\`\`\`

\*\*Error:\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 400,  
  "error\_code": "validation\_error",  
  "message": "amount is required"  
}  
\`\`\`

\#\#\# HTTP Status Codes

| Code | Meaning                                             |  
| \---- | \--------------------------------------------------- |  
| 200  | OK                                                  |  
| 201  | Created                                             |  
| 400  | Bad Request (validation errors, malformed JSON)     |  
| 401  | Unauthorized (auth required or failed)              |  
| 403  | Forbidden (authenticated but insufficient scope)    |  
| 404  | Not Found                                           |  
| 409  | Conflict                                            |  
| 422  | Unprocessable Entity (idempotency key mismatch)     |  
| 429  | Too Many Requests (rate limit)                      |  
| 500  | Internal Server Error                               |  
| 503  | Service Unavailable                                 |

\#\#\# Error Codes

| Code                  | Description                                                 |  
| \--------------------- | \----------------------------------------------------------- |  
| \`unauthorized\`        | Invalid or missing API key                                  |  
| \`insufficient\_scope\`  | API key lacks required scope                                |  
| \`validation\_error\`    | One or more fields are invalid                              |  
| \`not\_found\`           | Resource doesn't exist                                      |  
| \`conflict\`            | Resource state conflict                                     |  
| \`payment\_failed\`      | Payment processing error (e.g. insufficient balance)        |  
| \`rate\_limit\_exceeded\` | Too many requests in the rate limit window                  |  
| \`PAY\_001\`             | Failed to initiate payment — see note below                 |

\*\*\`PAY\_001\` note:\*\* This error has two causes — (1) the upstream payment processor (Selcom) is temporarily unavailable, or (2) your \`Idempotency-Key\` exceeds the \*\*30-character limit\*\*. If you see this error, first check that your idempotency key is ≤ 30 characters, then retry with exponential backoff for processor issues.

\#\#\# Common Error Examples

\*\*Invalid API key (401):\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 401,  
  "error\_code": "unauthorized",  
  "message": "invalid or missing API key"  
}  
\`\`\`

\*\*Missing required field (400):\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 400,  
  "error\_code": "validation\_error",  
  "message": "amount is required"  
}  
\`\`\`

\*\*Invalid phone number (400):\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 400,  
  "error\_code": "validation\_error",  
  "message": "phone\_number must be a valid phone number"  
}  
\`\`\`  
Use format \`255XXXXXXXXX\` or \`+255XXXXXXXXX\` for Tanzanian numbers.

\*\*Amount below minimum (400):\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 400,  
  "error\_code": "validation\_error",  
  "message": "amount 100 is below minimum of 500"  
}  
\`\`\`

\*\*Insufficient balance for payout (500):\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 500,  
  "error\_code": "payment\_failed",  
  "message": "insufficient balance: available 5000, required 6500"  
}  
\`\`\`

\*\*Idempotency conflict (422):\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 422,  
  "error\_code": "validation\_error",  
  "message": "idempotency key already used with different request body"  
}  
\`\`\`

\*\*Rate limit exceeded (429):\*\*  
\`\`\`json  
{  
  "status": "error",  
  "code": 429,  
  "error\_code": "rate\_limit\_exceeded",  
  "message": "Too many requests"  
}  
\`\`\`

\#\#\# Validation Rules

| Rule              | Constraint                                       |  
| \----------------- | \------------------------------------------------ |  
| Min payment       | 500 TZS                                          |  
| Min payout        | 5,000 TZS                                        |  
| Currency          | \`TZS\` only                                       |  
| Amount format     | Integer (smallest currency unit)                 |  
| Phone number      | \`255XXXXXXXXX\` or \`+255XXXXXXXXX\`                |  
| Webhook/redirect  | HTTPS, max 500 characters                        |  
| Idempotency key   | Max 30 characters                                |

\#\#\# Recovery Patterns

\- \*\*5xx errors and network failures:\*\* Retry with exponential backoff.  
\- \*\*429 rate limit:\*\* Respect the \`X-Ratelimit-Reset\` header before retrying.  
\- \*\*422 idempotency conflict:\*\* Use a unique idempotency key per unique request body.  
\- \*\*PAY\_001:\*\* First check idempotency key length, then retry with backoff.

Full guide: https://snippe.sh/docs/2026-01-25/error-handling

\---

\#\# Idempotency

Always include an \`Idempotency-Key\` header on POST requests to prevent duplicate transactions on retry:

\`\`\`http  
POST /v1/payments  
Idempotency-Key: order-12345-attempt-1  
\`\`\`

\*\*Rules:\*\*  
\- Keys must be \*\*30 characters or fewer\*\* — longer keys return a \`500 PAY\_001\` error.  
\- Keys are valid for 24 hours.  
\- Same key \+ same request body → returns the cached response.  
\- Same key \+ different body → returns a \`422\` error.

Use idempotency keys on \`POST /v1/payments\` and \`POST /v1/payouts/send\`.

\---

\#\# Rate Limits

API requests are limited to \*\*60 requests per minute\*\*.

| Header                  | Description                  |  
| \----------------------- | \---------------------------- |  
| \`X-Ratelimit-Limit\`     | Maximum requests per minute  |  
| \`X-Ratelimit-Remaining\` | Remaining requests in window |  
| \`X-Ratelimit-Reset\`     | Seconds until limit resets   |

If you exceed the limit you receive a \`429 Too Many Requests\`. Implement exponential backoff in your retry logic.

\---

\#\# SDKs & Plugins

Snippe ships official client libraries and drop-in storefront plugins. All of them wrap the same HTTP API documented above and verify webhook signatures for you.

\#\#\# Official SDKs

| Language          | Package              | Install                              | Docs                                                 |  
| \----------------- | \-------------------- | \------------------------------------ | \---------------------------------------------------- |  
| JavaScript / TS   | \`@snippe/sdk\`        | \`npm install @snippe/sdk\`            | https://snippe.sh/docs/2026-01-25/sdks/javascript    |  
| Python            | \`snippe\`             | \`pip install snippe\`                 | https://snippe.sh/docs/2026-01-25/sdks/python        |  
| PHP               | \`snippe/snippe-php\`  | \`composer require snippe/snippe-php\` | https://snippe.sh/docs/2026-01-25/sdks/php           |

\*\*Source repos:\*\*  
\- JS: https://github.com/Neurotech-HQ/snippe-js-sdk  
\- Python: https://github.com/Neurotech-HQ/snippe-python-sdk  
\- PHP: https://github.com/Neurotech-HQ/snippe-php-sdk

\#\#\# Storefront plugins

| Platform                | Source                                                       | Docs                                                |  
| \----------------------- | \------------------------------------------------------------ | \--------------------------------------------------- |  
| WordPress / WooCommerce | https://github.com/Neurotech-HQ/snippe-wordpress-plugin      | https://snippe.sh/docs/2026-01-25/plugins/wordpress |  
| WHMCS                   | https://github.com/Neurotech-HQ/snippe-WHMCS                 | https://snippe.sh/docs/2026-01-25/plugins/whmcs     |

\#\#\# Agent skill (Claude Code, Cursor, Gemini CLI)

If you're building with an AI coding agent, install the official \`snippe-integration\` skill so the agent has procedural knowledge of Snippe and writes correct integrations on the first try:

\`\`\`bash  
npx skills add Neurotech-HQ/skills \--skill snippe-integration  
\`\`\`

Skill source: https://github.com/Neurotech-HQ/skills  
Skill docs: https://snippe.sh/docs/2026-01-25/agent-skill

\#\#\# Examples & recipes

Copy-paste recipes for every endpoint in Node.js, Python, Go, and cURL: https://github.com/Neurotech-HQ/snippe-101

\---

\#\# Reference Links

For deeper context on any topic, fetch the markdown of the specific documentation page by appending \`.mdx\` to the URL.

\#\#\# Getting Started  
\- Overview: https://snippe.sh/docs/2026-01-25  
\- Authentication: https://snippe.sh/docs/2026-01-25/authentication

\#\#\# Payments  
\- Payments overview: https://snippe.sh/docs/2026-01-25/payments  
\- Mobile money: https://snippe.sh/docs/2026-01-25/payments/mobile-money  
\- Card: https://snippe.sh/docs/2026-01-25/payments/card  
\- Dynamic QR: https://snippe.sh/docs/2026-01-25/payments/dynamic-qr

\#\#\# Checkout  
\- Sessions: https://snippe.sh/docs/2026-01-25/sessions  
\- Payment Profiles: https://snippe.sh/docs/2026-01-25/sessions/profiles  
\- Payment Links: https://snippe.sh/docs/2026-01-25/sessions/payment-links

\#\#\# Disbursements  
\- Disbursements overview: https://snippe.sh/docs/2026-01-25/disbursements  
\- Mobile money payouts: https://snippe.sh/docs/2026-01-25/disbursements/mobile-money  
\- Bank transfers (with full bank list): https://snippe.sh/docs/2026-01-25/disbursements/bank-transfer

\#\#\# Webhooks & Errors  
\- Webhooks (full guide with Python/PHP/Go examples): https://snippe.sh/docs/2026-01-25/webhooks  
\- Error handling: https://snippe.sh/docs/2026-01-25/error-handling

\#\#\# SDKs & Plugins  
\- SDKs overview: https://snippe.sh/docs/2026-01-25/sdks  
\- JavaScript SDK: https://snippe.sh/docs/2026-01-25/sdks/javascript  
\- Python SDK: https://snippe.sh/docs/2026-01-25/sdks/python  
\- PHP SDK: https://snippe.sh/docs/2026-01-25/sdks/php  
\- Plugins overview: https://snippe.sh/docs/2026-01-25/plugins  
\- WooCommerce plugin: https://snippe.sh/docs/2026-01-25/plugins/wordpress  
\- WHMCS plugin: https://snippe.sh/docs/2026-01-25/plugins/whmcs  
\- Agent skill (Claude Code / Cursor / Gemini CLI): https://snippe.sh/docs/2026-01-25/agent-skill

\#\#\# Migration  
\- v2026-01-01 → v2026-01-25 migration guide: https://snippe.sh/docs/2026-01-25/migration

