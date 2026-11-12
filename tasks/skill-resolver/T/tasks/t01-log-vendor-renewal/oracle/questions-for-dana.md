# Tallyhouse log renewal: questions for Dana

**Purpose:** I have to tell finance by 2026-11-20 whether we renew the Tallyhouse log storage contract ($46,800 a year) or move to self-hosted OpenSearch (about $21,000 a year plus on-call time). The choice turns on security and audit needs that only you know.

**From:** Platform team · **To:** Dana (security lead) · **How your answers will be used:** they go straight into the renew-or-migrate recommendation for finance, and into the migration plan if we move.

## Context

Our contract ends on 2026-12-31. Tallyhouse keeps 90 days of logs searchable. Self-hosting would put logs on our own cluster, run by us. We do not know what retention the audit needs or whether the customer email addresses in some logs restrict where logs can live, so we cannot compare the two options yet.

## How to answer

Please reply by 2026-11-17. It should take about 20 minutes. Partial answers and "I don't know" are useful: flag anything you are unsure of rather than skipping it.

## Retention

### How long must application logs stay searchable for SOC 2?

_Why this matters: Tallyhouse prices by searchable retention, so 90 days versus a year changes the quote a lot._

>

### Can logs older than the searchable window sit in cheap archive storage instead?

>

## Customer data

### Do logs that contain customer email addresses have to stay in a specific region?

_Why this matters: self-hosting is only an option if our own cluster's region is allowed._

>

### Would you require us to strip email addresses before logs are stored?

>

## Audit and incidents

### Does the incident response runbook depend on any Tallyhouse feature, such as saved searches or alerts?

>

### Would a move to self-hosting have to be reported to the auditor before it happens?

>

## Anything else?

Is there anything we did not ask that we should know before deciding?

>
