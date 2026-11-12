# Questions for Dana: Tallyhouse log renewal

Hi Dana,

We need to tell finance by 2026-11-20 whether to renew Tallyhouse ($46,800 a year, up from $38,000) or self-host OpenSearch (about $21,000 a year plus on-call time). Before I can recommend either, I need your view on the security side. Please answer inline when you get a chance, ideally by 2026-11-17.

## Retention

1. How long do we need to keep application logs for SOC 2? Does that need to be searchable, or is archived storage enough?
2. Is 90 days of searchable logs enough for incident investigations?

## Customer data

3. Some services log customer email addresses. Are there restrictions on where those logs can be stored?
4. Should we scrub email addresses before logs are shipped anywhere?

## Audit and incidents

5. Does the incident response runbook rely on Tallyhouse features such as saved searches or alerts?
6. Would a move to self-hosted logging need sign-off from the auditor?

If there is anything else that would push you toward one option or the other, please add it at the end.

Thanks!
