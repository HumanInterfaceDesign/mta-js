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
  BusArrivalBoardQuery,
  BusArrivalBoardStop,
  CitiBikeAlert,
  CitiBikeStation,
  CitiBikeStationQuery,
  CitiBikeStationsQuery,
  BusRouteStopsQuery,
  BusVehicleQuery,
  CommuterRailAlert,
  CommuterRailDeparture,
  CommuterRailDeparturesQuery,
  CommuterRailRoute,
  CommuterRailRouteStops,
  CommuterRailRouteStopsQuery,
  CommuterRailStop,
  CommuterRailStopsQuery,
  CommuterRailVehicle,
  CommuterRailVehiclesQuery,
  Direction,
  MTAEndpoints,
  MTAOptions,
  NearbyStop,
  NjTransitRailAlert,
  NjTransitRailAlertsQuery,
  NjTransitRailDeparture,
  NjTransitRailDeparturesQuery,
  NjTransitRailRouteStations,
  NjTransitRailRouteStationsQuery,
  NjTransitRailStation,
  NjTransitRailStationsQuery,
  NjTransitRailVehicle,
  NjTransitRailVehiclesQuery,
  NycFerryAlert,
  NycFerryArrival,
  NycFerryArrivalsQuery,
  NycFerryRoute,
  NycFerryRouteStops,
  NycFerryRouteStopsQuery,
  NycFerryStop,
  NycFerryVehicle,
  NycFerryVehiclesQuery,
  PathArrival,
  PathArrivalsQuery,
  PathRoute,
  PathRouteStations,
  PathRouteStationsQuery,
  PathStation,
  Route,
  RouteCatalogEntry,
  RouteStopsResponse,
  RoutesListQuery,
  Stop,
  StopLookup,
  StopsByIdsQuery,
  StopsNearQuery,
  SubwayArrivalQuery,
  SubwayArrivalBoardQuery,
  SubwayArrivalBoardStation,
  SubwayDirectionQuery,
  SubwayDirectionResolution,
  SubwayRouteStationsQuery,
  TransitMode,
  Vehicle,
} from "./src/types";

export class MTA {
  static: GTFSCache;
  readonly subway: SubwayClient;
  readonly bus: BusClient;
  readonly path: PathClient;
  readonly njTransit: { rail: NjTransitRailClient };
  readonly nycFerry: NycFerryClient;
  readonly citiBike: CitiBikeClient;
  readonly bayWheels: CitiBikeClient;
  readonly divvy: CitiBikeClient;
  readonly bluebikes: CitiBikeClient;
  readonly capitalBikeshare: CitiBikeClient;
  readonly biketown: CitiBikeClient;
  readonly indego: CitiBikeClient;
  readonly metroBikeShare: CitiBikeClient;
  readonly lirr: CommuterRailClient;
  readonly metroNorth: CommuterRailClient;
  readonly mbta: CommuterRailClient;
  readonly bart: CommuterRailClient;
  readonly kingCountyMetro: CommuterRailClient;
  readonly capMetro: CommuterRailClient;
  readonly pace: CommuterRailClient;
  readonly triRail: CommuterRailClient;
  readonly brightline: CommuterRailClient;
  readonly rtd: CommuterRailClient;
  readonly metroTransit: CommuterRailClient;
  readonly prt: CommuterRailClient;
  readonly marta: CommuterRailClient;
  readonly via: CommuterRailClient;
  readonly gcrta: CommuterRailClient;
  readonly cats: CommuterRailClient;
  readonly sacrt: CommuterRailClient;
  readonly marc: CommuterRailClient;
  readonly uta: CommuterRailClient;
  readonly jta: CommuterRailClient;
  readonly muni: CommuterRailClient;
  readonly caltrain: CommuterRailClient;
  readonly wmataRail: CommuterRailClient;
  readonly wmataBus: CommuterRailClient;
  readonly soundTransit: CommuterRailClient;
  readonly houstonMetro: CommuterRailClient;
  readonly sdmts: CommuterRailClient;
  readonly metra: CommuterRailClient;
  readonly trimet: CommuterRailClient;
  readonly metrolink: CommuterRailClient;
  readonly alerts: AlertsClient;
  readonly stops: StopsClient;
  readonly routes: RoutesClient;

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
    this.path = new PathClient(this);
    this.njTransit = { rail: new NjTransitRailClient(this) };
    this.nycFerry = new NycFerryClient(this);
    this.citiBike = new CitiBikeClient(this, "/api/v1/citi-bike");
    this.bayWheels = new CitiBikeClient(this, "/api/v1/bay-wheels");
    this.divvy = new CitiBikeClient(this, "/api/v1/divvy");
    this.bluebikes = new CitiBikeClient(this, "/api/v1/bluebikes");
    this.capitalBikeshare = new CitiBikeClient(this, "/api/v1/capital-bikeshare");
    this.biketown = new CitiBikeClient(this, "/api/v1/biketown");
    this.indego = new CitiBikeClient(this, "/api/v1/indego");
    this.metroBikeShare = new CitiBikeClient(this, "/api/v1/metro-bike-share");
    this.lirr = new CommuterRailClient(this, "/api/v1/lirr");
    this.metroNorth = new CommuterRailClient(this, "/api/v1/metro-north");
    this.mbta = new CommuterRailClient(this, "/api/v1/mbta");
    this.bart = new CommuterRailClient(this, "/api/v1/bart");
    this.kingCountyMetro = new CommuterRailClient(this, "/api/v1/king-county-metro");
    this.capMetro = new CommuterRailClient(this, "/api/v1/capmetro");
    this.pace = new CommuterRailClient(this, "/api/v1/pace");
    this.triRail = new CommuterRailClient(this, "/api/v1/tri-rail");
    this.brightline = new CommuterRailClient(this, "/api/v1/brightline");
    this.rtd = new CommuterRailClient(this, "/api/v1/rtd");
    this.metroTransit = new CommuterRailClient(this, "/api/v1/metro-transit");
    this.prt = new CommuterRailClient(this, "/api/v1/prt");
    this.marta = new CommuterRailClient(this, "/api/v1/marta");
    this.via = new CommuterRailClient(this, "/api/v1/via");
    this.gcrta = new CommuterRailClient(this, "/api/v1/gcrta");
    this.cats = new CommuterRailClient(this, "/api/v1/cats");
    this.sacrt = new CommuterRailClient(this, "/api/v1/sacrt");
    this.marc = new CommuterRailClient(this, "/api/v1/marc");
    this.uta = new CommuterRailClient(this, "/api/v1/uta");
    this.jta = new CommuterRailClient(this, "/api/v1/jta");
    this.muni = new CommuterRailClient(this, "/api/v1/muni");
    this.caltrain = new CommuterRailClient(this, "/api/v1/caltrain");
    this.wmataRail = new CommuterRailClient(this, "/api/v1/wmata-rail");
    this.wmataBus = new CommuterRailClient(this, "/api/v1/wmata-bus");
    this.soundTransit = new CommuterRailClient(this, "/api/v1/sound-transit");
    this.houstonMetro = new CommuterRailClient(this, "/api/v1/houston-metro");
    this.sdmts = new CommuterRailClient(this, "/api/v1/sdmts");
    this.metra = new CommuterRailClient(this, "/api/v1/metra");
    this.trimet = new CommuterRailClient(this, "/api/v1/trimet");
    this.metrolink = new CommuterRailClient(this, "/api/v1/metrolink");
    this.alerts = new AlertsClient(this);
    this.stops = new StopsClient(this);
    this.routes = new RoutesClient(this);
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

