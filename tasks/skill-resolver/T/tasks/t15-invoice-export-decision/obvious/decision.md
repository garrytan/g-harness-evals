# Nightly invoice export failures

## Background

The invoice export cron job on billing-vm-2 failed twice in October: once because the VM rebooted at 01:55, once because /tmp filled up. Both times nobody noticed for days.

## Choices

1. **Add monitoring and alerting to the existing cron job.** Cheap and quick, but the job still lives on one VM.
2. **Move the job to the CI scheduler.** No VM to maintain and logs come for free, but CI needs the bucket credentials.
3. **Rebuild it as a queue worker.** Most robust, but a lot of work and new infrastructure for ops.

## Recommendation

Go with choice 1 for now: add a heartbeat check, a retry and a cleanup of /tmp. Revisit moving to CI next quarter.

## Next steps

- Set up the heartbeat alert.
- Add the retry wrapper.
- Test a forced failure.
