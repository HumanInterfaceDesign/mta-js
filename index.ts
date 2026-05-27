import { defaultEndpoints, subwayRouteColors } from "./src/defaults";
import { MissingBusTimeKeyError, StaticDataMissingError, UnknownRouteError, UnknownStopError } from "./src/errors";
import { decodeFeedMessage, type GtfsRealtimeFeed, type TranslatedString } from "./src/gtfs-realtime";
import { fetchArrayBuffer, fetchJson, urlWithParams } from "./src/http";
import { directionFromStopId, GTFSCache } from "./src/static-gtfs";
import type {
  Alert,
  AlertQuery,
  Arrival,
  BusArrivalQuery,
  BusVehicleQuery,
  Direction,
  MTAEndpoints,
  MTAOptions,
  NearbyStop,
  Route,
  Stop,
  StopsNearQuery,
  SubwayArrivalQuery,
  SubwayDirectionQuery,
  SubwayDirectionResolution,
  TransitMode,
  Vehicle,
} from "./src/types";

export class MTA {
  static: GTFSCache;
  readonly subway: SubwayClient;
  readonly bus: BusClient;
  readonly alerts: AlertsClient;
  readonly stops: StopsClient;

  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly apiKey?: string;
  readonly apiBaseUrl: string;
  readonly busTimeKey?: string;
  readonly endpoints: MTAEndpoints;
  readonly options: MTAOptions;
  private readonly realtimeCache = new Map<string, { expiresAt: number; feed: GtfsRealtimeFeed }>();
  private readonly realtimeCacheTtlMs: number;

  constructor(options: MTAOptions = {}) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.apiKey = options.apiKey;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://www.mtaapi.dev";
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
    this.static = new GTFSCache(options.staticData, options.staticDataMode ?? "subway");

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

  hostedApiEnabled() {
    return Boolean(this.apiKey);
  }

  async hostedJson<T>(path: string, query: object = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error("mta-js hosted API calls require an apiKey.");
    }

    const url = urlWithParams(
      new URL(path, this.apiBaseUrl).toString(),
      serializeHostedQuery(query),
    );

    return fetchJson(this.fetch, url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "x-api-key": this.apiKey,
      },
    }) as Promise<T>;
  }
}

class SubwayClient {
  constructor(private readonly mta: MTA) {}

  async arrivals(query: SubwayArrivalQuery): Promise<Arrival[]> {
    const normalizedQuery = normalizeSubwayArrivalQuery(query);
    if (this.mta.hostedApiEnabled()) {
      return this.mta.hostedJson<Arrival[]>("/api/v1/subway/arrivals", normalizedQuery);
    }

    await this.mta.ready();
    const routeIds = normalizedQuery.route ? [normalizeRouteId(normalizedQuery.route)] : Object.keys(this.mta.endpoints.subwayFeeds);
    const feeds = [...new Set(routeIds.map((route) => this.feedForRoute(route)))];
    const stopIds = this.mta.static.getStopIdsForQuery(normalizedQuery.stopId);
    if (this.mta.static.hasStaticData("subway") && !this.mta.static.getStopOrParent(normalizedQuery.stopId)) {
      throw new UnknownStopError(normalizedQuery.stopId);
    }
    const arrivals: Arrival[] = [];

    for (const feedUrl of feeds) {
      const feed = await this.mta.realtimeFeed(feedUrl);
      arrivals.push(...this.arrivalsFromFeed(feed, stopIds, normalizedQuery));
    }

    return arrivals
      .sort((a, b) => Date.parse(a.arrivalTime) - Date.parse(b.arrivalTime))
      .slice(0, query.limit ?? 20);
  }

  direction(query: SubwayDirectionQuery): Promise<SubwayDirectionResolution> {
    return this.mta.hostedJson<SubwayDirectionResolution>("/api/v1/subway/direction", query);
  }

  private feedForRoute(route: string) {
    const feed = this.mta.endpoints.subwayFeeds[route];
    if (!feed) throw new UnknownRouteError(route);
    return feed;
  }

