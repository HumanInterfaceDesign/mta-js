# mta-js

A TypeScript client for MTA subway, bus, stop, and alert data with a small normalized API.

```ts
import { MTA } from "mta-js";

const mta = new MTA({
  busTimeKey: process.env.MTA_BUS_KEY,
  databaseUrl: "file:.mta-cache/gtfs.sqlite",
});

await mta.subway.arrivals({ stopId: "A27", route: "A" });
await mta.bus.vehicles({ route: "B63" });
await mta.alerts.current({ mode: "subway" });
await mta.stops.near({ lat, lon, modes: ["subway", "bus"] });
```

## Hosted API

Pass an `apiKey` to use the hosted MTA API instead of calling MTA feeds and local
static GTFS directly. The public method names stay the same, but requests are sent
to `https://www.mtaapi.dev/api/v1` with the key attached.

```ts
import { MTA } from "mta-js";

const mta = new MTA({
  apiKey: process.env.MTA_API_KEY,
});

await mta.subway.arrivals({ stopId: "A27", route: "A" });
await mta.bus.arrivals({ stopId: "308214", route: "M23" });
await mta.bus.vehicles({ route: "M23", limit: 5 });
await mta.alerts.current({ mode: "subway" });
await mta.stops.near({
  lat: 40.7356,
  lon: -73.9804,
  modes: ["subway", "bus"],
  route: "M23",
  includeRoutes: true,
});
```

Use `apiBaseUrl` to point at a preview, staging, or self-hosted compatible API:

```ts
const mta = new MTA({
  apiKey: process.env.MTA_API_KEY,
  apiBaseUrl: "https://staging.example.com",
});
```

## Database

Realtime feeds only become useful after they are joined back to static GTFS stops, routes, and trips. Today, `databaseUrl` points to a SQLite database used by `bun:sqlite`.

```ts
new MTA({ databaseUrl: ":memory:" });
new MTA({ databaseUrl: "file:.mta-cache/gtfs.sqlite" });
new MTA({ databaseUrl: "/var/data/mta-gtfs.sqlite" });
```

For serverless deploys, `databaseUrl` can also point at a remote SQLite snapshot. The client downloads the remote database into local temp storage before opening it with `bun:sqlite`; async API calls wait for that hydration automatically.

```ts
const mta = new MTA({
  databaseUrl: "https://cdn.example.com/mta-gtfs.sqlite",
});

await mta.subway.arrivals({ stopId: "A27", route: "A" });
```

By default, remote databases are hydrated into the system temp directory and reused while that serverless instance stays warm. You can pin the local hydration path when your platform gives you a writable temp directory:

```ts
const mta = new MTA({
  databaseUrl: "https://cdn.example.com/mta-gtfs.sqlite",
  databaseLocalPath: "/tmp/mta-gtfs.sqlite",
});
```

If you want to pay the hydration cost before handling requests, await readiness during startup:

```ts
const mta = new MTA({
  databaseUrl: "https://cdn.example.com/mta-gtfs.sqlite",
});

await mta.ready();
```

Remote SQLite hydration is a read-through snapshot strategy. Local writes, like importing fresh GTFS during a serverless request, update the hydrated copy only; they are not written back to the remote URL.

Turso/libSQL URLs are also supported as embedded replicas. The remote database syncs into a local SQLite file first, then `mta-js` reads that local replica.

```ts
const mta = new MTA({
  databaseUrl: "libsql://mtaapi-transcendent-leo-e3.aws-us-east-1.turso.io",
  databaseAuthToken: process.env.TURSO_AUTH_TOKEN,
  databaseLocalPath: "/tmp/mta-gtfs.sqlite",
});

await mta.ready();
```

Most Turso databases require an auth token. You can omit `databaseAuthToken` only for databases configured to allow anonymous reads.

The name is intentionally broader than a filesystem path so the public API can grow into hosted database adapters later without changing constructor shape.

You can inspect whether each transit mode has static GTFS ready before serving traffic:

```ts
await mta.database.status();
```

## DB Push

`mta-js` has a Drizzle-like schema push for its fixed GTFS schema. It does not generate migration files; it applies idempotent `create table if not exists` and `create index if not exists` statements.

