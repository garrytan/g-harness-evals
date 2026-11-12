# Raw notes, Kestrel staging test (Oct 27 to 30)

Tools: Burp Suite Community 2026.9, curl, ffuf, nuclei (templates 10.1), browser devtools.
Test accounts: user A (tenant 1041), user B (tenant 2077), both "member" role.

1. IDOR on invoices. As user A, GET https://api.staging.kestrelbilling.com/api/invoices/88213 returns tenant 2077's invoice (customer name, amount, billing address). Tried ids 88210 to 88220, every one returned regardless of tenant.
   Request:  GET /api/invoices/88213  Authorization: Bearer <user A token>
   Response: HTTP/1.1 200 OK {"id":88213,"tenant_id":2077,"customer":"Hollis & Daughters","amount":"4210.00","billing_address":"..."}
2. Reflected XSS? Portal search /invoices?q= echoes the input unescaped into the page. CSP (script-src 'self') blocked every payload, including the 6 bypasses on my list. Never got execution.
3. Open redirect? /logout?next=https://example.org redirects off-site. Tried once, out of time; did not check whether there is an allowlist.
4. Session cookie has no SameSite attribute. Seen on every login: Set-Cookie: ks_session=...; Secure; HttpOnly
5. While enumerating DNS I saw legacy-admin.kestrelbilling.com (NOT in scope) serving a directory listing at /. One page load only; nothing else done.

Not tested: mobile API (no build provided), payment provider callbacks, anything rate-limit or DoS (excluded).
