import { afterEach, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { strToU8, zipSync } from "fflate";
import { MTA, GTFSCache, StaticDataMissingError, UnknownStopError, encodeFeedMessage } from "./index";
import { isLibsqlDatabaseUrl, isRemoteDatabaseUrl } from "./src/database-url";

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

const firstAvLStaticData = {
  stops: [
    {
      stop_id: "L06",
      stop_name: "1 Av",
      stop_lat: 40.730953,
      stop_lon: -73.981628,
    },
    {
      stop_id: "L06N",
      stop_name: "1 Av",
      stop_lat: 40.730953,
      stop_lon: -73.981628,
      parent_station: "L06",
    },
    {
      stop_id: "L06S",
      stop_name: "1 Av",
      stop_lat: 40.730953,
      stop_lon: -73.981628,
      parent_station: "L06",
    },
  ],
  routes: [
    {
      route_id: "L",
      route_short_name: "L",
      route_long_name: "14 St-Canarsie Local",
      route_type: 1,
      route_color: "A7A9AC",
    },
  ],
};

const openClients: MTA[] = [];

afterEach(() => {
  while (openClients.length) openClients.pop()?.close();
});

test("subway arrivals decode GTFS realtime and join static GTFS metadata", async () => {
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

  const mta = clientWithFetch({
    "feed://ace": new Response(feed),
  });

  const arrivals = await mta.subway.arrivals({ stopId: "A27", route: "A" });

  expect(arrivals).toHaveLength(1);
  expect(arrivals[0]).toMatchObject({
      mode: "subway",
      route: {
        id: "A",
        shortName: "A",
        longName: "8 Avenue Express",
        type: 1,
        color: "#0039A6",
      },
      stop: {
        id: "A27",
        name: "Jay St-MetroTech",
        lat: 40.692338,
        lon: -73.987342,
      },
      direction: "north",
      headsign: "Inwood-207 St",
      arrivalTime: "2023-11-14T22:18:20.000Z",
      minutes: 5,
      tripId: "A-trip-1",
      realtime: true,
      source: "mta-gtfs-rt",
  });
});

test("stops.near returns nearby static GTFS stops", async () => {
  const mta = clientWithFetch({});

  const stops = await mta.stops.near({
    lat: 40.6923,
    lon: -73.9873,
    modes: ["subway"],
    radiusMeters: 100,
  });

  expect(stops.map((stop) => stop.id)).toContain("A27");
});

test("bus arrivals normalize BusTime stop monitoring responses", async () => {
  const mta = clientWithFetch({
    "bus://stop": Response.json({
      Siri: {
        ServiceDelivery: {
          StopMonitoringDelivery: [
            {
              MonitoredStopVisit: [
                {
                  MonitoredVehicleJourney: {
                    LineRef: "MTA NYCT_B63",
                    DestinationName: "Cobble Hill",
                    FramedVehicleJourneyRef: {
                      DatedVehicleJourneyRef: "bus-trip-1",
                    },
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
    }),
  });

  const arrivals = await mta.bus.arrivals({ stopId: "308214", route: "B63" });

  expect(arrivals[0]).toMatchObject({
    mode: "bus",
    route: { id: "B63", shortName: "B63" },
    stop: { id: "308214", name: "5 Av/Atlantic Av" },
    arrivalTime: "2023-11-14T22:20:20.000Z",
    minutes: 7,
    source: "mta-bustime",
  });
});

test("bus vehicles aliases M23 to the BusTime M23-SBS line ref", async () => {
  let requestedUrl = "";
  const mta = new MTA({
    busTimeKey: "test-key",
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrl = String(input);
      return Response.json({
        Siri: {
          ServiceDelivery: {
            VehicleMonitoringDelivery: [
              {
                VehicleActivity: [],
              },
            ],
          },
        },
      });
    }) as unknown as typeof fetch,
    endpoints: {
      busVehicleMonitoring: "bus://vehicle",
    },
  });
  openClients.push(mta);

  await mta.bus.vehicles({ route: "M23" });

  expect(new URL(requestedUrl).searchParams.get("LineRef")).toBe("MTA NYCT_M23-SBS");
});

test("alerts decode GTFS realtime alerts and filter by route", async () => {
  const feed = encodeFeedMessage({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [
      {
        id: "alert-1",
        alert: {
          activePeriod: [{ start: 1_700_000_000 }],
          informedEntity: [{ routeId: "A", routeType: 1 }],
          effect: "SIGNIFICANT_DELAYS",
          headerText: { translation: [{ text: "A trains are delayed", language: "en" }] },
          descriptionText: { translation: [{ text: "Allow extra travel time.", language: "en" }] },
        },
      },
    ],
  });

  const mta = clientWithFetch({
    "feed://alerts": new Response(feed),
  });

  const alerts = await mta.alerts.current({ route: "A" });

  expect(alerts).toEqual([
    {
      id: "alert-1",
      mode: "subway",
      routes: [
        {
          id: "A",
          shortName: "A",
          longName: "8 Avenue Express",
          type: 1,
          color: "#0039A6",
        },
      ],
      stops: [],
      header: "A trains are delayed",
      description: "Allow extra travel time.",
      effect: "SIGNIFICANT_DELAYS",
      activePeriods: [{ start: "2023-11-14T22:13:20.000Z" }],
      source: "mta-gtfs-rt",
    },
  ]);
});

test("databaseUrl accepts a file URL for the SQLite GTFS database", async () => {
  const databaseUrl = "file:/private/tmp/mta-js-database-url.sqlite";
  const mta = new MTA({ databaseUrl });
  openClients.push(mta);

  mta.static.importSeed({
    stops: [{ stop_id: "A27", stop_name: "Jay St-MetroTech" }],
  });

  await expect(mta.stops.near({ lat: 0, lon: 0 })).resolves.toEqual([]);
  expect(mta.static.getStop("A27")?.name).toBe("Jay St-MetroTech");
});

test("database.push applies the fixed GTFS schema idempotently", async () => {
  const mta = new MTA({ databaseUrl: ":memory:" });
  openClients.push(mta);

  await expect(mta.database.push()).resolves.toEqual({
    remote: false,
    statements: 9,
  });
  expect(
    mta.static.db.query("select name from sqlite_master where type = 'table' and name = 'stops'").get(),
  ).toEqual({ name: "stops" });
});

test("realtime cache avoids duplicate subway feed fetches within TTL", async () => {
  const feed = encodeFeedMessage({
    header: { gtfsRealtimeVersion: "2.0" },
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
  let requests = 0;
  const mta = new MTA({
    now: () => new Date("2023-11-14T22:13:20.000Z"),
    fetch: (async () => {
      requests += 1;
      return new Response(feed);
    }) as unknown as typeof fetch,
    endpoints: {
      subwayFeeds: { A: "feed://ace" },
    },
  });
  mta.static.importSeed(staticData, "subway");
  openClients.push(mta);

  await mta.subway.arrivals({ stopId: "A27", route: "A" });
  await mta.subway.arrivals({ stopId: "A27", route: "A" });

  expect(requests).toBe(1);
});

test("realtime cache expires after TTL", async () => {
  const feed = encodeFeedMessage({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [
      {
        id: "arrival-1",
        tripUpdate: {
          trip: { routeId: "A" },
          stopTimeUpdate: [{ stopId: "A27N", arrival: { time: 1_700_000_300 } }],
        },
      },
    ],
  });
  let requests = 0;
  let now = 1_700_000_000_000;
  const mta = new MTA({
    realtimeCacheTtlMs: 100,
    now: () => new Date(now),
    fetch: (async () => {
      requests += 1;
      return new Response(feed);
    }) as unknown as typeof fetch,
    endpoints: {
      subwayFeeds: { A: "feed://ace" },
    },
  });
  mta.static.importSeed(staticData, "subway");
  openClients.push(mta);

  await mta.subway.arrivals({ stopId: "A27", route: "A" });
  now += 101;
  await mta.subway.arrivals({ stopId: "A27", route: "A" });

  expect(requests).toBe(2);
});

test("database.status reports missing and ready modes", async () => {
  const mta = new MTA();
  openClients.push(mta);

  expect((await mta.database.status()).subway).toMatchObject({
    mode: "subway",
    ready: false,
    stopCount: 0,
    routeCount: 0,
    tripCount: 0,
    stopTimeCount: 0,
  });

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
    stopCount: 3,
    routeCount: 2,
    tripCount: 1,
    stopTimeCount: 1,
  });
});

test("static import strategy core avoids schedule rows", async () => {
  const mta = new MTA();
  openClients.push(mta);

  const summary = await mta.database.importStaticData({
    mode: "subway",
    seed: staticData,
    strategy: "core",
  });

  expect(summary).toMatchObject({
    stopCount: 3,
    routeCount: 2,
    tripCount: 0,
    stopTimeCount: 0,
  });
  expect(mta.static.db.query("select count(*) as count from trips").get()).toEqual({ count: 0 });
  expect(mta.static.db.query("select count(*) as count from stop_times").get()).toEqual({ count: 0 });
});

test("static import strategy schedule includes trips and stop_times", async () => {
  const mta = new MTA();
  openClients.push(mta);

  const summary = await mta.database.importStaticData({
    mode: "subway",
    seed: staticData,
    strategy: "schedule",
  });

  expect(summary).toMatchObject({
    stopCount: 3,
    routeCount: 2,
    tripCount: 1,
    stopTimeCount: 1,
  });
  expect(mta.static.db.query("select count(*) as count from trips").get()).toEqual({ count: 1 });
  expect(mta.static.db.query("select count(*) as count from stop_times").get()).toEqual({ count: 1 });
});

test("missing static data produces a typed actionable error", async () => {
  const mta = new MTA();
  openClients.push(mta);

  await expect(
    mta.stops.near({
      lat: 40.730953,
      lon: -73.981628,
      modes: ["subway"],
    }),
  ).rejects.toThrow(StaticDataMissingError);
  await expect(
    mta.stops.near({
      lat: 40.730953,
      lon: -73.981628,
      modes: ["subway"],
    }),
  ).rejects.toThrow("Run mta.database.importStaticData or the db import CLI");
});

test("unknown subway stop produces a typed actionable error when static data is ready", async () => {
  const mta = new MTA({
    endpoints: {
      subwayFeeds: { A: "feed://ace" },
    },
    fetch: (async () => new Response(encodeFeedMessage({ header: { gtfsRealtimeVersion: "2.0" }, entity: [] }))) as unknown as typeof fetch,
  });
  mta.static.importSeed(staticData, "subway");
  openClients.push(mta);

  await expect(mta.subway.arrivals({ stopId: "NOPE", route: "A" })).rejects.toThrow(UnknownStopError);
  await expect(mta.subway.arrivals({ stopId: "NOPE", route: "A" })).rejects.toThrow("Unknown MTA stop: NOPE");
});

test("CLI db import works against local SQLite", async () => {
  const id = Date.now();
  const databasePath = `/private/tmp/mta-js-cli-import-${id}.sqlite`;
  const zipPath = `/private/tmp/mta-js-cli-import-${id}.zip`;
  const zip = zipSync({
    "stops.txt": strToU8(
      [
        "stop_id,stop_name,stop_lat,stop_lon",
        "L06,1 Av,40.730953,-73.981628",
        "",
      ].join("\n"),
    ),
    "routes.txt": strToU8(
      [
        "route_id,route_short_name,route_long_name,route_type,route_color",
        "L,L,14 St-Canarsie Local,1,A7A9AC",
        "",
      ].join("\n"),
    ),
    "trips.txt": strToU8(
      [
        "route_id,service_id,trip_id,trip_headsign,direction_id",
        "L,weekday,L-trip-1,8 Av,0",
        "",
      ].join("\n"),
    ),
    "stop_times.txt": strToU8(
      [
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
        "L-trip-1,12:00:00,12:00:00,L06,1",
        "",
      ].join("\n"),
    ),
  });
  await Bun.write(zipPath, zip);

  const proc = Bun.spawn({
    cmd: [
      "bun",
      "src/cli.ts",
      "db",
      "import",
      `--database-url=${databasePath}`,
      "--mode=subway",
      "--strategy=core",
      `--source-url=${new URL(`file://${zipPath}`).toString()}`,
    ],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) throw new Error(stderr);
  expect(stdout).toContain("Imported subway GTFS (core)");
  expect(stdout).toContain("stops=1");
  expect(stdout).toContain("routes=1");
  expect(stdout).toContain("trips=0");

  const cache = new GTFSCache(databasePath, { createSchema: false });
  try {
    expect(cache.getStop("L06")?.name).toBe("1 Av");
    expect(cache.importSummary("subway")).toMatchObject({
      mode: "subway",
      stopCount: 1,
      routeCount: 1,
      tripCount: 0,
      stopTimeCount: 0,
    });
  } finally {
    cache.close();
  }
});

test("new MTA hydrates a remote databaseUrl into a local SQLite file", async () => {
  const id = Date.now();
  const sourcePath = `/private/tmp/mta-js-remote-source-${id}.sqlite`;
  const localPath = `/private/tmp/mta-js-remote-local-${id}.sqlite`;
  const source = new GTFSCache(sourcePath);
  source.importSeed({
    stops: [{ stop_id: "A27", stop_name: "Jay St-MetroTech" }],
  });
  source.close();

  const mta = new MTA({
    databaseUrl: "https://example.com/mta.sqlite",
    databaseLocalPath: localPath,
    fetch: (async () => new Response(await Bun.file(sourcePath).arrayBuffer())) as unknown as typeof fetch,
  });
  openClients.push(mta);

  await mta.ready();
  expect(mta.static.getStop("A27")?.name).toBe("Jay St-MetroTech");
  expect(await Bun.file(localPath).exists()).toBe(true);
});

test("async methods wait for remote database hydration", async () => {
  const id = Date.now();
  const sourcePath = `/private/tmp/mta-js-remote-source-method-${id}.sqlite`;
  const localPath = `/private/tmp/mta-js-remote-local-method-${id}.sqlite`;
  const source = new GTFSCache(sourcePath);
  source.importSeed({
    stops: [
      {
        stop_id: "A27",
        stop_name: "Jay St-MetroTech",
        stop_lat: 40.692338,
        stop_lon: -73.987342,
      },
    ],
  });
  source.close();

  const mta = new MTA({
    databaseUrl: "https://example.com/mta.sqlite",
    databaseLocalPath: localPath,
    fetch: (async () => new Response(await Bun.file(sourcePath).arrayBuffer())) as unknown as typeof fetch,
  });
  openClients.push(mta);

  await expect(
    mta.stops.near({
      lat: 40.6923,
      lon: -73.9873,
      radiusMeters: 100,
    }),
  ).resolves.toEqual([
    {
      id: "A27",
      name: "Jay St-MetroTech",
      lat: 40.692338,
      lon: -73.987342,
    },
  ]);
});

test("databaseUrl treats libsql URLs as remote database connections", () => {
  const url = "libsql://mtaapi-transcendent-leo-e3.aws-us-east-1.turso.io";

  expect(isLibsqlDatabaseUrl(url)).toBe(true);
  expect(isRemoteDatabaseUrl(url)).toBe(true);
});

const tursoReadTest = process.env.TURSO_INTEGRATION_TEST === "1" ? test : test.skip;
const tursoWriteTest =
  process.env.TURSO_INTEGRATION_TEST === "1" && process.env.TURSO_WRITE_TEST === "1" ? test : test.skip;
const liveMtaTest = process.env.MTA_LIVE_TEST === "1" ? test : test.skip;
const fullGtfsTest = process.env.MTA_FULL_GTFS_TEST === "1" ? test : test.skip;
const tursoFullGtfsTest =
  process.env.MTA_FULL_GTFS_TEST === "1" &&
  process.env.TURSO_INTEGRATION_TEST === "1" &&
  process.env.TURSO_WRITE_TEST === "1"
    ? test
    : test.skip;

const subwayGtfsUrl = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip";

tursoReadTest(
  "integration: hydrates a live Turso libSQL database when explicitly enabled",
  async () => {
    const databaseUrl = process.env.TURSO_DATABASE_URL;
    const databaseAuthToken = process.env.TURSO_AUTH_TOKEN;
    if (!databaseUrl || !databaseAuthToken) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required when TURSO_INTEGRATION_TEST=1.");
    }

    const mta = new MTA({
      databaseUrl,
      databaseAuthToken,
      databaseLocalPath: `/private/tmp/mta-js-turso-integration-${Date.now()}.sqlite`,
    });
    openClients.push(mta);

    await mta.ready();
    expect(mta.static.db.query("select 1 as ok").get()).toEqual({ ok: 1 });
  },
  15_000,
);

tursoWriteTest("integration: pushes the GTFS schema to live Turso when write testing is enabled", async () => {
  const databaseUrl = process.env.TURSO_DATABASE_URL;
  const databaseAuthToken = process.env.TURSO_AUTH_TOKEN;
  if (!databaseUrl || !databaseAuthToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required when TURSO_WRITE_TEST=1.");
  }

  const mta = new MTA({
    databaseUrl,
    databaseAuthToken,
    databaseLocalPath: `/private/tmp/mta-js-turso-push-${Date.now()}.sqlite`,
  });
  openClients.push(mta);

  let pushResult: Awaited<ReturnType<typeof mta.database.push>>;
  try {
    pushResult = await mta.database.push();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Turso schema push failed: ${message}`);
  }
  expect(pushResult).toEqual({ remote: true, statements: 9 });

  const remote = createClient({ url: databaseUrl, authToken: databaseAuthToken });
  try {
    const remoteTables = await remote.execute(
      "select name from sqlite_master where type = 'table' and name in ('stops', 'routes', 'trips', 'stop_times') order by name",
    );
    expect(remoteTables.rows.map((row) => row.name)).toEqual(["routes", "stop_times", "stops", "trips"]);
  } finally {
    remote.close();
  }

  expect(mta.static.db.query("select 1 as ok").get()).toEqual({ ok: 1 });
});

liveMtaTest("integration: subway arrivals do not require an MTA API key", async () => {
  const mta = new MTA({
    staticData: {
      stops: staticData.stops,
      routes: staticData.routes,
      trips: staticData.trips,
    },
  });
  openClients.push(mta);

  const arrivals = await mta.subway.arrivals({
    stopId: "A27",
    route: "A",
    limit: 5,
  });

  expect(Array.isArray(arrivals)).toBe(true);
  for (const arrival of arrivals) {
    expect(arrival.mode).toBe("subway");
    expect(arrival.route.id).toBe("A");
  }
});

liveMtaTest("integration: live L train arrivals at 1 Av do not require an MTA API key", async () => {
  const mta = new MTA({
    staticData: firstAvLStaticData,
  });
  openClients.push(mta);

  const arrivals = await mta.subway.arrivals({
    stopId: "L06",
    route: "L",
    limit: 5,
  });

  expect(Array.isArray(arrivals)).toBe(true);
  for (const arrival of arrivals) {
    expect(arrival.mode).toBe("subway");
    expect(arrival.route.id).toBe("L");
    expect(arrival.stop.id).toBe("L06");
  }
});

tursoWriteTest("integration: Turso-backed L train arrivals auto-import static data when needed", async () => {
  const databaseUrl = process.env.TURSO_DATABASE_URL;
  const databaseAuthToken = process.env.TURSO_AUTH_TOKEN;
  if (!databaseUrl || !databaseAuthToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required when TURSO_WRITE_TEST=1.");
  }

  const mta = new MTA({
    databaseUrl,
    databaseAuthToken,
    databaseLocalPath: `/private/tmp/mta-js-turso-static-${Date.now()}.sqlite`,
  });
  openClients.push(mta);

  const summary = await mta.database.ensureStaticData({
    mode: "subway",
    seed: firstAvLStaticData,
    sourceUrl: "test://first-av-l",
  });
  expect(summary).toMatchObject({
    mode: "subway",
    sourceUrl: "test://first-av-l",
    stopCount: 3,
    routeCount: 1,
  });

  const arrivals = await mta.subway.arrivals({
    stopId: "L06",
    route: "L",
    limit: 5,
  });

  expect(Array.isArray(arrivals)).toBe(true);
  expect(mta.static.getStop("L06")?.name).toBe("1 Av");
});

liveMtaTest("integration: service alerts do not require an MTA API key", async () => {
  const mta = new MTA({
    staticData: {
      stops: staticData.stops,
      routes: staticData.routes,
    },
  });
  openClients.push(mta);

  const alerts = await mta.alerts.current({ mode: "subway" });

  expect(Array.isArray(alerts)).toBe(true);
});

liveMtaTest("integration: bus arrivals require MTA_BUS_KEY for live BusTime", async () => {
  const busTimeKey = process.env.MTA_BUS_KEY;
  if (!busTimeKey) {
    const mta = new MTA();
    openClients.push(mta);
    await expect(mta.bus.arrivals({ stopId: "308214", route: "B63" })).rejects.toThrow(
      "MTA BusTime API calls require a busTimeKey.",
    );
    return;
  }

  const mta = new MTA({
    busTimeKey,
    staticData: {
      stops: staticData.stops,
      routes: staticData.routes,
    },
  });
  openClients.push(mta);

  const arrivals = await mta.bus.arrivals({
    stopId: "308214",
    route: "B63",
    limit: 5,
  });

  expect(Array.isArray(arrivals)).toBe(true);
  for (const arrival of arrivals) {
    expect(arrival.mode).toBe("bus");
    expect(arrival.route.id).toBe("B63");
    expect(arrival.source).toBe("mta-bustime");
  }
});

liveMtaTest("integration: bus vehicles require MTA_BUS_KEY for live BusTime", async () => {
  const busTimeKey = process.env.MTA_BUS_KEY;
  if (!busTimeKey) {
    const mta = new MTA();
    openClients.push(mta);
    await expect(mta.bus.vehicles({ route: "B63" })).rejects.toThrow(
      "MTA BusTime API calls require a busTimeKey.",
    );
    return;
  }

  const mta = new MTA({
    busTimeKey,
    staticData: {
      stops: staticData.stops,
      routes: staticData.routes,
    },
  });
  openClients.push(mta);

  const vehicles = await mta.bus.vehicles({
    route: "B63",
    limit: 5,
  });

  expect(Array.isArray(vehicles)).toBe(true);
  for (const vehicle of vehicles) {
    expect(vehicle.mode).toBe("bus");
    expect(vehicle.route.id).toBe("B63");
    expect(vehicle.source).toBe("mta-bustime");
  }
});

liveMtaTest("integration: bus vehicles supports M23 shorthand for M23-SBS", async () => {
  const busTimeKey = process.env.MTA_BUS_KEY;
  if (!busTimeKey) return;

  const mta = new MTA({
    busTimeKey,
  });
  openClients.push(mta);

  const vehicles = await mta.bus.vehicles({
    route: "M23",
    limit: 5,
  });

  expect(Array.isArray(vehicles)).toBe(true);
  for (const vehicle of vehicles) {
    expect(vehicle.mode).toBe("bus");
    expect(vehicle.route.id).toBe("M23-SBS");
    expect(vehicle.source).toBe("mta-bustime");
  }
});

fullGtfsTest(
  "integration: imports full subway GTFS and finds known stations",
  async () => {
    const mta = new MTA();
    openClients.push(mta);

    await mta.database.importStaticData({
      mode: "subway",
      sourceUrl: subwayGtfsUrl,
      strategy: "schedule",
    });

    expect(mta.static.importSummary("subway")).toMatchObject({
      mode: "subway",
      sourceUrl: subwayGtfsUrl,
    });
    expect(mta.static.getStop("L06")?.name).toBe("1 Av");
    expect(mta.static.getRoute("L")?.longName).toContain("Canarsie");
    expect(mta.static.getRoute("6")?.shortName).toBe("6");

    const springStSix = findStopServedByRoute(mta, {
      stopName: "Spring St",
      routeId: "6",
    });
    expect(springStSix?.name).toBe("Spring St");
  },
  20_000,
);

fullGtfsTest(
  "integration: real GTFS powers nearby stops and live Spring St 6 arrivals",
  async () => {
    const mta = new MTA();
    openClients.push(mta);

    await mta.database.importStaticData({
      mode: "subway",
      sourceUrl: subwayGtfsUrl,
      strategy: "schedule",
    });

    const nearby = await mta.stops.near({
      lat: 40.730953,
      lon: -73.981628,
      modes: ["subway"],
      radiusMeters: 100,
      limit: 10,
    });
    expect(nearby.some((stop) => stop.id === "L06" && stop.name === "1 Av")).toBe(true);

    const springStSix = findStopServedByRoute(mta, {
      stopName: "Spring St",
      routeId: "6",
    });
    expect(springStSix).toBeDefined();

    const arrivals = await mta.subway.arrivals({
      stopId: springStSix!.id,
      route: "6",
      limit: 5,
    });

    expect(Array.isArray(arrivals)).toBe(true);
    for (const arrival of arrivals) {
      expect(arrival.route.id).toBe("6");
      expect(arrival.stop.name).toBe("Spring St");
    }
  },
  20_000,
);

fullGtfsTest(
  "integration: service alerts can join against full subway GTFS",
  async () => {
    const mta = new MTA();
    openClients.push(mta);

    await mta.database.importStaticData({
      mode: "subway",
      sourceUrl: subwayGtfsUrl,
    });

    const alerts = await mta.alerts.current({ mode: "subway" });
    expect(Array.isArray(alerts)).toBe(true);
    for (const alert of alerts.slice(0, 5)) {
      expect(alert.source).toBe("mta-gtfs-rt");
      for (const route of alert.routes) {
        expect(route.id).toBeTruthy();
      }
    }
  },
  20_000,
);

tursoFullGtfsTest(
  "integration: imports full subway GTFS into Turso and hydrates local replica",
  async () => {
    const databaseUrl = process.env.TURSO_DATABASE_URL;
    const databaseAuthToken = process.env.TURSO_AUTH_TOKEN;
    if (!databaseUrl || !databaseAuthToken) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for Turso full GTFS import.");
    }

    const mta = new MTA({
      databaseUrl,
      databaseAuthToken,
      databaseLocalPath: `/private/tmp/mta-js-turso-full-gtfs-${Date.now()}.sqlite`,
    });
    openClients.push(mta);

    const fullSeed = await fetchGtfsSeed(subwayGtfsUrl);
    const tursoSeed = {
      stops: fullSeed.stops.filter((stop) => stop.stop_id.startsWith("L06")),
      routes: fullSeed.routes.filter((route) => route.route_id === "L"),
      trips: fullSeed.trips.filter((trip) => trip.route_id === "L").slice(0, 50),
      stopTimes: fullSeed.stopTimes
        .filter((stopTime) => stopTime.stop_id.startsWith("L06"))
        .slice(0, 500),
    };

    const summary = await mta.database.importStaticData({
      mode: "subway",
      sourceUrl: subwayGtfsUrl,
      seed: tursoSeed,
      strategy: "schedule",
      rehydrate: false,
    });

    if (summary) {
      expect(summary).toMatchObject({
        mode: "subway",
        sourceUrl: subwayGtfsUrl,
      });
    }

    const remote = createClient({ url: databaseUrl, authToken: databaseAuthToken });
    try {
      const importRows = await remote.execute({
        sql: "select * from gtfs_imports where mode = ?",
        args: ["subway"],
      });
      expect(importRows.rows[0]).toMatchObject({
        mode: "subway",
        source_url: subwayGtfsUrl,
        stop_count: tursoSeed.stops.length,
        route_count: tursoSeed.routes.length,
        trip_count: tursoSeed.trips.length,
        stop_time_count: tursoSeed.stopTimes.length,
      });
      const stop = await remote.execute({
        sql: "select name from stops where id = ?",
        args: ["L06"],
      });
      expect(stop.rows[0]?.name).toBe("1 Av");
    } finally {
      remote.close();
    }

    await mta.rehydrateRemoteDatabase();
    expect(mta.static.importSummary("subway")).toMatchObject({
      mode: "subway",
      sourceUrl: subwayGtfsUrl,
    });
    expect(mta.static.getStop("L06")?.name).toBe("1 Av");
  },
  20_000,
);

function clientWithFetch(responses: Record<string, Response>) {
  const mta = new MTA({
    busTimeKey: "test-key",
    now: () => new Date("2023-11-14T22:13:20.000Z"),
    endpoints: {
      subwayFeeds: { A: "feed://ace" },
      alerts: "feed://alerts",
      busStopMonitoring: "bus://stop",
      busVehicleMonitoring: "bus://vehicle",
    },
    fetch: (async (input) => {
      const url = String(input);
      const response = responses[url] ?? responses[url.split("?")[0]!];
      if (!response) {
        return new Response(`No fixture for ${url}`, { status: 404 });
      }
      return response.clone();
    }) as typeof fetch,
  });
  mta.static.importSeed(staticData, "subway");
  openClients.push(mta);
  return mta;
}

function findStopServedByRoute(mta: MTA, query: { stopName: string; routeId: string }) {
  const row = mta.static.db
    .query<
      { id: string; name: string; parent_station: string | null },
      [string, string]
    >(
      `select distinct stops.id, stops.name, stops.parent_station
      from stops
      join stop_times on stop_times.stop_id = stops.id
      join trips on trips.id = stop_times.trip_id
      where stops.name = ?1 and trips.route_id = ?2
      limit 1`,
    )
    .get(query.stopName, query.routeId);
  if (!row) return undefined;
  const id = row.parent_station || row.id.replace(/[NS]$/, "");
  return mta.static.getStop(id) ?? { id, name: row.name };
}

async function fetchGtfsSeed(url: string) {
  const { parseGtfsZip } = await import("./src/static-gtfs");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch GTFS zip from ${url}: ${response.status}`);
  }
  return parseGtfsZip(await response.arrayBuffer());
}