  private arrivalsFromFeed(
    feed: GtfsRealtimeFeed,
    stopIds: Set<string>,
    query: SubwayArrivalQuery,
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

      const staticTrip = trip?.tripId ? this.mta.static.getTrip(trip.tripId) : undefined;
      const route = routeWithFallback(this.mta.static.getRoute(routeId), routeId);

      for (const update of tripUpdate.stopTimeUpdate ?? []) {
        const stopId = update.stopId;
        if (!stopId || !stopIds.has(stopId)) continue;
        if (update.scheduleRelationship === "SKIPPED" || update.scheduleRelationship === "NO_DATA") continue;

        const direction = directionFromStopId(stopId);
        if (wantedDirection && direction !== wantedDirection) continue;

        const event = update.arrival ?? update.departure;
        if (!event?.time) continue;

        const stop = this.mta.static.getStopOrParent(stopId) ?? fallbackStop(query.stopId);
        const headsign = staticTrip?.headsign ?? undefined;
        arrivals.push({
          mode: "subway",
          route,
          stop,
          direction,
          destination: headsign,
          displayDirection: displayDirection(headsign, direction),
          headsign,
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
    if (this.mta.hostedApiEnabled()) {
      return this.mta.hostedJson<Arrival[]>("/api/v1/bus/arrivals", query);
    }

    await this.mta.ready();
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

    return journeys
      .map((journey): Arrival | undefined => {
        const mvj = journey.MonitoredVehicleJourney;
        if (!mvj) return undefined;
        const routeId = routeFromLineRef(mvj.LineRef ?? query.route ?? "");
        const call = mvj.MonitoredCall ?? {};
        const expected = call.ExpectedArrivalTime ?? call.AimedArrivalTime;
        if (!expected) return undefined;
        const stop = this.mta.static.getStop(String(call.StopPointRef ?? query.stopId)) ?? fallbackStop(query.stopId);
        const headsign = stringOrUndefined(mvj.DestinationName);
        return {
          mode: "bus",
          route: routeWithFallback(this.mta.static.getRoute(routeId), routeId),
          stop,
          direction: "unknown",
          destination: headsign,
          displayDirection: displayDirection(headsign, "unknown"),
          headsign,
          arrivalTime: new Date(expected).toISOString(),
          minutes: Math.max(0, Math.round((Date.parse(expected) - now) / 60_000)),
          tripId: stringOrUndefined(mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef),
          realtime: true,
          source: "mta-bustime",
          raw: query.includeRaw ? journey : undefined,
        };
      })
      .filter((arrival): arrival is Arrival => Boolean(arrival))
      .sort((a, b) => Date.parse(a.arrivalTime) - Date.parse(b.arrivalTime))
      .slice(0, query.limit ?? 20);
  }

  async vehicles(query: BusVehicleQuery = {}): Promise<Vehicle[]> {
    if (this.mta.hostedApiEnabled()) {
      return this.mta.hostedJson<Vehicle[]>("/api/v1/bus/vehicles", query);
    }

    await this.mta.ready();
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

    return monitoredVehicleJourneys(body)
      .map((mvj): Vehicle => {
        const routeId = routeFromLineRef(mvj.LineRef ?? query.route ?? "");
        const location = mvj.VehicleLocation ?? {};
        const stopId = stringOrUndefined(mvj.MonitoredCall?.StopPointRef);
        return {
          mode: "bus",
          route: routeWithFallback(this.mta.static.getRoute(routeId), routeId),
          vehicleId: stringOrUndefined(mvj.VehicleRef),
          tripId: stringOrUndefined(mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef),
          stop: stopId ? this.mta.static.getStop(stopId) ?? fallbackStop(stopId) : undefined,
          lat: numberOrUndefined(location.Latitude),
          lon: numberOrUndefined(location.Longitude),
          bearing: numberOrUndefined(mvj.Bearing),
          destinationName: stringOrUndefined(mvj.DestinationName),
          recordedAt: mvj.RecordedAtTime ? new Date(mvj.RecordedAtTime).toISOString() : undefined,
          source: "mta-bustime",
          raw: query.includeRaw ? mvj : undefined,
        };
      })
      .slice(0, query.limit ?? 50);
  }

  private requireKey() {
    if (!this.mta.busTimeKey) throw new MissingBusTimeKeyError();
    return this.mta.busTimeKey;
  }
}

class AlertsClient {
  constructor(private readonly mta: MTA) {}

  async current(query: AlertQuery = {}): Promise<Alert[]> {
    if (this.mta.hostedApiEnabled()) {
      return this.mta.hostedJson<Alert[]>("/api/v1/alerts", query);
    }

    await this.mta.ready();
    const feed = await this.mta.realtimeFeed(this.mta.endpoints.alerts);
    const alerts: Alert[] = [];

    for (const entity of feed.entity) {
      if (!entity.alert) continue;
      const informed = entity.alert.informedEntity ?? [];
      const routeIds = [...new Set(informed.map((item) => item.routeId).filter((id): id is string => Boolean(id)))];
      const stopIds = [...new Set(informed.map((item) => item.stopId).filter((id): id is string => Boolean(id)))];
      const routes = routeIds.map((id) => routeWithFallback(this.mta.static.getRoute(id), id));
      const stops = stopIds.map((id) => this.mta.static.getStopOrParent(id) ?? fallbackStop(id));

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

  near(query: StopsNearQuery): Promise<NearbyStop[]> {
    if (this.mta.hostedApiEnabled()) {
      return this.mta.hostedJson<NearbyStop[]>("/api/v1/stops/near", query);
    }

    return this.mta.ready().then(() => {
      if (!this.mta.static.hasStopData()) throw new StaticDataMissingError(query.modes?.[0] ?? "requested modes");
      return this.mta.static.stopsNear(query);
    });
  }
}

function serializeHostedQuery(query: object) {
  const params: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      params[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      params[key] = value.join(",");
    }
  }
  return params;
}

function normalizeRouteId(route: string) {
  return route.toUpperCase().trim();
}

function normalizeSubwayArrivalQuery(query: SubwayArrivalQuery): SubwayArrivalQuery {
  const route = query.route ?? routeFromLStopId(query.stopId);
  return {
    ...query,
    route,
    direction: normalizeDirection(query.direction, route),
  };
}

function normalizeDirection(
  direction: Direction | "uptown" | "downtown" | undefined,
  route?: string,
): Direction | undefined {
  if (!direction) return undefined;
  if (direction === "uptown") return "north";
  if (direction === "downtown") return "south";
  if (route && normalizeRouteId(route) === "L") {
    if (direction === "east") return "south";
    if (direction === "west") return "north";
  }
  return direction;
}

function routeFromLStopId(stopId: string) {
  return /^L\d{2}[NS]?$/.test(stopId.toUpperCase().trim()) ? "L" : undefined;
}

function displayDirection(headsign: string | undefined, direction: Direction) {
  if (headsign) return `toward ${headsign}`;
  if (direction === "unknown") return undefined;
  return `${direction}bound`;
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
export { GTFSCache } from "./src/static-gtfs";
export * from "./src/errors";
export type * from "./src/generated";
export type * from "./src/types";
