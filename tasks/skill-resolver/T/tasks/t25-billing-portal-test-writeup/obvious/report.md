# Kestrel Billing staging: security assessment report

**Client:** Kestrel Billing Ltd
**Dates:** 27 to 30 October 2026
**Tester:** Sam Ortega
**Authorized by:** Ana Ruiz, CTO (written, 26 October 2026)

## Executive summary

We tested the staging portal and API. The most serious problem is that any logged-in user can read other customers' invoices by changing the invoice id in the API. We recommend fixing this before the next release. We also found a missing cookie attribute and two issues that need more testing.

## Scope

- portal.staging.kestrelbilling.com
- api.staging.kestrelbilling.com

Denial of service, rate limiting, social engineering and production systems were excluded.

## Findings

### 1. Cross-tenant invoice access (IDOR): High
`GET /api/invoices/{id}` on api.staging.kestrelbilling.com returns any tenant's invoice to any logged-in user. As a tenant 1041 user, invoice 88213 (tenant 2077, "Hollis & Daughters") came back with amount and billing address. Ids 88210 to 88220 all behaved the same.

**Fix:** enforce a tenant ownership check on every invoice read, ideally in the data layer; add a two-tenant regression test.

### 2. Possible reflected XSS in search: Medium (unconfirmed)
`/invoices?q=` reflects input without escaping. The Content Security Policy blocked all payloads, so no script ran.

**Fix:** HTML-encode the search term on output; don't rely on CSP alone.

### 3. Possible open redirect on logout: Low (unconfirmed)
`/logout?next=https://example.org` redirected off-site. We could not check for an allowlist in the time available.

**Fix:** only allow relative paths or a fixed list of hosts in `next`.

### 4. Session cookie missing SameSite: Low
`ks_session` is set with Secure and HttpOnly but no SameSite.

**Fix:** add `SameSite=Lax`.

## Other observations

legacy-admin.kestrelbilling.com was outside the agreed scope, so we did not test it, but it shows a directory listing at its root. Worth checking whether it should be public.

## Tools

Burp Suite Community, curl, ffuf, nuclei, browser developer tools.

## Not covered

Mobile API, payment provider callbacks, and load or rate-limit testing.
