# mta-js

TypeScript client for MTA realtime feeds and the hosted MTA API.

## Hosted API

Use an API key from `mtaapi.dev` for route-aware static lookups and managed
realtime endpoints:

```js
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

const direction = await mta.subway.direction({
  route: "L",
  fromStopId: "L06",
  destination: "Union Sq",
});

const subwayBoard = await mta.subway.arrivalBoard({
  lat: 40.7356,
  lon: -73.9906,
  limitStations: 5,
  limitArrivals: 3,
});

const busBoard = await mta.bus.arrivalBoard({
  lat: 40.7421,
  lon: -73.9914,
  route: "M23",
  limitStops: 8,
  limitArrivals: 3,
});

const favoriteStops = await mta.stops.byIds({
  ids: ["A27", "L06", "308214"],
  includeRoutes: true,
});

const routes = await mta.routes.list({
  modes: ["subway", "bus"],
});

const lStations = await mta.subway.routeStations({
  route: "L",
  direction: "uptown",
});

const m23Stops = await mta.bus.routeStops({
  route: "M23",
  direction: 0,
});
```

Arrival rows may include display-oriented fields. `destination` depends on
destination metadata, while `displayDirection` may still be present as a
generic fallback label:

```js
for (const arrival of lTrain) {
  console.log(
    `${arrival.route.shortName} ${arrival.displayDirection ?? arrival.destination ?? "unknown direction"} from ${arrival.stop.displayName ?? arrival.stop.name}`,
  );
}
```

Use `mta.subway.direction(...)` when a rider enters an intermediate destination
such as `Union Sq`; the hosted API resolves it against static GTFS route order
and returns a typed `direction`, `destinationStop`, and terminal-facing
`displayDirection` such as `toward 8 Av`.

NYC Subway realtime feeds use NYCT's `north`/`south` stop directions, even on
east-west lines. For the L train, `mta-js` accepts rider-facing `east`/`west`
aliases and maps them to the underlying feed directions.

When `apiKey` is present, `mta-js` sends requests to the hosted API at
`https://www.mtaapi.dev` by default. Override `apiBaseUrl` for tests or private
deployments.

## Regional transit

The hosted API also provides regional methods for PATH, NJ Transit Rail, NYC
Ferry, Citi Bike, LIRR, Metro-North, MBTA, BART, King County Metro, CapMetro,
Pace, Tri-Rail, Brightline, Denver RTD, Metro Transit, Pittsburgh Regional
Transit, MARTA, VIA, GCRTA, CATS, SacRT, MARC, UTA, JTA, Muni, Caltrain, Bay
Wheels, Divvy, Bluebikes, Capital Bikeshare, Biketown, Indego, and Metro Bike
Share:

```js
const pathArrivals = await mta.path.arrivals({ station: "JSQ", direction: "to-ny" });
const njDepartures = await mta.njTransit.rail.departures({ station: "NY", limit: 5 });
const ferryArrivals = await mta.nycFerry.arrivals({ stop: "17", limit: 5 });
const bikeStations = await mta.citiBike.stations({
  lat: 40.6924,
  lon: -73.9873,
  limit: 5,
});
const lirrDepartures = await mta.lirr.departures({ stop: "Penn Station", limit: 5 });
const metroNorthDepartures = await mta.metroNorth.departures({
  stop: "Grand Central",
  limit: 5,
});
const rtdRoutes = await mta.rtd.routes();
const muniRoutes = await mta.muni.routes();
const caltrainDepartures = await mta.caltrain.departures({
  stop: "San Francisco Caltrain Station",
  limit: 5,
});
const divvyStations = await mta.divvy.stations({
  lat: 41.88,
  lon: -87.63,
  limit: 5,
});
```

## Direct MTA Feeds

You can still call MTA realtime feeds directly without the hosted API:

```js
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

```js
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

Route and stop inputs include generated autocomplete for known MTA values while
remaining permissive for future route and stop additions. Refresh the generated
types from the hosted stops snapshot by setting `MTA_STOPS_SNAPSHOT_URL` or
`NEXT_PUBLIC_MTA_STOPS_SNAPSHOT_URL` and running `bun run generate:types`. Bus
route autocomplete is generated from public MTA borough GTFS route files by
default; set `MTA_BUS_GTFS_URLS` to a comma-separated list of GTFS zip URLs to
override them.

