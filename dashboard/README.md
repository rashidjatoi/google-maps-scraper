# Atlas — Google Maps workspace

This fork includes an all-Vercel backend: Vercel Functions provide the authenticated job API, a Vercel Daemon runs the real Google Maps scraper in a container, and private Vercel Blob stores jobs and result files. No separate VPS is required. Daemons and Services are Vercel beta features; see their current account limits before use.

## Vercel project setup

Import `rashidjatoi/google-maps-scraper`, with the project Root Directory set to the repository root (leave it empty), not `dashboard`. The root `vercel.json` defines the dashboard service and scraper daemon. The shared UI is also embedded in native Go builds.

Create a **private Vercel Blob store** in the same project and connect it to Production. Set:

- `ATLAS_BACKEND=vercel`
- `ATLAS_APP_URL=https://your-production-domain.vercel.app`
- `ATLAS_WORKER_SECRET`: a unique random worker credential, stored as a Vercel secret.
- `DASHBOARD_PASSWORD`: a long, unique workspace password, stored as a Vercel secret.
- `BLOB_READ_WRITE_TOKEN`: supplied by the Blob store connection.

Keep all credentials server-side. Production environment variables are shared with the dashboard service and daemon. The session uses an HttpOnly, Secure, SameSite cookie and expires after 12 hours. This is one private shared workspace, not a multi-user account system.

The daemon runs in Production only. Preview deployments do not have their own worker. Do not connect untrusted preview code to the production Blob store or worker secrets.

## How searches work

1. The authenticated API validates a batch of 1–10 queries and stores a pending job in private Blob.
2. One daemon checks for jobs about once a minute and claims the oldest queued search using a conditional write.
3. The daemon runs the real scraper with Chromium, one concurrent browser, and the chosen settings. Email extraction and extended reviews are supported.
4. A lease and heartbeat prevent deployment rollouts from processing the same job concurrently. Interrupted searches retry up to three times.
5. Results upload directly from the worker to private Blob. Only authenticated dashboard downloads can read them.

A search may take several minutes. The worker enforces the requested time limit; timed-out searches are marked failed and may have partial results. The workspace holds up to 200 jobs and 10 queued/running searches. Delete finished searches to free space.

The pinned scraper image comes from the upstream project. UI changes deploy from this fork. To change the scraping engine itself, rebuild an image from your modified Go source and update the worker Dockerfile's image reference.

## Quotas and storage

On Vercel Hobby, the Daemons beta has a shared monthly Active CPU quota. Exhausting it stops workers until the quota resets; waiting for work uses no Active CPU. Blob and Function quotas also apply. Avoid repeatedly queuing large searches. Jobs and CSV data survive worker restarts because they are stored in private Blob, not the worker's temporary disk.

Large result downloads remain subject to Vercel Function response limits and browser memory. For very large datasets, add authenticated presigned downloads or use the optional external backend mode below. Do not imply a job with no result file completed successfully; failures remain visible in the UI.

## Local checks

```sh
cd dashboard
npm ci
npm test
npm run build
```

The tests cover exports, session authentication, path restrictions, input validation, secret redaction, and concurrent durable-queue updates. To validate the worker image:

```sh
docker build -t atlas-worker workers/scraper
docker run --rm --entrypoint node atlas-worker --version
```

Running the worker locally against the production queue consumes real searches. Use a separate store, test endpoint and secrets for development.

## Optional external backend

Set `ATLAS_BACKEND` to a value other than `vercel` and configure `SCRAPER_API_URL` with the HTTPS origin of a standard Go web-runner server. `SCRAPER_API_TOKEN` optionally authenticates to a reverse proxy in front of it. The standard upstream API has no built-in bearer authentication; do not expose it publicly without access controls. Remove or disable the daemon when using an external backend.

## Downloads

The UI exports selected fields from every matching row across all pages as CSV, native XLSX, JSON, TSV and GeoJSON. CSV/TSV neutralize spreadsheet formulas; XLSX uses text cells to preserve identifiers and phone numbers. JSON preserves source field strings. GeoJSON excludes rows without valid coordinates.

The actual scraper does not require AI or an AI API key. The upstream optional AI-agent skill helps plan and operate searches; data collection uses browser automation.
