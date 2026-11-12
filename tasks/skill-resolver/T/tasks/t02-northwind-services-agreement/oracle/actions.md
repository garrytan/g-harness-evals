# Northwind MSA: proposed actions for Larkspur

Source: docs/msa-northwind.md (signed 2026-10-28, effective 2026-11-01). This is an extraction, not legal advice. The agreement names no owners, so every owner below is unresolved until ops assigns one.

## Extracted facts

- Parties: Larkspur Goods Ltd is the Customer (us); Northwind Freight Inc is the Provider. (§1)
- Initial term: 24 months from 2026-11-01, so it ends 2028-10-31, then renews for 12 months unless notice is given. (§6.1)
- Business Day excludes weekends and UK bank holidays. (§1)

## Proposed actions

### A1. Send the monthly volume forecast
- Outcome: Northwind holds our forecast of monthly shipment volumes.
- Owner: unresolved
- Due: 2026-11-20 (15 Business Days after 2026-11-01)
- Dependency: none
- Acceptance condition: forecast delivered in writing and receipt confirmed by Northwind.
- Risk: a breach of a "must" in the first month of the relationship.
- Modality: must
- Citation: §2.1

### A2. Nominate an operations contact
- Outcome: Northwind has a named Larkspur operations contact in writing.
- Owner: unresolved
- Due: unresolved (before the first shipment; no shipment date is in the agreement)
- Dependency: date of the first shipment
- Acceptance condition: written nomination sent and acknowledged.
- Risk: the first shipment cannot be handled cleanly without a contact.
- Modality: shall
- Citation: §2.2

### A3. Send the goods-in-transit insurance certificate
- Outcome: Northwind holds a certificate showing cover of at least GBP 250,000 per consignment.
- Owner: unresolved
- Due: 2026-12-01
- Dependency: the policy must already meet the GBP 250,000 per consignment limit
- Acceptance condition: certificate sent; the policy limit is checked against §3.1 before sending.
- Risk: uninsured consignments; breach of a "must".
- Modality: must
- Citation: §3.1

### A4. Pay undisputed invoices on time (recurring)
- Outcome: every undisputed Northwind invoice is paid within 30 days of its invoice date.
- Owner: unresolved
- Due: 30 days after each invoice date (invoices arrive monthly in arrears)
- Dependency: invoice approval workflow in accounts payable
- Acceptance condition: payment terms of 30 days set on the Northwind supplier record.
- Risk: late payment breach.
- Modality: must
- Citation: §4.1, §4.2

### A5. Set up the invoice dispute window (recurring)
- Outcome: disputes are raised in writing within 10 Business Days of receipt, listing the disputed lines.
- Owner: unresolved
- Due: 10 Business Days after each invoice is received
- Dependency: A4
- Acceptance condition: accounts payable checklist includes the 10 Business Day dispute check.
- Risk: losing the right to dispute a wrong invoice.
- Modality: must
- Citation: §4.3

### A6. Add the 48-hour breach notice to incident response
- Outcome: any personal data breach affecting shipment data is reported to Northwind within 48 hours.
- Owner: unresolved
- Due: before the first shipment data is shared (no date in the agreement)
- Dependency: Northwind's breach notice contact, which the agreement does not give
- Acceptance condition: the incident runbook has a Northwind notification step with a contact.
- Risk: missing a 48-hour regulatory-style deadline.
- Modality: must
- Citation: §5.1

### A7. Get Schedule 2 and diary the annual review
- Outcome: we hold Schedule 2 and review it once a year.
- Owner: unresolved
- Due: unresolved (annual; no first review date given)
- Dependency: a copy of Schedule 2, which is missing from our copy
- Acceptance condition: Schedule 2 on file and a yearly review reminder set.
- Risk: we cannot follow an annex we do not have.
- Modality: shall
- Citation: §5.2, note at end of the agreement

### A8. Decide on renewal before the notice deadline
- Outcome: a renew or exit decision made in time to give notice if needed.
- Owner: unresolved
- Due: 2028-08-02 (90 days before the term ends on 2028-10-31)
- Dependency: none
- Acceptance condition: decision recorded and, if exiting, written notice sent.
- Risk: an unwanted 12-month auto-renewal.
- Modality: may (notice is optional; without it the agreement renews)
- Citation: §6.1

## Conditional, not a task yet

- If Northwind requests a site visit, we should accommodate it within 10 Business Days. This is a "should", triggered only by a request. (§2.3)

## Blockers and assumptions

- Schedule 2 is missing from our copy (A7).
- No owners are named anywhere in the agreement.
- Business Day counts assume no UK bank holidays fall in November 2026.
