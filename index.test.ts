import { expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import { encodeFeedMessage, MTA, StaticDataMissingError } from "./index";
import { parseGtfsZip } from "./src/static-gtfs";

const staticData = {
  stops: [
    {
      stop_id: "A27",
      stop_name: "Jay St-MetroTech",
      stop_lat: 40.692338,
      stop_lon: -73.987342,
    },
    {
      stop_id: "A27N",
      stop_name: "Jay St-MetroTech",
      stop_lat: 40.692338,
      stop_lon: -73.987342,
      parent_station: "A27",
    },
    {
      stop_id: "308214",
      stop_name: "5 Av/Atlantic Av",
      stop_lat: 40.682,
      stop_lon: -73.978,
    },
    {
      stop_id: "L06",
      stop_name: "1 Av",
      stop_lat: 40.730953,
      stop_lon: -73.981628,
    },
    {
      stop_id: "L06S",
      stop_name: "1 Av",
      stop_lat: 40.730953,
      stop_lon: -73.981628,
      parent_station: "L06",
    },
    {
      stop_id: "L06N",
      stop_name: "1 Av",
      stop_lat: 40.730953,
      stop_lon: -73.981628,
      parent_station: "L06",
    },
  ],
  routes: [
    {
      route_id: "A",
      route_short_name: "A",
      route_long_name: "8 Avenue Express",
      route_type: 1,
      route_color: "0039A6",
    },
    {
      route_id: "B63",
      route_short_name: "B63",
      route_long_name: "Bay Ridge - Cobble Hill",
      route_type: 3,
    },
    {
      route_id: "L",
      route_short_name: "L",
      route_long_name: "14 St-Canarsie Local",
      route_type: 1,
      route_color: "7C858C",
    },
  ],
  trips: [
    {
      route_id: "A",
      service_id: "weekday",
      trip_id: "A-trip-1",
      trip_headsign: "Inwood-207 St",
      direction_id: 0,
    },
    {
      route_id: "L",
      service_id: "weekday",
      trip_id: "L-trip-1",
      trip_headsign: "Canarsie-Rockaway Pkwy",
      direction_id: 1,
    },
    {
      route_id: "L",
      service_id: "weekday",
      trip_id: "L-trip-2",
      trip_headsign: "8 Av",
      direction_id: 0,
    },
  ],
};

test("hosted API calls include bearer and x-api-key auth headers", async () => {
  let request: Request | undefined;
  const mta = new MTA({
    apiKey: "test-key",
    apiBaseUrl: "https://api.example.com",
    fetch: (async (input, init) => {
      request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      return Response.json([{ id: "L08", name: "Bedford Av" }]);
    }) as typeof fetch,
  });

  await expect(
    mta.stops.near({
      lat: 40.7173,
      lon: -73.9568,
      modes: ["subway"],
      route: "L",
    }),
  ).resolves.toEqual([{ id: "L08", name: "Bedford Av" }]);

  expect(request?.url).toBe("https://api.example.com/api/v1/stops/near?lat=40.7173&lon=-73.9568&modes=subway&route=L");
  expect(request?.headers.get("authorization")).toBe("Bearer test-key");
  expect(request?.headers.get("x-api-key")).toBe("test-key");
});

test("hosted subway arrivals infer L route and normalize east aliases before requesting the API", async () => {
  let request: Request | undefined;
  const mta = new MTA({
    apiKey: "test-key",
    apiBaseUrl: "https://api.example.com",
    fetch: (async (input, init) => {
      request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      return Response.json([]);
    }) as typeof fetch,
  });

  await mta.subway.arrivals({ stopId: "L06", direction: "east" });

  const url = new URL(request?.url ?? "");
  expect(url.pathname).toBe("/api/v1/subway/arrivals");
  expect(url.searchParams.get("route")).toBe("L");
  expect(url.searchParams.get("direction")).toBe("south");
});

test("hosted subway direction calls resolve intermediate destinations through the API", async () => {
  let request: Request | undefined;
  const mta = new MTA({
    apiKey: "test-key",
    apiBaseUrl: "https://api.example.com",
    fetch: (async (input, init) => {
      request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      return Response.json({
        route: { id: "L", shortName: "L" },
        destination: "Union Sq",
        normalizedDestination: "union sq",
        resolved: true,
        direction: "north",
        displayDirection: "toward 8 Av",
        terminal: "8 Av",
        fromStop: {
          id: "L06",
          name: "1 Av",
          displayName: "1 Av",
          parentId: "L06",
        },
        destinationStop: {
          id: "L03",
          name: "14 St-Union Sq",
          displayName: "14 St-Union Sq",
          parentId: "L03",
        },
      });
    }) as typeof fetch,
  });

  const resolution = await mta.subway.direction({
    route: "L",
    fromStopId: "L06",
    destination: "Union Sq",
  });

  const url = new URL(request?.url ?? "");
  expect(url.pathname).toBe("/api/v1/subway/direction");
  expect(url.searchParams.get("route")).toBe("L");
  expect(url.searchParams.get("fromStopId")).toBe("L06");
  expect(url.searchParams.get("destination")).toBe("Union Sq");
  expect(resolution).toMatchObject({
    resolved: true,
    direction: "north",
    displayDirection: "toward 8 Av",
    fromStop: {
      displayName: "1 Av",
      parentId: "L06",
    },
  });
});

test("hosted expansion methods call the managed API endpoints", async () => {
  const requests: Request[] = [];
  const mta = new MTA({
    apiKey: "test-key",
    apiBaseUrl: "https://api.example.com",
    fetch: (async (input, init) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      requests.push(request);

      const url = new URL(request.url);
      if (url.pathname === "/api/v1/subway/arrival-board") {
        return Response.json([
          {
            station: { id: "L06", name: "1 Av", displayName: "1 Av" },
            distanceMeters: 120,
            directions: [],
          },
        ]);
      }
      if (url.pathname === "/api/v1/bus/arrival-board") {
        return Response.json([
          {
            stop: { id: "903002", name: "Avenue C/E 20 St" },
            distanceMeters: 80,
            routes: [],
          },
        ]);
      }
      if (url.pathname === "/api/v1/stops") {
        return Response.json([
          {
            requestedId: "L06",
            found: true,
            stop: { id: "L06", name: "1 Av", displayName: "1 Av" },
          },
        ]);
      }
      if (url.pathname === "/api/v1/routes") {
        return Response.json([{ id: "L", shortName: "L", mode: "subway" }]);
      }
      if (url.pathname === "/api/v1/subway/routes/L/stations") {
        return Response.json({
          route: { id: "L", shortName: "L" },
          mode: "subway",
          directions: [],
        });
      }
      if (url.pathname === "/api/v1/bus/routes/M23-SBS/stops") {
        return Response.json({
          route: { id: "M23+", shortName: "M23-SBS" },
          mode: "bus",
          directions: [],
        });
      }

      return Response.json({ error: "unexpected path", path: url.pathname }, { status: 404 });
    }) as typeof fetch,
  });

  await expect(
    mta.subway.arrivalBoard({
      lat: 40.7356,
      lon: -73.9906,
      route: "l",
      limitStations: 5,
      limitArrivals: 3,
    }),
  ).resolves.toHaveLength(1);
  await expect(
    mta.bus.arrivalBoard({
      lat: 40.7421,
      lon: -73.9914,
      route: "M23",
      limitStops: 8,
      limitArrivals: 3,
    }),
  ).resolves.toHaveLength(1);
  await expect(
    mta.stops.byIds({
      ids: ["A27", "L06", "308214"],
      includeRoutes: true,
    }),
  ).resolves.toHaveLength(1);
  await expect(mta.routes.list({ modes: ["subway", "bus"] })).resolves.toHaveLength(1);
  await expect(
    mta.subway.routeStations({
      route: "L",
      direction: "east",
      includeArrivals: true,
      limitStops: 12,
      limitArrivals: 2,
    }),
  ).resolves.toMatchObject({ mode: "subway" });
  await expect(
    mta.bus.routeStops({
      route: "M23",
      direction: 0,
      includeArrivals: true,
      limitStops: 12,
      limitArrivals: 2,
    }),
  ).resolves.toMatchObject({ mode: "bus" });

  const urls = requests.map((request) => new URL(request.url));
  expect(urls.map((url) => url.pathname)).toEqual([
    "/api/v1/subway/arrival-board",
    "/api/v1/bus/arrival-board",
    "/api/v1/stops",
    "/api/v1/routes",
    "/api/v1/subway/routes/L/stations",
    "/api/v1/bus/routes/M23-SBS/stops",
  ]);
  const [
    subwayBoardUrl,
    busBoardUrl,
    stopsUrl,
    routesUrl,
    subwayRouteStationsUrl,
    busRouteStopsUrl,
  ] = urls as [URL, URL, URL, URL, URL, URL];
  expect(subwayBoardUrl.searchParams.get("route")).toBe("L");
  expect(busBoardUrl.searchParams.get("route")).toBe("M23-SBS");
  expect(stopsUrl.searchParams.get("ids")).toBe("A27,L06,308214");
  expect(stopsUrl.searchParams.get("includeRoutes")).toBe("true");
  expect(routesUrl.searchParams.get("modes")).toBe("subway,bus");
  expect(subwayRouteStationsUrl.searchParams.get("direction")).toBe("south");
  expect(subwayRouteStationsUrl.searchParams.get("limitStops")).toBe("12");
  expect(subwayRouteStationsUrl.searchParams.has("route")).toBe(false);
  expect(busRouteStopsUrl.searchParams.get("direction")).toBe("0");
  expect(busRouteStopsUrl.searchParams.get("limitArrivals")).toBe("2");
  expect(busRouteStopsUrl.searchParams.has("route")).toBe(false);
});

