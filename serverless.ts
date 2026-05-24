import { defaultEndpoints, subwayRouteColors } from "./src/defaults";
import { MissingBusTimeKeyError, StaticDataMissingError, UnknownRouteError, UnknownStopError } from "./src/errors";
import { decodeFeedMessage, type GtfsRealtimeFeed, type TranslatedString } from "./src/gtfs-realtime";
import { fetchArrayBuffer, fetchJson, urlWithParams } from "./src/http";
import { LibsqlStaticStore } from "./src/libsql-static-gtfs";
import type {
  Alert,
  AlertQuery,
  Arrival,
  BusArrivalQuery,
  BusVehicleQuery,
  DatabaseStatus,
  Direction,
  GtfsImportSummary,
  MTAEndpoints,
  Route,
  StaticGtfsImportStrategy,
  StaticGtfsSeed,
  Stop,
  StopsNearQuery,
  TransitMode,
  Vehicle,
} from "./src/types";

export interface ServerlessMTAOptions {
  databaseUrl: string;
  databaseAuthToken?: string;
  busTimeKey?: string;
  realtimeCacheTtlMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  endpoints?: Partial<MTAEndpoints>;
}

export class MTA {
  readonly static: LibsqlStaticStore;
  readonly database: DatabaseClient;
  readonly subway: SubwayClient;
  readonly bus: BusClient;
  readonly alerts: AlertsClient;
  readonly stops: StopsClient;

  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly busTimeKey?: string;
  readonly endpoints: MTAEndpoints;
  private readonly realtimeCache = new Map<string, { expiresAt: number; feed: GtfsRealtimeFeed }>();
  private readonly realtimeCacheTtlMs: number;

  constructor(readonly options: ServerlessMTAOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.busTimeKey = options.busTimeKey;
    this.realtimeCacheTtlMs = options.realtimeCacheTtlMs ?? 15_000;
    this.endpoints = {
      ...defaultEndpoints,
      ...options.endpoints,
      subwayFeeds: {
        ...defaultEndpoints.subwayFeeds,
        ...options.endpoints?.subwayFeeds,
      },
    };
    this.static = new LibsqlStaticStore({
      databaseUrl: options.databaseUrl,
      databaseAuthToken: options.databaseAuthToken,
    });

    this.database = new DatabaseClient(this);
    this.subway = new SubwayClient(this);
    this.bus = new BusClient(this);
    this.alerts = new AlertsClient(this);
    this.stops = new StopsClient(this);
  }

  async ready() {
    return this;
  }

  close() {
    this.static.close();
  }

  async realtimeFeed(url: string) {
    const now = this.now().getTime();
    const cached = this.realtimeCache.get(url);
    if (cached && cached.expiresAt > now) return cached.feed;

    const feed = decodeFeedMessage(await fetchArrayBuffer(this.fetch, url));
    if (this.realtimeCacheTtlMs > 0) {
      this.realtimeCache.set(url, { feed, expiresAt: now + this.realtimeCacheTtlMs });
    }
    return feed;
  }
}

class DatabaseClient {
  constructor(private readonly mta: MTA) {}

  push() {
    return this.mta.static.pushSchema();
  }

  hasStaticData(mode: TransitMode) {
    return this.mta.static.hasStaticData(mode);
  }

  status(): Promise<DatabaseStatus> {
    return this.mta.static.status();
  }

  importStaticData(input: {
    mode: TransitMode;
    seed?: StaticGtfsSeed;
    sourceUrl?: string;
    strategy?: StaticGtfsImportStrategy;
  }): Promise<GtfsImportSummary | undefined> {
    return this.mta.static.importStaticData({
      ...input,
      fetch: this.mta.fetch,
    });
  }

  async ensureStaticData(input: {
    mode: TransitMode;
    seed?: StaticGtfsSeed;
    sourceUrl?: string;
    strategy?: StaticGtfsImportStrategy;
  }): Promise<GtfsImportSummary | undefined> {
    if (await this.mta.static.hasStaticData(input.mode)) {
      return this.mta.static.importSummary(input.mode);
    }
    return this.importStaticData(input);
  }
}

class SubwayClient {
  constructor(private readonly mta: MTA) {}