  arrivalBoard(query: SubwayArrivalBoardQuery): Promise<SubwayArrivalBoardStation[]> {
    return this.mta.hostedJson<SubwayArrivalBoardStation[]>("/api/v1/subway/arrival-board", {
      ...query,
      route: query.route ? normalizeRouteId(query.route) : undefined,
    });
  }

  routeStations(query: SubwayRouteStationsQuery): Promise<RouteStopsResponse> {
    return this.mta.hostedJson<RouteStopsResponse>(
      `/api/v1/subway/routes/${encodeURIComponent(normalizeRouteId(query.route))}/stations`,
      {
        ...query,
        route: undefined,
        direction: normalizeDirection(query.direction, query.route),
      },
    );
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

  arrivalBoard(query: BusArrivalBoardQuery): Promise<BusArrivalBoardStop[]> {
    return this.mta.hostedJson<BusArrivalBoardStop[]>("/api/v1/bus/arrival-board", query);
  }

  routeStops(query: BusRouteStopsQuery): Promise<RouteStopsResponse> {
    return this.mta.hostedJson<RouteStopsResponse>(
      `/api/v1/bus/routes/${encodeURIComponent(query.route)}/stops`,
      {
        ...query,
        route: undefined,
      },
    );
  }

  private requireKey() {
    if (!this.mta.busTimeKey) throw new MissingBusTimeKeyError();
    return this.mta.busTimeKey;
  }
}

class PathClient {
  constructor(private readonly mta: MTA) {}

  stations(): Promise<PathStation[]> {
    return this.mta.hostedJson<PathStation[]>("/api/v1/path/stations");
  }

  routes(): Promise<PathRoute[]> {
    return this.mta.hostedJson<PathRoute[]>("/api/v1/path/routes");
  }

  arrivals(query: PathArrivalsQuery = {}): Promise<PathArrival[]> {
    return this.mta.hostedJson<PathArrival[]>("/api/v1/path/arrivals", query);
  }

  routeStations(query: PathRouteStationsQuery): Promise<PathRouteStations> {
    return this.mta.hostedJson<PathRouteStations>(
      `/api/v1/path/routes/${encodeURIComponent(query.route)}/stations`,
      { direction: query.direction },
    );
  }
}

class NjTransitRailClient {
  constructor(private readonly mta: MTA) {}

  stations(query: NjTransitRailStationsQuery = {}): Promise<NjTransitRailStation[]> {
    return this.mta.hostedJson<NjTransitRailStation[]>("/api/v1/nj-transit/rail/stations", query);
  }

