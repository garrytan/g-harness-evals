# parcel-pulse

Small Flask service that emails customers when their parcel status changes.

## Local development

1. Copy `.env.example` to `.env` and fill in every value.
2. `pip install -r requirements.txt`
3. `flask --app parcel_pulse run`

Email goes out through Postmark. Errors go to Sentry. Deploys run from GitHub Actions (see `.github/workflows/deploy.yml`).