  async arrivals(query: {
    stopId: string;
    route?: string;
    direction?: Direction | "uptown" | "downtown";
    limit?: number;
    includeRaw?: boolean;
  }): Promise<Arrival[]> {
    const routeIds = query.route ? [normalizeRouteId(query.route)] : Object.keys(this.mta.endpoints.subwayFeeds);
    const feeds = [...new Set(routeIds.map((route) => this.feedForRoute(route)))];
    const stopIds = await this.mta.static.getStopIdsForQuery(query.stopId);
    if ((await this.mta.static.hasStaticData("subway")) && !(await this.mta.static.getStopOrParent(query.stopId))) {
      throw new UnknownStopError(query.stopId);
    }
    const arrivals: Arrival[] = [];

    for (const feedUrl of feeds) {
      const feed = await this.mta.realtimeFeed(feedUrl);
      arrivals.push(...(await this.arrivalsFromFeed(feed, stopIds, query)));
    }

    return arrivals
      .sort((a, b) => Date.parse(a.arrivalTime) - Date.parse(b.arrivalTime))
      .slice(0, query.limit ?? 20);
  }

  private feedForRoute(route: string) {
    const feed = this.mta.endpoints.subwayFeeds[route];
    if (!feed) throw new UnknownRouteError(route);
    return feed;
  }

  private async arrivalsFromFeed(
    feed: GtfsRealtimeFeed,
    stopIds: Set<string>,
    query: { stopId: string; route?: string; direction?: Direction | "uptown" | "downtown"; includeRaw?: boolean },
  ) {
    const arrivals: Arrival[] = [];
    const wantedDirection = normalizeDirection(query.direction);
    const now = this.mta.now().getTime();

    for (const entity of feed.entity) {
      const tripUpdate = entity.tripUpdate;
      if (!tripUpdate) continue;

      const trip = tripUpdate.trip;
      const routeId = normalizeRouteId(trip?.routeId ?? query.route ?? "");
      if (query.route && routeId !== normalizeRouteId(query.route)) continue;

      const staticTrip = trip?.tripId ? await this.mta.static.getTrip(trip.tripId) : undefined;
      const route = routeWithFallback(await this.mta.static.getRoute(routeId), routeId);

      for (const update of tripUpdate.stopTimeUpdate ?? []) {
        const stopId = update.stopId;
        if (!stopId || !stopIds.has(stopId)) continue;
        if (update.scheduleRelationship === "SKIPPED" || update.scheduleRelationship === "NO_DATA") continue;

        const direction = directionFromStopId(stopId);
        if (wantedDirection && direction !== wantedDirection) continue;

        const event = update.arrival ?? update.departure;
        if (!event?.time) continue;

        const stop = (await this.mta.static.getStopOrParent(stopId)) ?? fallbackStop(query.stopId);
        arrivals.push({
          mode: "subway",
          route,
          stop,
          direction,
          headsign: staticTrip?.headsign ?? undefined,
          arrivalTime: new Date(event.time * 1000).toISOString(),
          departureTime: update.departure?.time ? new Date(update.departure.time * 1000).toISOString() : undefined,
          minutes: Math.max(0, Math.round((event.time * 1000 - now) / 60_000)),
          tripId: trip?.tripId,
          realtime: true,
          source: "mta-gtfs-rt",
          raw: query.includeRaw ? entity : undefined,
        });
      }
    }

    return arrivals;
  }
}

class BusClient {
  constructor(private readonly mta: MTA) {}

