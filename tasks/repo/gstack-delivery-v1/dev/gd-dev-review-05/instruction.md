A teammate opened a change on branch `feature/806e0b` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Sign cookies as JSON instead of pickle**

Signed cookies no longer use pickle. `response.set_cookie(name, value, secret=...)` now stores any JSON serializable value, signed with an HMAC (`digestmod`, default SHA-256) over the cookie name and the payload, so a signed value is only valid under the name it was set with. `secret` may be a list of secrets for key rotation: the first one signs, and `request.get_cookie()` accepts a signature made with any of them. When `max_age` (seconds or a timedelta) or `expires` is set, the expiry time is signed into the cookie as well, and `get_cookie()` returns the default once it has passed, even if the browser still sends the cookie. Given a secret, `get_cookie()` never raises and returns the default for anything that is not a valid signed cookie: a missing, unsigned, tampered, expired or old pickle-format cookie. Updates the signed cookie tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
