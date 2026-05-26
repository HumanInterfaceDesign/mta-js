import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";

import type {
  DatabaseStatus,
  GtfsImportSummary,
  GtfsRouteInput,
  GtfsStopInput,
  GtfsStopTimeInput,
  GtfsTripInput,
  Route,
  StaticDataStatus,
  StaticGtfsSeed,
  Stop,
  StopsNearQuery,
  TransitMode,
} from "./types";

type Trip = {
  id: string;
  routeId: string;
  serviceId?: string;
  headsign?: string;
  directionId?: number;
};

export class GTFSCache {
  private stops = new Map<string, Stop>();
  private routes = new Map<string, Route>();
  private trips = new Map<string, Trip>();
  private childStopsByParent = new Map<string, Set<string>>();
  private summaries = new Map<TransitMode, GtfsImportSummary>();

  constructor(seed?: StaticGtfsSeed, mode?: TransitMode) {
    if (seed) this.importSeed(seed, mode);
  }

  close() {}

  importSeed(seed: StaticGtfsSeed, mode?: TransitMode) {
    this.importRows({
      stops: seed.stops ?? [],
      routes: seed.routes ?? [],
      trips: seed.trips ?? [],
      mode,
    });
    if (mode) this.markImported(mode, undefined, seed);
  }

  async importZip(zipBytes: ArrayBuffer | Uint8Array, mode?: TransitMode) {
    const seed = parseGtfsZip(zipBytes);
    this.importSeed(seed, mode);
  }

  async importZipFromUrl(url: string, mode?: TransitMode, fetchImpl: typeof fetch = fetch) {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch GTFS zip from ${url}: ${response.status}`);
    }
    const seed = parseGtfsZip(await response.arrayBuffer());
    this.importRows({
      stops: seed.stops,
      routes: seed.routes,
      trips: seed.trips,
      mode,
    });
    if (mode) this.markImported(mode, url, seed);
  }

  hasStaticData(mode: TransitMode) {
    return this.summaries.has(mode);
  }

  hasAnyStaticData() {
    return this.stops.size > 0 || this.routes.size > 0 || this.trips.size > 0;
  }

  hasStopData() {
    return this.stops.size > 0;
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
    return this.summaries.get(mode);
  }

  getStop(id: string): Stop | undefined {
    return this.stops.get(id);
  }

  getStopOrParent(id: string): Stop | undefined {
    const direct = this.getStop(id);
    if (direct?.parentStation) return this.getStop(direct.parentStation) ?? direct;
    if (direct) return direct;
    return this.getStop(stripDirectionSuffix(id));
  }

  getRoute(idOrShortName: string): Route | undefined {
    const normalized = idOrShortName.toUpperCase();
    return [...this.routes.values()].find(
      (route) =>
        route.id.toUpperCase() === normalized ||
        route.shortName?.toUpperCase() === normalized,
    );
  }

  getTrip(id: string): Trip | undefined {
    return this.trips.get(id);
  }

  getStopIdsForQuery(stopId: string) {
    const ids = new Set([stopId]);
    const parent = stripDirectionSuffix(stopId);
    ids.add(parent);
    ids.add(`${parent}N`);
    ids.add(`${parent}S`);

    for (const childId of this.childStopsByParent.get(parent) ?? []) {
      ids.add(childId);
    }

    return ids;
  }

  stopsNear(query: StopsNearQuery): Stop[] {
    const radiusMeters = query.radiusMeters ?? 500;
    const limit = query.limit ?? 20;
    const latSpan = radiusMeters / 111_320;
    const lonSpan = radiusMeters / (111_320 * Math.max(Math.cos((query.lat * Math.PI) / 180), 0.01));
    const modes = query.modes?.length ? query.modes : undefined;

    return [...this.stops.values()]
      .filter((stop) => stop.lat !== undefined && stop.lon !== undefined)
      .filter(
        (stop) =>
          stop.lat! >= query.lat - latSpan &&
          stop.lat! <= query.lat + latSpan &&
          stop.lon! >= query.lon - lonSpan &&
          stop.lon! <= query.lon + lonSpan,
      )
      .map((stop) => ({
        stop,
        distance: distanceMeters(query.lat, query.lon, stop.lat!, stop.lon!),
      }))
      .filter((row) => row.distance <= radiusMeters)
      .filter((row) => !modes || !row.stop.mode || modes.includes(row.stop.mode))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((row) => row.stop);
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

  private importRows(input: {
    stops: GtfsStopInput[];
    routes: GtfsRouteInput[];
    trips: GtfsTripInput[];
    mode?: TransitMode;
  }) {
    for (const stop of input.stops) {
      const normalized = stopFromInput(stop, input.mode);
      this.removeChildParentLink(normalized.id);
      this.stops.set(normalized.id, normalized);
      if (normalized.parentStation) {
        const children = this.childStopsByParent.get(normalized.parentStation) ?? new Set<string>();
        children.add(normalized.id);
        this.childStopsByParent.set(normalized.parentStation, children);
      }
    }

    for (const route of input.routes) {
      const normalized = routeFromInput(route);
      this.routes.set(normalized.id, normalized);
    }

    for (const trip of input.trips) {
      this.trips.set(trip.trip_id, {
        id: trip.trip_id,
        routeId: trip.route_id,
        serviceId: trip.service_id || undefined,
        headsign: trip.trip_headsign || undefined,
        directionId: numberOrUndefined(trip.direction_id),
      });
    }
  }

  private markImported(mode: TransitMode, sourceUrl: string | undefined, seed: StaticGtfsSeed) {
    this.summaries.set(mode, {
      mode,
      importedAt: new Date().toISOString(),
      sourceUrl,
      stopCount: seed.stops?.length ?? 0,
      routeCount: seed.routes?.length ?? 0,
      tripCount: seed.trips?.length ?? 0,
      stopTimeCount: seed.stopTimes?.length ?? 0,
    });
  }

  private removeChildParentLink(stopId: string) {
    const previous = this.stops.get(stopId);
    if (!previous?.parentStation) return;

    const children = this.childStopsByParent.get(previous.parentStation);
    children?.delete(stopId);
    if (children?.size === 0) {
      this.childStopsByParent.delete(previous.parentStation);
    }
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

function stopFromInput(stop: GtfsStopInput, mode?: TransitMode): Stop {
  return {
    id: stop.stop_id,
    name: stop.stop_name,
    lat: numberOrUndefined(stop.stop_lat),
    lon: numberOrUndefined(stop.stop_lon),
    parentStation: stop.parent_station || undefined,
    mode,
  };
}

function routeFromInput(route: GtfsRouteInput): Route {
  return {
    id: route.route_id,
    shortName: route.route_short_name || route.route_id,
    longName: route.route_long_name || undefined,
    type: numberOrUndefined(route.route_type),
    color: normalizeColor(route.route_color),
    textColor: normalizeColor(route.route_text_color),
  };
}

function numberOrUndefined(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeColor(value: string | undefined) {
  if (!value) return undefined;
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