  async arrivals(query: BusArrivalQuery): Promise<Arrival[]> {
    const key = this.requireKey();
    const body = await fetchJson(
      this.mta.fetch,
      urlWithParams(this.mta.endpoints.busStopMonitoring, {
        key,
        version: "2",
        OperatorRef: "MTA",
        MonitoringRef: query.stopId,
        LineRef: query.route ? busLineRef(query.route) : undefined,
      }),
    );
    const journeys = monitoredStopVisits(body);
    const now = this.mta.now().getTime();

    const arrivals = await Promise.all(
      journeys.map(async (journey): Promise<Arrival | undefined> => {
        const mvj = journey.MonitoredVehicleJourney;
        if (!mvj) return undefined;
        const routeId = routeFromLineRef(mvj.LineRef ?? query.route ?? "");
        const call = mvj.MonitoredCall ?? {};
        const expected = call.ExpectedArrivalTime ?? call.AimedArrivalTime;
        if (!expected) return undefined;
        const stop = (await this.mta.static.getStop(String(call.StopPointRef ?? query.stopId))) ?? fallbackStop(query.stopId);
        return {
          mode: "bus",
          route: routeWithFallback(await this.mta.static.getRoute(routeId), routeId),
          stop,
          direction: "unknown",
          headsign: stringOrUndefined(mvj.DestinationName),
          arrivalTime: new Date(expected).toISOString(),
          minutes: Math.max(0, Math.round((Date.parse(expected) - now) / 60_000)),
          tripId: stringOrUndefined(mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef),
          realtime: true,
          source: "mta-bustime",
          raw: query.includeRaw ? journey : undefined,
        };
      }),
    );

    return arrivals
      .filter((arrival): arrival is Arrival => Boolean(arrival))
      .sort((a, b) => Date.parse(a.arrivalTime) - Date.parse(b.arrivalTime))
      .slice(0, query.limit ?? 20);
  }

  async vehicles(query: BusVehicleQuery = {}): Promise<Vehicle[]> {
    const key = this.requireKey();
    const body = await fetchJson(
      this.mta.fetch,
      urlWithParams(this.mta.endpoints.busVehicleMonitoring, {
        key,
        version: "2",
        OperatorRef: "MTA",
        LineRef: query.route ? busLineRef(query.route) : undefined,
        VehicleRef: query.vehicleId,
      }),
    );

    const vehicles = await Promise.all(
      monitoredVehicleJourneys(body).map(async (mvj): Promise<Vehicle> => {
        const routeId = routeFromLineRef(mvj.LineRef ?? query.route ?? "");
        const location = mvj.VehicleLocation ?? {};
        const stopId = stringOrUndefined(mvj.MonitoredCall?.StopPointRef);
        return {
          mode: "bus",
          route: routeWithFallback(await this.mta.static.getRoute(routeId), routeId),
          vehicleId: stringOrUndefined(mvj.VehicleRef),
          tripId: stringOrUndefined(mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef),
          stop: stopId ? (await this.mta.static.getStop(stopId)) ?? fallbackStop(stopId) : undefined,
          lat: numberOrUndefined(location.Latitude),
          lon: numberOrUndefined(location.Longitude),
          bearing: numberOrUndefined(mvj.Bearing),
          destinationName: stringOrUndefined(mvj.DestinationName),
          recordedAt: mvj.RecordedAtTime ? new Date(mvj.RecordedAtTime).toISOString() : undefined,
          source: "mta-bustime",
          raw: query.includeRaw ? mvj : undefined,
        };
      }),
    );

    return vehicles.slice(0, query.limit ?? 50);
  }

  private requireKey() {
    if (!this.mta.busTimeKey) throw new MissingBusTimeKeyError();
    return this.mta.busTimeKey;
  }
}

class AlertsClient {
  constructor(private readonly mta: MTA) {}

  async current(query: AlertQuery = {}): Promise<Alert[]> {
    const feed = await this.mta.realtimeFeed(this.mta.endpoints.alerts);
    const alerts: Alert[] = [];

    for (const entity of feed.entity) {
      if (!entity.alert) continue;
      const informed = entity.alert.informedEntity ?? [];
      const routeIds = [...new Set(informed.map((item) => item.routeId).filter((id): id is string => Boolean(id)))];
      const stopIds = [...new Set(informed.map((item) => item.stopId).filter((id): id is string => Boolean(id)))];
      const routes = await Promise.all(routeIds.map(async (id) => routeWithFallback(await this.mta.static.getRoute(id), id)));
      const stops = await Promise.all(stopIds.map(async (id) => (await this.mta.static.getStopOrParent(id)) ?? fallbackStop(id)));

      if (query.route && !routeIds.some((id) => normalizeRouteId(id) === normalizeRouteId(query.route!))) continue;
      if (query.stopId && !stopIds.includes(query.stopId)) continue;
      if (query.mode && !alertMatchesMode(query.mode, routes, stops, informed)) continue;

      alerts.push({
        id: entity.id,
        mode: inferAlertMode(routes, stops, informed),
        routes,
        stops,
        header: translatedText(entity.alert.headerText),
        description: translatedText(entity.alert.descriptionText),
        url: translatedText(entity.alert.url),
        effect: entity.alert.effect,
        activePeriods: (entity.alert.activePeriod ?? []).map((period) => ({
          start: period.start ? new Date(period.start * 1000).toISOString() : undefined,
          end: period.end ? new Date(period.end * 1000).toISOString() : undefined,
        })),
        source: "mta-gtfs-rt",
        raw: query.includeRaw ? entity : undefined,
      });
    }

    return alerts;
  }
}