```ts
const mta = new MTA({
  databaseUrl: process.env.TURSO_DATABASE_URL,
  databaseAuthToken: process.env.TURSO_AUTH_TOKEN,
});

await mta.database.push();
```

You can import official subway GTFS with the CLI. `core` is the default production strategy and imports stops/routes only; `schedule` also imports trips and stop times.

```sh
bun src/cli.ts db import --mode=subway --strategy=core
bun src/cli.ts db import --mode=subway --strategy=schedule
```

You can also make startup self-heal static data for a mode. If the import marker is missing, this writes the seed to the configured database and rehydrates the local replica. The default strategy is `core`.

```ts
await mta.database.ensureStaticData({
  mode: "subway",
  strategy: "core",
  seed: {
    stops: [
      { stop_id: "L06", stop_name: "1 Av", stop_lat: 40.730953, stop_lon: -73.981628 },
      { stop_id: "L06N", stop_name: "1 Av", parent_station: "L06" },
      { stop_id: "L06S", stop_name: "1 Av", parent_station: "L06" },
    ],
    routes: [
      { route_id: "L", route_short_name: "L", route_long_name: "14 St-Canarsie Local", route_type: 1 },
    ],
  },
});
```

From the CLI:

```sh
MTA_DATABASE_URL=libsql://your-db.turso.io \
MTA_DATABASE_AUTH_TOKEN=... \
bun src/cli.ts db import --mode=subway --strategy=core
```

Live Turso integration tests are opt-in so normal test runs do not depend on credentials, network, or local proxy certificate state:

```sh
TURSO_INTEGRATION_TEST=1 \
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=... \
bun test
```

The live write integration test is separately opt-in so read-only Turso tokens do not create false confidence:

```sh
TURSO_INTEGRATION_TEST=1 \
TURSO_WRITE_TEST=1 \
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=... \
bun test
```

If libSQL reports `invalid peer certificate: UnknownIssuer`, disable HTTPS interception for Turso/libSQL in your proxy tool or run the live Turso test without the proxy. The native libSQL sync client may not trust a debugging proxy certificate even when `fetch` requests do.

Live MTA/Bustime integration tests are opt-in so normal test runs do not depend on external MTA availability:

```sh
MTA_LIVE_TEST=1 bun test
```

With a BusTime key:

```sh
MTA_LIVE_TEST=1 \
MTA_BUS_KEY=... \
bun test
```

Full subway GTFS import tests are also opt-in because they download, unzip, and import the real MTA subway GTFS feed:

```sh
MTA_LIVE_TEST=1 \
MTA_FULL_GTFS_TEST=1 \
bun test
```

To run the full GTFS import against Turso:

```sh
MTA_LIVE_TEST=1 \
MTA_FULL_GTFS_TEST=1 \
TURSO_INTEGRATION_TEST=1 \
TURSO_WRITE_TEST=1 \
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=... \
bun test
```

## Static GTFS

```ts
await mta.static.importZipFromUrl(
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip",
  "subway",
);
```

Tests and small scripts can seed the cache directly:

```ts
mta.static.importSeed(
  {
    stops: [{ stop_id: "A27", stop_name: "Jay St-MetroTech" }],
    routes: [{ route_id: "A", route_short_name: "A", route_type: 1 }],
  },
  "subway",
);
```

## Roadmap

- Expand the package beyond NYC MTA into a normalized US metro SDK while keeping the existing MTA API stable.
- Prioritize large systems with documented APIs and realtime data first: MBTA (Boston), WMATA (DC), CTA (Chicago), and BART (Bay Area).
- Add adapters for mid-tier systems that expose GTFS, GTFS Realtime, or partial APIs, including SEPTA, LA Metro, and MARTA.
- Model agency-specific quirks behind shared concepts like arrivals, vehicles, service alerts, route-aware nearby stops, static GTFS import, and hosted API access.
- Track smaller agencies separately because support quality varies: some only publish static GTFS, some have buried realtime feeds, and some have no public API surface.

## Development

```sh
bun install
bun test
bun run typecheck
```
