import { Database } from "bun:sqlite";
import { unzipSync } from "fflate";
import { parse } from "csv-parse/sync";
import { gtfsSchemaSql } from "./schema";
import type {
  GtfsRouteInput,
  GtfsImportSummary,
  GtfsStopInput,
  GtfsStopTimeInput,
  GtfsTripInput,
  Route,
  StaticGtfsSeed,
  DatabaseStatus,
  StaticDataStatus,
  Stop,
  StopsNearQuery,
  TransitMode,
} from "./types";

type StopRow = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  parent_station: string | null;
  location_type: number | null;
  mode: TransitMode | null;
};

type RouteRow = {
  id: string;
  short_name: string | null;
  long_name: string | null;
  type: number | null;
  color: string | null;
  text_color: string | null;
};

type TripRow = {
  id: string;
  route_id: string;
  service_id: string | null;
  headsign: string | null;
  direction_id: number | null;
};

export class GTFSCache {
  readonly db: Database;

  constructor(path = ":memory:", options: { createSchema?: boolean } = {}) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    if (options.createSchema ?? true) {
      this.createSchema();
    }
  }

  close() {
    this.db.close(false);
  }

  pushSchema() {
    this.createSchema();
  }

  importSeed(seed: StaticGtfsSeed, mode?: TransitMode) {
    this.importRows({
      stops: seed.stops ?? [],
      routes: seed.routes ?? [],
      trips: seed.trips ?? [],
      stopTimes: seed.stopTimes ?? [],
      mode,
    });
    if (mode) this.markImported(mode, undefined, seed);
  }

  async importZip(zipBytes: ArrayBuffer | Uint8Array, mode?: TransitMode) {
    const seed = parseGtfsZip(zipBytes);
    this.importRows({ ...seed, mode });
    if (mode) this.markImported(mode, undefined, seed);
  }

  async importZipFromUrl(url: string, mode?: TransitMode, fetchImpl: typeof fetch = fetch) {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch GTFS zip from ${url}: ${response.status}`);
    }
    await this.importZip(await response.arrayBuffer(), mode);
    if (mode) {
      this.db
        .query("update gtfs_imports set source_url = ?1 where mode = ?2")
        .run(url, mode);
    }
  }

  hasStaticData(mode: TransitMode) {
    const row = this.db
      .query<{ count: number }, [TransitMode]>("select count(*) as count from gtfs_imports where mode = ?1")
      .get(mode);
    return Boolean(row?.count);
  }

  status(): DatabaseStatus {
    return {
      subway: this.statusForMode("subway"),
      bus: this.statusForMode("bus"),
      lirr: this.statusForMode("lirr"),
      "metro-north": this.statusForMode("metro-north"),
    };
  }

  importSummary(mode: TransitMode): GtfsImportSummary | undefined {
    const row = this.db
      .query<
        {
          mode: TransitMode;
          imported_at: string;
          source_url: string | null;
          stop_count: number;
          route_count: number;
          trip_count: number;
          stop_time_count: number;
        },
        [TransitMode]
      >("select * from gtfs_imports where mode = ?1")
      .get(mode);
    if (!row) return undefined;
    return {
      mode: row.mode,
      importedAt: row.imported_at,
      sourceUrl: row.source_url ?? undefined,
      stopCount: row.stop_count,
      routeCount: row.route_count,
      tripCount: row.trip_count,
      stopTimeCount: row.stop_time_count,
    };
  }

  private statusForMode(mode: TransitMode): StaticDataStatus {
    const summary = this.importSummary(mode);
    return {
      mode,
      ready: Boolean(summary),
      importedAt: summary?.importedAt,
      sourceUrl: summary?.sourceUrl,
      stopCount: summary?.stopCount ?? 0,
      routeCount: summary?.routeCount ?? 0,
      tripCount: summary?.tripCount ?? 0,
      stopTimeCount: summary?.stopTimeCount ?? 0,
    };
  }

  getStop(id: string): Stop | undefined {
    const row = this.db.query<StopRow, [string]>("select * from stops where id = ?1").get(id);
    return row ? stopFromRow(row) : undefined;
  }

  getStopOrParent(id: string): Stop | undefined {
    const direct = this.getStop(id);
    if (direct?.parentStation) return this.getStop(direct.parentStation) ?? direct;
    if (direct) return direct;
    return this.getStop(stripDirectionSuffix(id));
  }

  getRoute(idOrShortName: string): Route | undefined {
    const normalized = idOrShortName.toUpperCase();
    const row = this.db
      .query<RouteRow, [string, string]>(
        "select * from routes where upper(id) = ?1 or upper(short_name) = ?2 limit 1",
      )
      .get(normalized, normalized);
    return row ? routeFromRow(row) : undefined;
  }

  getTrip(id: string): TripRow | undefined {
    return this.db.query<TripRow, [string]>("select * from trips where id = ?1").get(id) ?? undefined;
  }

  getStopIdsForQuery(stopId: string) {
    const ids = new Set([stopId]);
    const parent = stripDirectionSuffix(stopId);
    ids.add(parent);
    ids.add(`${parent}N`);
    ids.add(`${parent}S`);

    for (const row of this.db
      .query<{ id: string }, [string]>("select id from stops where parent_station = ?1")
      .all(parent)) {
      ids.add(row.id);
    }

    return ids;
  }

  stopsNear(query: StopsNearQuery): Stop[] {
    const radiusMeters = query.radiusMeters ?? 500;
    const limit = query.limit ?? 20;
    const latSpan = radiusMeters / 111_320;
    const lonSpan = radiusMeters / (111_320 * Math.cos((query.lat * Math.PI) / 180));
    const modes = query.modes?.length ? query.modes : undefined;

    const rows = this.db
      .query<StopRow, [number, number, number, number]>(
        `select * from stops
          where lat between ?1 and ?2
          and lon between ?3 and ?4
          and lat is not null
          and lon is not null`,
      )
      .all(query.lat - latSpan, query.lat + latSpan, query.lon - lonSpan, query.lon + lonSpan);

    return rows
      .map((row) => ({ stop: stopFromRow(row), distance: distanceMeters(query.lat, query.lon, row.lat!, row.lon!) }))
      .filter((row) => row.distance <= radiusMeters)
      .filter((row) => !modes || !row.stop.mode || modes.includes(row.stop.mode))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((row) => row.stop);
  }

  private createSchema() {
    this.db.run(gtfsSchemaSql());
  }

  private importRows(input: {
    stops: GtfsStopInput[];
    routes: GtfsRouteInput[];
    trips: GtfsTripInput[];
    stopTimes: GtfsStopTimeInput[];
    mode?: TransitMode;
  }) {
    const insertStop = this.db.query(`
      insert or replace into stops
      (id, name, lat, lon, parent_station, location_type, mode)
      values ($id, $name, $lat, $lon, $parentStation, $locationType, $mode)
    `);
    const insertRoute = this.db.query(`
      insert or replace into routes
      (id, short_name, long_name, type, color, text_color)
      values ($id, $shortName, $longName, $type, $color, $textColor)
    `);
    const insertTrip = this.db.query(`
      insert or replace into trips
      (id, route_id, service_id, headsign, direction_id)
      values ($id, $routeId, $serviceId, $headsign, $directionId)
    `);
    const insertStopTime = this.db.query(`
      insert or replace into stop_times
      (trip_id, arrival_time, departure_time, stop_id, stop_sequence)
      values ($tripId, $arrivalTime, $departureTime, $stopId, $stopSequence)
    `);

    const transaction = this.db.transaction(() => {
      for (const stop of input.stops) {
        insertStop.run({
          id: stop.stop_id,
          name: stop.stop_name,
          lat: numberOrNull(stop.stop_lat),
          lon: numberOrNull(stop.stop_lon),
          parentStation: stop.parent_station || null,
          locationType: numberOrNull(stop.location_type),
          mode: input.mode ?? inferModeFromRouteType(undefined),
        });
      }

      for (const route of input.routes) {
        insertRoute.run({
          id: route.route_id,
          shortName: route.route_short_name || route.route_id,
          longName: route.route_long_name || null,
          type: numberOrNull(route.route_type),
          color: normalizeColor(route.route_color),
          textColor: normalizeColor(route.route_text_color),
        });
      }

      for (const trip of input.trips) {
        insertTrip.run({
          id: trip.trip_id,
          routeId: trip.route_id,
          serviceId: trip.service_id || null,
          headsign: trip.trip_headsign || null,
          directionId: numberOrNull(trip.direction_id),
        });
      }

      for (const stopTime of input.stopTimes) {
        insertStopTime.run({
          tripId: stopTime.trip_id,
          arrivalTime: stopTime.arrival_time || null,
          departureTime: stopTime.departure_time || null,
          stopId: stopTime.stop_id,
          stopSequence: numberOrNull(stopTime.stop_sequence) ?? 0,
        });
      }
    });

    transaction();
  }

  private markImported(mode: TransitMode, sourceUrl: string | undefined, seed: StaticGtfsSeed) {
    this.db
      .query(`
        insert or replace into gtfs_imports
        (mode, imported_at, source_url, stop_count, route_count, trip_count, stop_time_count)
        values ($mode, $importedAt, $sourceUrl, $stopCount, $routeCount, $tripCount, $stopTimeCount)
      `)
      .run({
        mode,
        importedAt: new Date().toISOString(),
        sourceUrl: sourceUrl ?? null,
        stopCount: seed.stops?.length ?? 0,
        routeCount: seed.routes?.length ?? 0,
        tripCount: seed.trips?.length ?? 0,
        stopTimeCount: seed.stopTimes?.length ?? 0,
      });
  }
}

export function stripDirectionSuffix(stopId: string) {
  return stopId.replace(/[NS]$/, "");
}

export function directionFromStopId(stopId: string) {
  if (stopId.endsWith("N")) return "north";
  if (stopId.endsWith("S")) return "south";
  return "unknown";
}

export function parseGtfsZip(zipBytes: ArrayBuffer | Uint8Array): Required<StaticGtfsSeed> {
  const files = unzipSync(new Uint8Array(zipBytes));
  const text = (name: string) => {
    const bytes = files[name];
    if (!bytes) return [];
    return parse(new TextDecoder().decode(bytes), {
      columns: true,
      bom: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];
  };

  return {
    stops: text("stops.txt") as unknown as GtfsStopInput[],
    routes: text("routes.txt") as unknown as GtfsRouteInput[],
    trips: text("trips.txt") as unknown as GtfsTripInput[],
    stopTimes: text("stop_times.txt") as unknown as GtfsStopTimeInput[],
  };
}

function stopFromRow(row: StopRow): Stop {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat ?? undefined,
    lon: row.lon ?? undefined,
    parentStation: row.parent_station ?? undefined,
    mode: row.mode ?? undefined,
  };
}

function routeFromRow(row: RouteRow): Route {
  return {
    id: row.id,
    shortName: row.short_name ?? undefined,
    longName: row.long_name ?? undefined,
    type: row.type ?? undefined,
    color: row.color ?? undefined,
    textColor: row.text_color ?? undefined,
  };
}

function numberOrNull(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeColor(value: string | undefined) {
  if (!value) return null;
  return value.startsWith("#") ? value : `#${value}`;
}

function inferModeFromRouteType(type?: number): TransitMode | null {
  if (type === 1) return "subway";
  if (type === 2) return "lirr";
  if (type === 3) return "bus";
  return null;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6_371_000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
