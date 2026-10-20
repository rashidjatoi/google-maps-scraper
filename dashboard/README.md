# Atlas maps workspace

A complete frontend for the existing Google Maps Scraper API. Search batches of queries, configure language, coordinates, depth, email extraction and extended reviews, follow job statuses, duplicate jobs, inspect searchable/paginated results, and export selected columns as CSV, native XLSX, JSON, TSV or GeoJSON.

The scraper does not require AI. Its optional AI-agent skill orchestrates searches; the actual scraping uses browser automation.

## Vercel deployment

Import `rashidjatoi/google-maps-scraper` into Vercel and choose **dashboard** as the Root Directory. Enable **Include source files outside of the Root Directory in the Build Step**: the build copies the same frontend files embedded by the Go server from `../web/static`. Framework preset: Other. Build: `npm run build`. Output: `dist`. No frontend dependencies are needed.

Set server-side environment variables in Vercel:

- `SCRAPER_API_URL`: HTTPS origin of a persistent scraper server, e.g. `https://scraper.example.com`. No `/api/v1` suffix.
- `DASHBOARD_PASSWORD`: a long, unique workspace password. Required when connecting the backend. Authentication uses a signed HttpOnly, Secure, SameSite cookie lasting 12 hours. This is a single shared workspace, not a multi-user account system.
- `SCRAPER_API_TOKEN`: optional bearer token required by your backend's reverse proxy. The upstream Go web API itself has no bearer-auth feature. Configure authentication at the reverse proxy before exposing it.

Do not put credentials in public frontend variables or commit `.env` files. Vercel rebuilds from GitHub when changes reach the production branch. Environment changes require redeployment. Keep deployment protection or an access gateway enabled if stronger workspace controls are needed.

The frontend shows an explicit setup/connection error until a real backend is configured. It never ships sample business records or simulated search results.

## Persistent scraper backend

Vercel only hosts the UI and short API requests. Google Maps scraping runs on a separate persistent host with Chromium, durable disk, and adequate memory. Use the repository Dockerfile to build your fork on that host:

```sh
docker build -t atlas-scraper .
docker run -d --name atlas-scraper --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v atlas-data:/gmapsdata \
  -e DISABLE_TELEMETRY=1 \
  atlas-scraper -data-folder /gmapsdata
```

Place an authenticated HTTPS reverse proxy in front of `127.0.0.1:8080`. Keep its token server-side in Vercel. Do not expose the unauthenticated upstream service directly on a public port. The existing SaaS edition has separate API-key authentication and a different API contract; this dashboard targets the standard web runner's `/api/v1/jobs` API.

The native Go server also serves this frontend at `/`; rebuild the binary or Docker image after frontend changes. Native Go mode retains its existing access model and does not use the Vercel password endpoint; keep it private behind your gateway.

## Local verification

```sh
cd dashboard
npm test
npm run build
```

Node 20+ is required for these dependency-free tests/builds. To run the real scraper, follow the root README's Go or Docker instructions. The repository's Go toolchain version is defined by `go.mod`.

## Exports and limits

All exports use the downloaded CSV as the source of truth and run in the browser. Every matching row across all pages is exported, with only the selected fields. CSV/TSV protect spreadsheet applications against formula injection; XLSX uses explicit text cells to preserve phone numbers and identifiers. JSON preserves original field strings. GeoJSON excludes rows with missing or invalid coordinates, and keeps valid zero coordinates. Export selection does not change which fields the backend collects.

Large results consume browser memory. Vercel's function response-size and execution limits can also limit very large proxied CSV downloads; for datasets beyond those limits use the native backend's authenticated download path or add object-storage delivery. Searches themselves keep running on the persistent backend.

## Verification performed

- Export tests cover quoted CSV, Unicode, multiline fields, formula protection, field selection, valid GeoJSON and native XLSX structure.
- Proxy tests cover path restrictions, missing configuration, session authentication, credential forwarding and cross-origin rejection.
- Browser fixture tests cover job creation, result viewing, pagination, email filters and export selection. Fixtures are development-only and are not deployed.
- Live Google Maps scraping requires the separately deployed backend and is not represented by fixture testing.
