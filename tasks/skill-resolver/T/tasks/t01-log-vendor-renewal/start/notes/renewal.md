# Tallyhouse renewal

- Our Tallyhouse log storage contract ends on 2026-12-31. The renewal quote is $46,800 a year for 90 days of searchable retention, up from $38,000.
- Alternative: self-host OpenSearch on our own cluster. Infra's rough cost is $21,000 a year in machines plus about one day a month of on-call time.
- I don't know what retention security actually needs. The SOC 2 auditor said "a year" last spring, but I don't know if that meant searchable or archived.
- Some services log customer email addresses. I don't know if that limits where logs can live.
- Dana (security lead) owns the audit evidence and the incident response runbook. She is the one who knows.
- I have to tell finance by 2026-11-20 whether we renew.