class StopsClient {
  constructor(private readonly mta: MTA) {}

  async near(query: StopsNearQuery): Promise<Stop[]> {
    for (const mode of query.modes ?? []) {
      if (!(await this.mta.static.hasStaticData(mode))) throw new StaticDataMissingError(mode);
    }
    return this.mta.static.stopsNear(query);
  }
}

function normalizeRouteId(route: string) {
  return route.toUpperCase().trim();
}

function normalizeDirection(direction: Direction | "uptown" | "downtown" | undefined): Direction | undefined {
  if (!direction) return undefined;
  if (direction === "uptown") return "north";
  if (direction === "downtown") return "south";
  return direction;
}

function directionFromStopId(stopId: string): Direction {
  if (stopId.endsWith("N")) return "north";
  if (stopId.endsWith("S")) return "south";
  return "unknown";
}

function routeWithFallback(route: Route | undefined, routeId: string): Route {
  return (
    route ?? {
      id: routeId,
      shortName: routeId,
      color: subwayRouteColors[routeId] ? `#${subwayRouteColors[routeId]}` : undefined,
    }
  );
}

function fallbackStop(stopId: string): Stop {
  return { id: stopId, name: stopId };
}

function busLineRef(route: string) {
  const normalized = normalizeBusRouteId(route);
  return normalized.includes("_") ? normalized : `MTA NYCT_${normalized}`;
}

function routeFromLineRef(lineRef: string) {
  return String(lineRef).split("_").at(-1)?.toUpperCase() ?? String(lineRef).toUpperCase();
}

function normalizeBusRouteId(route: string) {
  const normalized = route.toUpperCase().trim();
  const aliases: Record<string, string> = {
    M14A: "M14A-SBS",
    M14D: "M14D-SBS",
    M15: "M15-SBS",
    M23: "M23-SBS",
    M34: "M34-SBS",
    M34A: "M34A-SBS",
    M60: "M60-SBS",
    M79: "M79-SBS",
    M86: "M86-SBS",
  };
  return aliases[normalized] ?? normalized;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function translatedText(value: TranslatedString | undefined) {
  return value?.translation?.find((translation) => !translation.language || translation.language === "en")?.text ??
    value?.translation?.[0]?.text;
}

function monitoredStopVisits(body: unknown): any[] {
  return (
    (body as any)?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit ??
    (body as any)?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.MonitoredStopVisit ??
    []
  );
}

function monitoredVehicleJourneys(body: unknown): any[] {
  const visits =
    (body as any)?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.[0]?.VehicleActivity ??
    (body as any)?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.VehicleActivity ??
    [];
  return visits.map((visit: any) => visit.MonitoredVehicleJourney).filter(Boolean);
}

function inferAlertMode(
  routes: Route[],
  stops: Stop[],
  informed: { routeType?: number }[],
): TransitMode | undefined {
  if (stops.some((stop) => stop.mode)) return stops.find((stop) => stop.mode)?.mode;
  if (informed.some((item) => item.routeType === 3)) return "bus";
  if (informed.some((item) => item.routeType === 1)) return "subway";
  if (routes.some((route) => route.type === 3)) return "bus";
  if (routes.some((route) => route.type === 1 || route.id.length <= 2)) return "subway";
  return undefined;
}

function alertMatchesMode(
  mode: TransitMode,
  routes: Route[],
  stops: Stop[],
  informed: { routeType?: number }[],
) {
  return inferAlertMode(routes, stops, informed) === mode;
}

export { decodeFeedMessage, encodeFeedMessage } from "./src/gtfs-realtime";
export * from "./src/errors";
export type * from "./src/types";