  departures(query: NjTransitRailDeparturesQuery): Promise<NjTransitRailDeparture[]> {
    return this.mta.hostedJson<NjTransitRailDeparture[]>("/api/v1/nj-transit/rail/departures", query);
  }

  vehicles(query: NjTransitRailVehiclesQuery = {}): Promise<NjTransitRailVehicle[]> {
    return this.mta.hostedJson<NjTransitRailVehicle[]>("/api/v1/nj-transit/rail/vehicles", query);
  }

  alerts(query: NjTransitRailAlertsQuery = {}): Promise<NjTransitRailAlert[]> {
    return this.mta.hostedJson<NjTransitRailAlert[]>("/api/v1/nj-transit/rail/alerts", query);
  }

  routeStations(query: NjTransitRailRouteStationsQuery): Promise<NjTransitRailRouteStations> {
    return this.mta.hostedJson<NjTransitRailRouteStations>(
      `/api/v1/nj-transit/rail/routes/${encodeURIComponent(query.route)}/stations`,
      { direction: query.direction },
    );
  }
}

class NycFerryClient {
  constructor(private readonly mta: MTA) {}

  stops(): Promise<NycFerryStop[]> {
    return this.mta.hostedJson<NycFerryStop[]>("/api/v1/nyc-ferry/stops");
  }

  routes(): Promise<NycFerryRoute[]> {
    return this.mta.hostedJson<NycFerryRoute[]>("/api/v1/nyc-ferry/routes");
  }

  routeStops(query: NycFerryRouteStopsQuery): Promise<NycFerryRouteStops> {
    return this.mta.hostedJson<NycFerryRouteStops>(
      `/api/v1/nyc-ferry/routes/${encodeURIComponent(query.route)}/stops`,
    );
  }

  arrivals(query: NycFerryArrivalsQuery = {}): Promise<NycFerryArrival[]> {
    return this.mta.hostedJson<NycFerryArrival[]>("/api/v1/nyc-ferry/arrivals", query);
  }

  vehicles(query: NycFerryVehiclesQuery = {}): Promise<NycFerryVehicle[]> {
    return this.mta.hostedJson<NycFerryVehicle[]>("/api/v1/nyc-ferry/vehicles", query);
  }

  alerts(): Promise<NycFerryAlert[]> {
    return this.mta.hostedJson<NycFerryAlert[]>("/api/v1/nyc-ferry/alerts");
  }
}

class CitiBikeClient {
  constructor(
    private readonly mta: MTA,
    private readonly basePath: string,
  ) {}

  stations(query: CitiBikeStationsQuery = {}): Promise<CitiBikeStation[]> {
    return this.mta.hostedJson<CitiBikeStation[]>(`${this.basePath}/stations`, query);
  }

  station(query: CitiBikeStationQuery): Promise<CitiBikeStation> {
    return this.mta.hostedJson<CitiBikeStation>(
      `${this.basePath}/stations/${encodeURIComponent(query.id)}`,
    );
  }

  alerts(): Promise<CitiBikeAlert[]> {
    return this.mta.hostedJson<CitiBikeAlert[]>(`${this.basePath}/alerts`);
  }
}

class CommuterRailClient {
  constructor(
    private readonly mta: MTA,
    private readonly basePath: string,
  ) {}

  stops(query: CommuterRailStopsQuery = {}): Promise<CommuterRailStop[]> {
    return this.mta.hostedJson<CommuterRailStop[]>(`${this.basePath}/stops`, query);
  }

  routes(): Promise<CommuterRailRoute[]> {
    return this.mta.hostedJson<CommuterRailRoute[]>(`${this.basePath}/routes`);
  }

  routeStops(query: CommuterRailRouteStopsQuery): Promise<CommuterRailRouteStops> {
    return this.mta.hostedJson<CommuterRailRouteStops>(
      `${this.basePath}/routes/${encodeURIComponent(query.route)}/stops`,
    );
  }

  departures(query: CommuterRailDeparturesQuery): Promise<CommuterRailDeparture[]> {
    return this.mta.hostedJson<CommuterRailDeparture[]>(`${this.basePath}/departures`, query);
  }

  vehicles(query: CommuterRailVehiclesQuery = {}): Promise<CommuterRailVehicle[]> {
    return this.mta.hostedJson<CommuterRailVehicle[]>(`${this.basePath}/vehicles`, query);
  }

  alerts(): Promise<CommuterRailAlert[]> {
    return this.mta.hostedJson<CommuterRailAlert[]>(`${this.basePath}/alerts`);
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

  byIds(query: StopsByIdsQuery): Promise<StopLookup[]> {
    return this.mta.hostedJson<StopLookup[]>("/api/v1/stops", query);
  }
}

class RoutesClient {
  constructor(private readonly mta: MTA) {}

  list(query: RoutesListQuery = {}): Promise<RouteCatalogEntry[]> {
    return this.mta.hostedJson<RouteCatalogEntry[]>("/api/v1/routes", query);
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