## Endpoints

- `mta.subway.arrivals(...)`
- `mta.subway.arrivalBoard(...)`
- `mta.subway.direction(...)`
- `mta.subway.routeStations(...)`
- `mta.bus.arrivals(...)`
- `mta.bus.arrivalBoard(...)`
- `mta.bus.routeStops(...)`
- `mta.bus.vehicles(...)`
- `mta.alerts.current(...)`
- `mta.routes.list(...)`
- `mta.stops.byIds(...)`
- `mta.stops.near(...)`
- `mta.path.stations()`
- `mta.path.routes()`
- `mta.path.arrivals(...)`
- `mta.path.routeStations(...)`
- `mta.njTransit.rail.stations(...)`
- `mta.njTransit.rail.departures(...)`
- `mta.njTransit.rail.vehicles(...)`
- `mta.njTransit.rail.alerts(...)`
- `mta.njTransit.rail.routeStations(...)`
- `mta.nycFerry.stops()`
- `mta.nycFerry.routes()`
- `mta.nycFerry.routeStops(...)`
- `mta.nycFerry.arrivals(...)`
- `mta.nycFerry.vehicles(...)`
- `mta.nycFerry.alerts()`
- `mta.citiBike.stations(...)`
- `mta.citiBike.station(...)`
- `mta.citiBike.alerts()`
- `mta.lirr.stops(...)`
- `mta.lirr.routes()`
- `mta.lirr.routeStops(...)`
- `mta.lirr.departures(...)`
- `mta.lirr.vehicles(...)`
- `mta.lirr.alerts()`
- `mta.metroNorth.stops(...)`
- `mta.metroNorth.routes()`
- `mta.metroNorth.routeStops(...)`
- `mta.metroNorth.departures(...)`
- `mta.metroNorth.vehicles(...)`
- `mta.metroNorth.alerts()`
- `mta.mbta.stops(...)`
- `mta.mbta.routes()`
- `mta.mbta.routeStops(...)`
- `mta.mbta.departures(...)`
- `mta.mbta.vehicles(...)`
- `mta.mbta.alerts()`
- `mta.bart.stops(...)`
- `mta.bart.routes()`
- `mta.bart.routeStops(...)`
- `mta.bart.departures(...)`
- `mta.bart.vehicles(...)`
- `mta.bart.alerts()`
- `mta.kingCountyMetro.stops(...)`
- `mta.kingCountyMetro.routes()`
- `mta.kingCountyMetro.routeStops(...)`
- `mta.kingCountyMetro.departures(...)`
- `mta.kingCountyMetro.vehicles(...)`
- `mta.kingCountyMetro.alerts()`
- `mta.capMetro.stops(...)`
- `mta.capMetro.routes()`
- `mta.capMetro.routeStops(...)`
- `mta.capMetro.departures(...)`
- `mta.capMetro.vehicles(...)`
- `mta.capMetro.alerts()`
- `mta.pace.stops(...)`
- `mta.pace.routes()`
- `mta.pace.routeStops(...)`
- `mta.pace.departures(...)`
- `mta.pace.vehicles(...)`
- `mta.pace.alerts()`
- `mta.triRail.stops(...)`
- `mta.triRail.routes()`
- `mta.triRail.routeStops(...)`
- `mta.triRail.departures(...)`
- `mta.triRail.vehicles(...)`
- `mta.triRail.alerts()`
- `mta.brightline.stops(...)`
- `mta.brightline.routes()`
- `mta.brightline.routeStops(...)`
- `mta.brightline.departures(...)`
- `mta.brightline.vehicles(...)`
- `mta.brightline.alerts()`
- `mta.bayWheels.stations(...)`
- `mta.bayWheels.station(...)`
- `mta.bayWheels.alerts()`
- `mta.divvy.stations(...)`
- `mta.divvy.station(...)`
- `mta.divvy.alerts()`
- `mta.bluebikes.stations(...)`
- `mta.bluebikes.station(...)`
- `mta.bluebikes.alerts()`
