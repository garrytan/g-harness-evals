# Incident notes: nightly invoice export

- The export runs from cron at 02:00 on billing-vm-2 (`/etc/cron.d/invoice-export`).
- 2026-10-09: the VM rebooted for patching at 01:55; the job never ran. Nobody noticed until finance asked on the 11th.
- 2026-10-23: the script hit a full /tmp and exited 1. Cron mailed root, which nobody reads.
- The export writes one CSV per customer to the finance bucket. Finance needs it by 08:00.
- Volume: about 1,400 customers, the job takes 12 minutes.
- Ops (Priya, Tomasz) are short on time this quarter; they would rather not run new infrastructure.
