import { createClient, type Client, type InArgs } from "@libsql/client";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { gtfsSchemaStatements } from "./schema";
import type {
  DatabaseStatus,
  GtfsImportSummary,
  Route,
  StaticDataStatus,
  StaticGtfsSeed,
  StaticGtfsImportStrategy,
  Stop,
  StopsNearQuery,
  TransitMode,
} from "./types";

type LibsqlStaticStoreOptions = {
  databaseUrl: string;
  databaseAuthToken?: string;
};

export class LibsqlStaticStore {
  readonly client: Client;

  constructor(options: LibsqlStaticStoreOptions) {
    this.client = createClient({
      url: options.databaseUrl,
      authToken: options.databaseAuthToken,
    });
  }

  close() {
    this.client.close();
  }

  async pushSchema() {
    for (const sql of gtfsSchemaStatements) {
      await this.client.execute(sql);
    }
    return { remote: true, statements: gtfsSchemaStatements.length };
  }

  async hasStaticData(mode: TransitMode) {
    try {
      const result = await this.client.execute({
        sql: "select count(*) as count from gtfs_imports where mode = ?",
        args: [mode],
      });
      return Number(result.rows[0]?.count ?? 0) > 0;
    } catch (error) {
      if (isMissingTableError(error)) return false;
      throw error;
    }
  }

  async status(): Promise<DatabaseStatus> {
    return {
      subway: await this.statusForMode("subway"),
      bus: await this.statusForMode("bus"),
      lirr: await this.statusForMode("lirr"),
      "metro-north": await this.statusForMode("metro-north"),
    };
  }

  async importStaticData(input: {
    mode: TransitMode;
    seed?: StaticGtfsSeed;
    sourceUrl?: string;
    strategy?: StaticGtfsImportStrategy;
    fetch?: typeof fetch;
  }): Promise<GtfsImportSummary | undefined> {
    const parsedSeed =
      input.seed ??
      (input.sourceUrl
        ? parseGtfsZip(await fetchArrayBuffer(input.fetch ?? fetch, input.sourceUrl))
        : undefined);
    if (!parsedSeed) throw new Error("importStaticData requires either seed or sourceUrl.");

    const seed = applyImportStrategy(parsedSeed, input.strategy ?? "core");

    await this.pushSchema();
    await batchChunks(
      this.client,
      (seed.stops ?? []).map((stop) => ({
        sql: `insert or replace into stops
          (id, name, lat, lon, parent_station, location_type, mode)
          values (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          stop.stop_id,
          stop.stop_name,
          numberOrNull(stop.stop_lat),
          numberOrNull(stop.stop_lon),
          stop.parent_station ?? null,
          numberOrNull(stop.location_type),
          input.mode,
        ],
      })),
    );
    await batchChunks(
      this.client,
      (seed.routes ?? []).map((route) => ({
        sql: `insert or replace into routes
          (id, short_name, long_name, type, color, text_color)
          values (?, ?, ?, ?, ?, ?)`,
        args: [
          route.route_id,
          route.route_short_name ?? route.route_id,
          route.route_long_name ?? null,
          numberOrNull(route.route_type),
          normalizeColor(route.route_color),
          normalizeColor(route.route_text_color),
        ],
      })),
    );
    await batchChunks(
      this.client,
      (seed.trips ?? []).map((trip) => ({
        sql: `insert or replace into trips
          (id, route_id, service_id, headsign, direction_id)
          values (?, ?, ?, ?, ?)`,
        args: [
          trip.trip_id,
          trip.route_id,
          trip.service_id ?? null,
          trip.trip_headsign ?? null,
          numberOrNull(trip.direction_id),
        ],
      })),
    );
    await batchChunks(
      this.client,
      (seed.stopTimes ?? []).map((stopTime) => ({
        sql: `insert or replace into stop_times
          (trip_id, arrival_time, departure_time, stop_id, stop_sequence)
          values (?, ?, ?, ?, ?)`,
        args: [
          stopTime.trip_id,
          stopTime.arrival_time ?? null,
          stopTime.departure_time ?? null,
          stopTime.stop_id,
          numberOrNull(stopTime.stop_sequence) ?? 0,
        ],
      })),
    );
    await this.client.execute({
      sql: `insert or replace into gtfs_imports
        (mode, imported_at, source_url, stop_count, route_count, trip_count, stop_time_count)
        values (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.mode,
        new Date().toISOString(),
        input.sourceUrl ?? null,
        seed.stops?.length ?? 0,
        seed.routes?.length ?? 0,
        seed.trips?.length ?? 0,
        seed.stopTimes?.length ?? 0,
      ],
    });

    return this.importSummary(input.mode);
  }

  async importSummary(mode: TransitMode): Promise<GtfsImportSummary | undefined> {
    const result = await this.client
      .execute({
        sql: "select * from gtfs_imports where mode = ?",
        args: [mode],
      })
      .catch((error) => {
        if (isMissingTableError(error)) return undefined;
        throw error;
      });
    if (!result) return undefined;
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      mode,
      importedAt: String(row.imported_at),
      sourceUrl: row.source_url ? String(row.source_url) : undefined,
      stopCount: Number(row.stop_count ?? 0),
      routeCount: Number(row.route_count ?? 0),
      tripCount: Number(row.trip_count ?? 0),
      stopTimeCount: Number(row.stop_time_count ?? 0),
    };
  }

  async getStop(id: string): Promise<Stop | undefined> {
    const result = await this.client.execute({ sql: "select * from stops where id = ?", args: [id] });
    return result.rows[0] ? stopFromRow(result.rows[0]) : undefined;
  }

  async getStopOrParent(id: string): Promise<Stop | undefined> {
    const direct = await this.getStop(id);
    if (direct?.parentStation) return (await this.getStop(direct.parentStation)) ?? direct;
    if (direct) return direct;
    return this.getStop(stripDirectionSuffix(id));
  }

  async getRoute(idOrShortName: string): Promise<Route | undefined> {
    const normalized = idOrShortName.toUpperCase();
    const result = await this.client.execute({
      sql: "select * from routes where upper(id) = ? or upper(short_name) = ? limit 1",
      args: [normalized, normalized],
    });
    return result.rows[0] ? routeFromRow(result.rows[0]) : undefined;
  }

  async getTrip(id: string) {
    const result = await this.client.execute({ sql: "select * from trips where id = ?", args: [id] });
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: String(row.id),
      route_id: String(row.route_id),
      service_id: row.service_id ? String(row.service_id) : undefined,
      headsign: row.headsign ? String(row.headsign) : undefined,
      direction_id: numberOrUndefined(row.direction_id),
    };
  }

