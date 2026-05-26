# mta-js

TypeScript client for MTA realtime feeds and the hosted MTA API.

## Hosted API

Use an API key from `mtaapi.dev` for route-aware static lookups and managed
realtime endpoints:

```ts
import { MTA } from "mta-js";

const mta = new MTA({
  apiKey: process.env.MTA_API_KEY,
});

const nearby = await mta.stops.near({
  lat: 40.7356,
  lon: -73.9804,
  modes: ["bus"],
  route: "M23",
  includeRoutes: true,
});

const lTrain = await mta.subway.arrivals({
  stopId: "L08",
  route: "L",
});
```

When `apiKey` is present, `mta-js` sends requests to the hosted API at
`https://www.mtaapi.dev` by default. Override `apiBaseUrl` for tests or private
deployments.

## Direct MTA Feeds

You can still call MTA realtime feeds directly without the hosted API:

```ts
const mta = new MTA({
  busTimeKey: process.env.MTA_BUS_KEY,
});

const buses = await mta.bus.arrivals({
  stopId: "308214",
  route: "M23",
});
```

Direct feed mode has no bundled SQLite, Turso, or persistent GTFS database. If
you need richer local metadata, pass a small in-memory `staticData` seed:

```ts
const mta = new MTA({
  staticData: {
    stops: [
      {
        stop_id: "L08",
        stop_name: "Bedford Av",
        stop_lat: 40.717304,
        stop_lon: -73.956872,
      },
    ],
    routes: [
      {
        route_id: "L",
        route_short_name: "L",
        route_long_name: "14 St-Canarsie Local",
      },
    ],
  },
  staticDataMode: "subway",
});
```

For production static stop search, prefer the hosted API. It serves a compact
Blob-backed snapshot instead of requiring each SDK consumer to manage GTFS
imports.

## Endpoints

- `mta.subway.arrivals(...)`
- `mta.bus.arrivals(...)`
- `mta.bus.vehicles(...)`
- `mta.alerts.current(...)`
- `mta.stops.near(...)`
