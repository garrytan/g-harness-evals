# microsoft__apm-1553
Passes: X 0 of 2, Y 1 of 2
Fault named in the instruction: no (the issue gives only logs; no file or function is named)
- X-a1 FAIL: right place but incomplete or wrong fix. Fixed only the Azure DevOps single-file download auth in download_ado_file (az token fallback, reject 203 sign-in pages); plain installs still re-fetch unpinned single-file deps every run.
- X-a2 FAIL: right place but incomplete or wrong fix. Same auth-only fix in download_ado_file plus a redirect-suppress header; did not touch the install path that re-downloads deps with no resolved commit.
- Y-a1 FAIL: right place but incomplete or wrong fix. Same auth-only fix in download_ado_file with tests; nothing in the install phases.
Passing tries did differently: Y-a2 made the same auth fix and also changed install/phases (integrate.py, download.py) so a lockfile entry with a content_hash but no resolved_commit is reused from disk instead of re-fetched on plain install, arguing a moving ref would still trip the hash check.
Rating: WEAK, favours Y. Only one Y try went beyond the shared auth diagnosis, so the split is within Y as much as between agents.