test("subway arrivals decode GTFS realtime and join in-memory static metadata", async () => {
  const feed = encodeFeedMessage({
    header: { gtfsRealtimeVersion: "2.0", timestamp: 1_700_000_000 },
    entity: [
      {
        id: "arrival-1",
        tripUpdate: {
          trip: { tripId: "A-trip-1", routeId: "A" },
          stopTimeUpdate: [
            {
              stopId: "A27N",
              arrival: { time: 1_700_000_300 },
            },
          ],
        },
      },
    ],
  });

  const mta = new MTA({
    staticData,
    fetch: (async () => new Response(feed)) as unknown as typeof fetch,
    endpoints: {
      subwayFeeds: { A: "feed://ace" },
    },
  });

  const arrivals = await mta.subway.arrivals({ stopId: "A27", route: "A" });

  expect(arrivals).toHaveLength(1);
  expect(arrivals[0]).toMatchObject({
    mode: "subway",
    route: {
      id: "A",
      shortName: "A",
      longName: "8 Avenue Express",
      color: "#0039A6",
    },
    stop: {
      id: "A27",
      name: "Jay St-MetroTech",
    },
    direction: "north",
    destination: "Inwood-207 St",
    displayDirection: "toward Inwood-207 St",
    headsign: "Inwood-207 St",
    tripId: "A-trip-1",
    source: "mta-gtfs-rt",
  });
});