  async getStopIdsForQuery(stopId: string) {
    const ids = new Set([stopId]);
    const parent = stripDirectionSuffix(stopId);
    ids.add(parent);
    ids.add(`${parent}N`);
    ids.add(`${parent}S`);

    const result = await this.client.execute({
      sql: "select id from stops where parent_station = ?",
      args: [parent],
    });
    for (const row of result.rows) ids.add(String(row.id));
    return ids;
  }

  async stopsNear(query: StopsNearQuery): Promise<Stop[]> {
    const radiusMeters = query.radiusMeters ?? 500;
    const limit = query.limit ?? 20;
    const latSpan = radiusMeters / 111_320;
    const lonSpan = radiusMeters / (111_320 * Math.cos((query.lat * Math.PI) / 180));
    const modes = query.modes?.length ? query.modes : undefined;

    const result = await this.client.execute({
      sql: `select * from stops
        where lat between ? and ?
        and lon between ? and ?
        and lat is not null
        and lon is not null`,
      args: [query.lat - latSpan, query.lat + latSpan, query.lon - lonSpan, query.lon + lonSpan],
    });

    return result.rows
      .map((row) => ({
        stop: stopFromRow(row),
        distance: distanceMeters(query.lat, query.lon, Number(row.lat), Number(row.lon)),
      }))
      .filter((row) => row.distance <= radiusMeters)
      .filter((row) => !modes || !row.stop.mode || modes.includes(row.stop.mode))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((row) => row.stop);
  }

  private async statusForMode(mode: TransitMode): Promise<StaticDataStatus> {
    const summary = await this.importSummary(mode);
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
}

async function fetchArrayBuffer(fetchImpl: typeof fetch, sourceUrl: string) {
  const response = await fetchImpl(sourceUrl);
  if (!response.ok) throw new Error(`Failed to fetch GTFS zip from ${sourceUrl}: ${response.status}`);
  return response.arrayBuffer();
}

function parseGtfsZip(zipBytes: ArrayBuffer | Uint8Array): Required<StaticGtfsSeed> {
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
    stops: text("stops.txt") as unknown as Required<StaticGtfsSeed>["stops"],
    routes: text("routes.txt") as unknown as Required<StaticGtfsSeed>["routes"],
    trips: text("trips.txt") as unknown as Required<StaticGtfsSeed>["trips"],
    stopTimes: text("stop_times.txt") as unknown as Required<StaticGtfsSeed>["stopTimes"],
  };
}

function applyImportStrategy(seed: StaticGtfsSeed, strategy: StaticGtfsImportStrategy): StaticGtfsSeed {
  if (strategy === "schedule") return seed;
  return {
    stops: seed.stops,
    routes: seed.routes,
    trips: [],
    stopTimes: [],
  };
}

async function batchChunks(client: Client, statements: { sql: string; args: InArgs }[], size = 500) {
  for (let index = 0; index < statements.length; index += size) {
    const chunk = statements.slice(index, index + size);
    if (chunk.length) await client.batch(chunk, "write");
  }
}

function stopFromRow(row: Record<string, unknown>): Stop {
  return {
    id: String(row.id),
    name: String(row.name),
    lat: numberOrUndefined(row.lat),
    lon: numberOrUndefined(row.lon),
    parentStation: row.parent_station ? String(row.parent_station) : undefined,
    mode: row.mode ? (String(row.mode) as TransitMode) : undefined,
  };
}

function routeFromRow(row: Record<string, unknown>): Route {
  return {
    id: String(row.id),
    shortName: row.short_name ? String(row.short_name) : undefined,
    longName: row.long_name ? String(row.long_name) : undefined,
    type: numberOrUndefined(row.type),
    color: row.color ? String(row.color) : undefined,
    textColor: row.text_color ? String(row.text_color) : undefined,
  };
}

function stripDirectionSuffix(stopId: string) {
  return stopId.replace(/[NS]$/, "");
}

function numberOrUndefined(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function numberOrNull(value: unknown) {
  return numberOrUndefined(value) ?? null;
}

function normalizeColor(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return value.startsWith("#") ? value : `#${value}`;
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

function isMissingTableError(error: unknown) {
  return error instanceof Error && error.message.includes("no such table");
}
