import { mkdirSync } from "node:fs";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { gtfsSchemaStatements } from "./schema";
import type { StaticGtfsSeed, TransitMode } from "./types";

export function resolveSqliteDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) return undefined;
  if (isRemoteDatabaseUrl(databaseUrl)) return undefined;
  if (databaseUrl === ":memory:") return databaseUrl;
  if (!databaseUrl.startsWith("file:")) return databaseUrl;

  const url = new URL(databaseUrl);
  return decodeURIComponent(url.pathname);
}

export async function hydrateRemoteDatabaseUrl(options: {
  databaseUrl: string | undefined;
  databaseAuthToken?: string;
  databaseLocalPath?: string;
  fetch: typeof fetch;
  refresh?: boolean;
}) {
  if (!options.databaseUrl || !isRemoteDatabaseUrl(options.databaseUrl)) {
    return options.databaseUrl;
  }

  const localPath = resolveRemoteDatabaseLocalPath(options.databaseUrl, options.databaseLocalPath);
  const existing = Bun.file(localPath);
  if (!options.refresh && await existing.exists()) {
    return localPath;
  }

  if (isLibsqlDatabaseUrl(options.databaseUrl)) {
    await hydrateLibsqlDatabase({
      databaseUrl: options.databaseUrl,
      databaseAuthToken: options.databaseAuthToken,
      localPath,
    });
    return localPath;
  }

  const response = await options.fetch(options.databaseUrl);
  if (!response.ok) {
    throw new Error(`Failed to hydrate databaseUrl ${options.databaseUrl}: ${response.status} ${response.statusText}`);
  }

  mkdirSync(localPath.slice(0, localPath.lastIndexOf("/")), { recursive: true });
  await Bun.write(localPath, response);
  return localPath;
}

export async function pushRemoteDatabaseSchema(options: {
  databaseUrl: string | undefined;
  databaseAuthToken?: string;
}) {
  if (!options.databaseUrl || !isLibsqlDatabaseUrl(options.databaseUrl)) {
    return { remote: false, statements: gtfsSchemaStatements.length };
  }

  const client = createClient({
    url: options.databaseUrl,
    authToken: options.databaseAuthToken,
  });

  try {
    for (const sql of gtfsSchemaStatements) {
      await client.execute(sql);
    }
  } finally {
    client.close();
  }

  return { remote: true, statements: gtfsSchemaStatements.length };
}

export async function importRemoteStaticSeed(options: {
  databaseUrl: string | undefined;
  databaseAuthToken?: string;
  seed: StaticGtfsSeed;
  mode: TransitMode;
  sourceUrl?: string;
}) {
  if (!options.databaseUrl || !isLibsqlDatabaseUrl(options.databaseUrl)) {
    return { remote: false };
  }

  const client = createClient({
    url: options.databaseUrl,
    authToken: options.databaseAuthToken,
  });

  try {
    await batchChunks(client, gtfsSchemaStatements.map((sql) => ({ sql, args: [] })));
    await batchChunks(
      client,
      (options.seed.stops ?? []).map((stop) => ({
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
          options.mode,
        ],
      })),
    );
    await batchChunks(
      client,
      (options.seed.routes ?? []).map((route) => ({
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
      client,
      (options.seed.trips ?? []).map((trip) => ({
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
      client,
      (options.seed.stopTimes ?? []).map((stopTime) => ({
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
    await client.batch(
      [
        {
          sql: `insert or replace into gtfs_imports
            (mode, imported_at, source_url, stop_count, route_count, trip_count, stop_time_count)
            values (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            options.mode,
            new Date().toISOString(),
            options.sourceUrl ?? null,
            options.seed.stops?.length ?? 0,
            options.seed.routes?.length ?? 0,
            options.seed.trips?.length ?? 0,
            options.seed.stopTimes?.length ?? 0,
          ],
        },
      ],
      "write",
    );
  } finally {
    client.close();
  }

  return { remote: true };
}

export function isRemoteDatabaseUrl(databaseUrl: string) {
  return isHttpDatabaseUrl(databaseUrl) || isLibsqlDatabaseUrl(databaseUrl);
}

export function resolveRemoteDatabaseLocalPath(databaseUrl: string, databaseLocalPath?: string) {
  return databaseLocalPath ?? defaultRemoteDatabasePath(databaseUrl);
}

export function isHttpDatabaseUrl(databaseUrl: string) {
  return databaseUrl.startsWith("https://") || databaseUrl.startsWith("http://");
}

export function isLibsqlDatabaseUrl(databaseUrl: string) {
  return databaseUrl.startsWith("libsql://");
}

function defaultRemoteDatabasePath(databaseUrl: string) {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const url = new URL(databaseUrl);
  const basename = url.pathname.split("/").filter(Boolean).at(-1) ?? "gtfs.sqlite";
  const hash = Bun.hash(databaseUrl).toString(36);
  return `${tmp.replace(/\/$/, "")}/mta-js/${hash}-${basename}`;
}

async function hydrateLibsqlDatabase(options: {
  databaseUrl: string;
  databaseAuthToken?: string;
  localPath: string;
}) {
  mkdirSync(options.localPath.slice(0, options.localPath.lastIndexOf("/")), { recursive: true });
  const client = createClient({
    url: `file:${options.localPath}`,
    syncUrl: options.databaseUrl,
    authToken: options.databaseAuthToken,
  });
  await client.sync();
  client.close();
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

async function batchChunks(client: Client, statements: InStatement[], size = 500) {
  for (let index = 0; index < statements.length; index += size) {
    const chunk = statements.slice(index, index + size);
    if (chunk.length) await client.batch(chunk, "write");
  }
}