test("subway arrivals map L east and west aliases to NYCT north and south directions", async () => {
  const feed = encodeFeedMessage({
    header: { gtfsRealtimeVersion: "2.0", timestamp: 1_700_000_000 },
    entity: [
      {
        id: "arrival-1",
        tripUpdate: {
          trip: { tripId: "L-trip-1", routeId: "L" },
          stopTimeUpdate: [
            {
              stopId: "L06S",
              arrival: { time: 1_700_000_300 },
            },
          ],
        },
      },
      {
        id: "arrival-2",
        tripUpdate: {
          trip: { tripId: "L-trip-2", routeId: "L" },
          stopTimeUpdate: [
            {
              stopId: "L06N",
              arrival: { time: 1_700_000_360 },
            },
          ],
        },
      },
    ],
  });

  const mta = new MTA({
    staticData,
    fetch: (async () => new Response(feed)) as unknown as typeof fetch,
    endpoints: {
      subwayFeeds: { L: "feed://l" },
    },
  });

  const eastboundArrivals = await mta.subway.arrivals({ stopId: "L06", direction: "east" });
  const westboundArrivals = await mta.subway.arrivals({ stopId: "L06", direction: "west" });

  expect(eastboundArrivals).toHaveLength(1);
  expect(eastboundArrivals[0]).toMatchObject({
    route: {
      id: "L",
      shortName: "L",
      longName: "14 St-Canarsie Local",
    },
    stop: {
      id: "L06",
      name: "1 Av",
    },
    direction: "south",
    destination: "Canarsie-Rockaway Pkwy",
    displayDirection: "toward Canarsie-Rockaway Pkwy",
    headsign: "Canarsie-Rockaway Pkwy",
  });
  expect(westboundArrivals).toHaveLength(1);
  expect(westboundArrivals[0]).toMatchObject({
    direction: "north",
    destination: "8 Av",
    displayDirection: "toward 8 Av",
    headsign: "8 Av",
  });
});

