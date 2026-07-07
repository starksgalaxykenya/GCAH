# Galaxy Consolidated Auction House (GCAH)

A multi-portal auction & asset-remarketing platform: buyers bid on inspected,
seal-verified consignment assets **or** buy items Galaxy CAH owns outright
from the built-in **Store**. Sellers consign assets, inspectors verify and
seal them, escrow tracks settlement through to NTSA transfer, and admins run
the whole operation from one dashboard.

This used to be a single giant HTML file. It's now split into small,
readable pieces so you (or another engineer) can find and change things fast.

## File structure

```
index.html                  Landing page — sign in / register, routes by role
buyer-portal.html           Buyer/bidder portal
seller-portal.html          Seller/dealer portal
inspector-portal.html       Mobile inspector portal
admin-portal.html           Admin control center (sidebar layout)

css/
  styles.css                One shared design system used by every page

js/
  firebase-config.js        Firebase init + shared CONFIG (fees, categories...)
  shared.js                 Auth guard, toasts, notifications, formatting helpers,
                             expiry watchdog (auto-settles ended auctions)
  auth.js                   index.html logic (login/register/redirect)
  buyer-portal.js           Buyer portal logic
  seller-portal.js          Seller portal logic
  inspector-portal.js       Inspector portal logic
  admin-portal.js           Admin portal logic

firestore.rules             Security rules matching every collection below
```

Every HTML page loads `css/styles.css` and exactly one `js/*-portal.js`
module. All Firebase access goes through `js/firebase-config.js`, so there's
a single place to change your project credentials.

## Setting it up

1. Create a Firebase project (or reuse an existing one) with **Authentication
   (Email/Password)** and **Firestore** enabled.
2. Open `js/firebase-config.js` and paste in your project's config object
   (Firebase console → Project settings → Your apps → SDK config).
3. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`), or
   paste its contents into the Firestore console's Rules tab.
4. Host the folder anywhere that serves static files (Firebase Hosting,
   Netlify, GitHub Pages, or just `npx serve .` locally). No build step —
   it's plain ES modules loaded straight from the browser.
5. Register a normal account, then in the Firestore console manually change
   that user's `role` field to `admin` to get into the Admin portal (admins
   intentionally can't self-register from the UI).

## How a listing flows through the system

1. **Seller** submits a listing (`seller-portal.html` → "List Asset"). This
   creates an `auctions` doc with `status: pending_inspection` and an
   `inspections` doc with `status: unassigned`.
2. **Inspector** claims the job from the Job Queue (or an **Admin** assigns
   it), visits the asset, and completes the inspection: records mileage,
   applies a tamper-evident seal ID, and the auction flips to
   `status: live` with a countdown timer.
3. **Buyers** bid in real time (`onSnapshot` listeners on the auction doc and
   its bid history — no polling needed on the detail page).
4. When the countdown expires, the **expiry watchdog** (running in every
   signed-in portal, plus a fuller copy in the admin portal) settles the
   auction: if the top bid clears the reserve, it creates an `escrow` record
   and notifies both parties; otherwise the auction just ends.
5. **Admin** walks the `escrow` record through its five states
   (`initiated → funds_held → asset_delivered → buyer_approved →
   released_to_seller`) and tracks the NTSA transfer status alongside it.
6. **Seller** requests a payout once funds are released; **Admin** marks it
   paid from the Payouts screen.

## Own Stock (the new feature)

Separate from consignment auctions, `stock` is inventory **Galaxy CAH owns
directly** — no bidding, no seller, no inspection. Admins manage it from
**Admin → Own Stock** (add/edit/delete items, set price & quantity). Buyers
see it in their **Store** tab and **Buy Now**; each purchase creates an
`orders` doc and decrements `stock.quantity` atomically. Admins fulfil
orders from **Admin → Store Orders** (pending payment → paid → shipped →
delivered, or cancel).

## Firestore collections

| Collection      | Purpose                                                        |
|------------------|-----------------------------------------------------------------|
| `users`          | One doc per account: role, KYC, reputation, suspended flag      |
| `auctions`       | Consignment listings (the bidding floor)                        |
| `bids`           | Individual bid records, one per bid                             |
| `inspections`    | Inspection jobs, linked to an auction                           |
| `escrow`         | Post-sale settlement tracking + dispute flags                   |
| `disputes`       | Dispute tickets raised against an escrow record                 |
| `stock`          | **Own-stock inventory** (Galaxy CAH-owned, buy-now items)        |
| `orders`         | Buy-now purchases against `stock`                                |
| `payouts`        | Seller payout requests against released escrow funds            |
| `watchlist`      | Buyer ↔ auction favorites                                        |
| `notifications`  | Per-user notification feed (bell icon in every portal's nav)     |
| `settings`       | `settings/global` — platform fee %, listing fee, bid increment % |

## Features by portal

**Buyer** — dashboard, searchable/sortable/filterable auction floor, live
bidding with real-time bid history, watchlist, the buy-now Store, order
tracking, escrow tracker with dispute filing, editable profile.

**Seller** — dashboard with revenue stats, listing creation, listing status
tracking (pending inspection / live / ended / rejected, with rejection
reasons), earnings breakdown (available / pending / lifetime), payout
requests, escrow tracker, editable profile with payout details.

**Inspector** — dashboard, open Job Queue (claim unassigned jobs), My
Assignments, one-click inspection completion (mileage + seal generation +
auto-activates the auction), inspection history log, editable profile.

**Admin** — platform-wide overview & category analytics, user management
(KYC verification, suspend/reinstate), auction moderation (feature,
reject, force-end, delete), **Own Stock CRUD**, inspection assignment,
escrow/dispute resolution with manual NTSA status updates, payout
approvals, store order fulfillment, role-targeted broadcast notifications,
and editable platform settings (fees, increments).

## Notes & next steps for production

- The demo `firestore.rules` file is deliberately permissive around bid/
  auction updates so the client can work without a backend. For a real
  money-moving platform, move bid placement, auction settlement, and escrow
  transitions into **Cloud Functions** so they can't be spoofed from the
  client.
- Image upload isn't wired up (no Firebase Storage calls yet) — asset and
  stock photos currently render as category icons. Add Storage + an
  `<input type="file">` step to the listing/stock forms when you're ready.
- M-Pesa/bank payouts and NTSA transfers are tracked as status strings for
  now; wire up real payment/gov APIs behind the "Advance" buttons when you
  have credentials for them.
