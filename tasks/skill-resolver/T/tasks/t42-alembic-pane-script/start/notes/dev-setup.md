# Dev box setup (billing-api)

We all work on the shared dev box over SSH and keep long-lived tmux sessions there.

- Session `api`: window 0 is a shell in ~/src/billing-api with .venv activated and the VPN variables
  from `scripts/vpn-env.sh` already sourced (they only exist in that shell). Window 1 runs the dev server.
- Session `db`: psql against the staging replica.
- Migrations: `alembic upgrade head` from the api shell. A typical run takes 20 seconds to 3 minutes
  and ends with lines like "INFO  [alembic.runtime.migration] Running upgrade 4c1e -> 9ab2".
- Do not kill or restart the api shell; re-sourcing the VPN env needs a hardware key.