test("bus arrivals normalize BusTime responses with in-memory static metadata", async () => {
  let requestedUrl = "";
  const mta = new MTA({
    busTimeKey: "bus-key",
    staticData,
    fetch: (async (input) => {
      requestedUrl = String(input);
      return Response.json({
        Siri: {
          ServiceDelivery: {
            StopMonitoringDelivery: [
              {
                MonitoredStopVisit: [
                  {
                    MonitoredVehicleJourney: {
                      LineRef: "MTA NYCT_B63",
                      DestinationName: "Cobble Hill",
                      MonitoredCall: {
                        StopPointRef: "308214",
                        ExpectedArrivalTime: "2023-11-14T22:20:20.000Z",
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      });
    }) as typeof fetch,
    endpoints: {
      busStopMonitoring: "https://bustime.example.com/stop",
    },
  });

  const arrivals = await mta.bus.arrivals({ stopId: "308214", route: "B63" });

  expect(new URL(requestedUrl).searchParams.get("key")).toBe("bus-key");
  expect(arrivals[0]).toMatchObject({
    mode: "bus",
    route: { id: "B63", shortName: "B63" },
    stop: { id: "308214", name: "5 Av/Atlantic Av" },
    destination: "Cobble Hill",
    displayDirection: "toward Cobble Hill",
    headsign: "Cobble Hill",
    source: "mta-bustime",
  });
});

test("local stops.near requires in-memory static data", async () => {
  const mta = new MTA();

  await expect(
    mta.stops.near({
      lat: 40.6923,
      lon: -73.9873,
      modes: ["subway"],
    }),
  ).rejects.toThrow(StaticDataMissingError);
});

test("local stops.near requires stop data, not only route or trip data", async () => {
  const mta = new MTA({
    staticData: {
      routes: staticData.routes,
      trips: staticData.trips,
    },
  });

  await expect(
    mta.stops.near({
      lat: 40.6923,
      lon: -73.9873,
      modes: ["subway"],
    }),
  ).rejects.toThrow(StaticDataMissingError);
});

test("local stops.near searches in-memory static seed", async () => {
  const mta = new MTA({ staticData });

  const stops = await mta.stops.near({
    lat: 40.6923,
    lon: -73.9873,
    modes: ["subway"],
    radiusMeters: 100,
  });

  expect(stops.map((stop) => stop.id)).toContain("A27");
});

test("local stops.near filters candidates with a bounding box before distance", async () => {
  const mta = new MTA({
    staticData: {
      stops: [
        { stop_id: "near", stop_name: "Near", stop_lat: 40, stop_lon: -73 },
        { stop_id: "far-lat", stop_name: "Far Lat", stop_lat: 40.1, stop_lon: -73 },
        { stop_id: "far-lon", stop_name: "Far Lon", stop_lat: 40, stop_lon: -73.1 },
      ],
    },
  });

  const stops = await mta.stops.near({
    lat: 40,
    lon: -73,
    radiusMeters: 100,
  });

  expect(stops.map((stop) => stop.id)).toEqual(["near"]);
});

test("in-memory static data defaults to subway status and can be marked for another mode", () => {
  const defaultMta = new MTA({ staticData });
  expect(defaultMta.static.hasStaticData("subway")).toBe(true);
  expect(defaultMta.static.status().subway.ready).toBe(true);

  const busMta = new MTA({ staticData, staticDataMode: "bus" });
  expect(busMta.static.hasStaticData("bus")).toBe(true);
  expect(busMta.static.hasStaticData("subway")).toBe(false);
  expect(busMta.static.status().bus.ready).toBe(true);
});

test("reimporting a stop removes stale parent station links", () => {
  const mta = new MTA({
    staticData: {
      stops: [
        { stop_id: "P1", stop_name: "Parent 1" },
        { stop_id: "P2", stop_name: "Parent 2" },
        { stop_id: "C1", stop_name: "Child", parent_station: "P1" },
      ],
    },
  });

  expect(mta.static.getStopIdsForQuery("P1")).toContain("C1");

  mta.static.importSeed({
    stops: [{ stop_id: "C1", stop_name: "Child", parent_station: "P2" }],
  });

  expect(mta.static.getStopIdsForQuery("P1")).not.toContain("C1");
  expect(mta.static.getStopIdsForQuery("P2")).toContain("C1");
});

test("parseGtfsZip parses static GTFS csv files into a seed", () => {
  const zip = zipSync({
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\nL08,Bedford Av,40.717304,-73.956872\n"),
    "routes.txt": strToU8("route_id,route_short_name,route_long_name\nL,L,14 St-Canarsie Local\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id,trip_headsign\nL,weekday,L-trip,Canarsie\n"),
    "stop_times.txt": strToU8("trip_id,arrival_time,departure_time,stop_id,stop_sequence\nL-trip,12:00:00,12:00:00,L08,1\n"),
  });

  expect(parseGtfsZip(zip)).toMatchObject({
    stops: [{ stop_id: "L08", stop_name: "Bedford Av" }],
    routes: [{ route_id: "L", route_short_name: "L" }],
    trips: [{ trip_id: "L-trip", trip_headsign: "Canarsie" }],
    stopTimes: [{ trip_id: "L-trip", stop_id: "L08" }],
  });
});
