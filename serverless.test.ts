import { afterEach, expect, test } from "bun:test";
import { MTA, StaticDataMissingError, UnknownStopError, encodeFeedMessage } from "./serverless";

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
  ],
  routes: [
    {
      route_id: "A",
      route_short_name: "A",
      route_long_name: "8 Avenue Express",
      route_type: 1,
      route_color: "0039A6",
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
  ],
  stopTimes: [
    {
      trip_id: "A-trip-1",
      arrival_time: "12:00:00",
      departure_time: "12:00:00",
      stop_id: "A27N",
      stop_sequence: 1,
    },
  ],
};

const openClients: MTA[] = [];

afterEach(() => {
  while (openClients.length) openClients.pop()?.close();
});

function tempDatabaseUrl(name: string) {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `file:${tmp.replace(/\/$/, "")}/mta-js-serverless-${name}-${id}.sqlite`;
}

test("serverless MTA reads and writes static GTFS through libSQL", async () => {
  const mta = new MTA({ databaseUrl: tempDatabaseUrl("static") });
  openClients.push(mta);

  await mta.database.importStaticData({
    mode: "subway",
    seed: staticData,
    strategy: "schedule",
    sourceUrl: "test://static-data",
  });

  expect((await mta.database.status()).subway).toMatchObject({
    mode: "subway",
    ready: true,
    sourceUrl: "test://static-data",
    stopCount: 2,
    routeCount: 1,
    tripCount: 1,
    stopTimeCount: 1,
  });

  await expect(
    mta.stops.near({
      lat: 40.6923,
      lon: -73.9873,
      modes: ["subway"],
      radiusMeters: 100,
    }),
  ).resolves.toContainEqual(expect.objectContaining({ id: "A27" }));
});

test("serverless subway arrivals join realtime feed to Turso static data", async () => {
  const feed = encodeFeedMessage({
    header: { gtfsRealtimeVersion: "2.0", timestamp: 1_700_000_000 },
    entity: [
      {
        id: "arrival-1",
        tripUpdate: {
          trip: { tripId: "A-trip-1", routeId: "A" },
          stopTimeUpdate: [{ stopId: "A27N", arrival: { time: 1_700_000_300 } }],
        },
      },
    ],
  });
  const mta = new MTA({
    databaseUrl: tempDatabaseUrl("arrivals"),
    now: () => new Date("2023-11-14T22:13:20.000Z"),
    fetch: (async () => new Response(feed)) as unknown as typeof fetch,
    endpoints: {
      subwayFeeds: { A: "feed://ace" },
    },
  });
  openClients.push(mta);
  await mta.database.importStaticData({ mode: "subway", seed: staticData, strategy: "schedule" });

  await expect(mta.subway.arrivals({ stopId: "A27", route: "A" })).resolves.toEqual([
    expect.objectContaining({
      mode: "subway",
      direction: "north",
      headsign: "Inwood-207 St",
      arrivalTime: "2023-11-14T22:18:20.000Z",
      minutes: 5,
      tripId: "A-trip-1",
    }),
  ]);
});

test("serverless typed errors match the default entrypoint", async () => {
  const mta = new MTA({
    databaseUrl: tempDatabaseUrl("errors"),
    fetch: (async () => new Response(encodeFeedMessage({ header: { gtfsRealtimeVersion: "2.0" }, entity: [] }))) as unknown as typeof fetch,
    endpoints: {
      subwayFeeds: { A: "feed://ace" },
    },
  });
  openClients.push(mta);

  await expect(mta.stops.near({ lat: 40.6923, lon: -73.9873, modes: ["subway"] })).rejects.toThrow(
    StaticDataMissingError,
  );

  await mta.database.importStaticData({ mode: "subway", seed: staticData });
  await expect(mta.subway.arrivals({ stopId: "NOPE", route: "A" })).rejects.toThrow(UnknownStopError);
});
