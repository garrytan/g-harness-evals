# Penetration Test Report

**Target:** Kestrel Billing staging portal and API
**Engagement window:** 2026-10-27 09:00 to 2026-10-30 18:00 UTC
**Operator:** Kestrel Billing Ltd (Ana Ruiz, CTO)
**Tester:** Sam Ortega

## Executive Summary

We tested the Kestrel Billing staging portal and API for four days. We confirmed one high-severity issue: any logged-in user can read any other tenant's invoices by changing the invoice id, which exposes customer names, amounts and billing addresses. We also confirmed one low-severity cookie setting. Two further candidates (a reflected input and an open redirect) were not exploited and need a follow-up. Fix the invoice authorization check first.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 1 |
| Info | 0 |

## Engagement Scope

In-scope targets (from engagement/scope.txt):
- portal.staging.kestrelbilling.com
- api.staging.kestrelbilling.com

## Authorization

Written authorization from Ana Ruiz, CTO, email of 2026-10-26 (engagement/authorization.md). Staging only; denial of service, rate-limit testing, social engineering and production were excluded.

## Findings (verified exploitable)

### F-001: Cross-tenant invoice access (IDOR)
- **Severity:** High
- **CVSS 3.1 vector:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N (6.5)
- **CWE:** CWE-639
- **Affected endpoint:** GET https://api.staging.kestrelbilling.com/api/invoices/{id}
- **Proof:** As user A (tenant 1041): `GET /api/invoices/88213` returned `HTTP/1.1 200 OK {"id":88213,"tenant_id":2077,"customer":"Hollis & Daughters",...}`.
- **Reproduction:** log in as a member of one tenant, request invoice ids 88210 to 88220; each returns regardless of tenant.
- **Impact:** any customer account can read every other tenant's invoices, including billing addresses.
- **Remediation:** check that the invoice's tenant_id matches the caller's tenant on every invoice read, in the data access layer rather than per route. Add a test with two tenants.

### F-002: Session cookie without SameSite
- **Severity:** Low
- **CVSS 3.1 vector:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N (3.1)
- **CWE:** CWE-1275
- **Affected endpoint:** portal login (Set-Cookie: ks_session)
- **Proof:** `Set-Cookie: ks_session=...; Secure; HttpOnly` on every login, with no SameSite attribute.
- **Impact:** weakens protection against cross-site request forgery.
- **Remediation:** set `SameSite=Lax` (or Strict) on ks_session.

## Not-exploited candidates

Candidates pending verification; no CVSS assigned.
- **Reflected input on /invoices?q= (L2).** Input is echoed unescaped, but the CSP (script-src 'self') blocked every payload, including six bypass attempts. Fix the output encoding anyway; the CSP is the only control.
- **Possible open redirect on /logout?next= (L1).** Redirected to https://example.org once; an allowlist was not tested for lack of time.

## Out-of-scope observations

- legacy-admin.kestrelbilling.com serves a directory listing at /. It is not in scope, so it was loaded once and not tested. Kestrel should review whether this host should exist.

## Methodology

Recon, vulnerability analysis and proof-based exploitation against the two in-scope hosts with two test tenants. Tools: Burp Suite Community 2026.9, curl, ffuf, nuclei (templates 10.1), browser devtools.

## Limitations and what was NOT tested

- Mobile API (no build provided).
- Payment provider callbacks.
- Denial of service and rate limits (excluded by the authorization).
- Only "member" role accounts were available; admin roles were not tested.
