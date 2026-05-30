import type {
  KnownBusRoute,
  KnownBusStopId,
  KnownRoute,
  KnownStopId,
  KnownSubwayRoute,
  KnownSubwayStopId,
} from "./generated";

export type AutocompleteString<TKnown extends string> =
  | TKnown
  | (string & {});

export type RouteId = AutocompleteString<KnownRoute>;
export type SubwayRoute = AutocompleteString<KnownSubwayRoute>;
export type BusRoute = AutocompleteString<KnownBusRoute>;
export type StopId = AutocompleteString<KnownStopId>;
export type SubwayStopId = AutocompleteString<KnownSubwayStopId>;
export type BusStopId = AutocompleteString<KnownBusStopId>;

export type TransitMode = "subway" | "bus" | "lirr" | "metro-north";
export type StopMode = "subway" | "bus";

export type Direction = "north" | "south" | "east" | "west" | "unknown";
export type SubwayResolvedDirection = "north" | "south";
export type SubwayDirectionAlias = Direction | "uptown" | "downtown";

export type DirectionHeadsigns = Record<string, string[]>;

export interface MTAOptions {
  apiKey?: string;
  apiBaseUrl?: string;
  busTimeKey?: string;
  realtimeCacheTtlMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  staticData?: StaticGtfsSeed;
  staticDataMode?: TransitMode;
  endpoints?: Partial<MTAEndpoints>;
}

export interface MTAEndpoints {
  subwayFeeds: Record<string, string>;
  alerts: string;
  busVehicleMonitoring: string;
  busStopMonitoring: string;
}

export interface StaticGtfsSeed {
  stops?: GtfsStopInput[];
  routes?: GtfsRouteInput[];
  trips?: GtfsTripInput[];
  stopTimes?: GtfsStopTimeInput[];
}

export interface GtfsImportSummary {
  mode: TransitMode;
  sourceUrl?: string;
  importedAt: string;
  stopCount: number;
  routeCount: number;
  tripCount: number;
  stopTimeCount: number;
}

export interface StaticGtfsImportLimits {
  stops?: number;
  routes?: number;
  trips?: number;
  stopTimes?: number;
}

export type StaticGtfsImportStrategy = "core" | "schedule";

export interface StaticGtfsImportOptions {
  strategy?: StaticGtfsImportStrategy;
  limits?: StaticGtfsImportLimits;
}

export interface StaticDataStatus {
  mode: TransitMode;
  ready: boolean;
  importedAt?: string;
  sourceUrl?: string;
  stopCount: number;
  routeCount: number;
  tripCount: number;
  stopTimeCount: number;
}

export type DatabaseStatus = Record<TransitMode, StaticDataStatus>;

export interface GtfsStopInput {
  stop_id: string;
  stop_name: string;
  stop_lat?: number | string;
  stop_lon?: number | string;
  parent_station?: string;
  location_type?: number | string;
}

export interface GtfsRouteInput {
  route_id: string;
  route_short_name?: string;
  route_long_name?: string;
  route_type?: number | string;
  route_color?: string;
  route_text_color?: string;
}

export interface GtfsTripInput {
  route_id: string;
  service_id?: string;
  trip_id: string;
  trip_headsign?: string;
  direction_id?: number | string;
}

export interface GtfsStopTimeInput {
  trip_id: string;
  arrival_time?: string;
  departure_time?: string;
  stop_id: string;
  stop_sequence?: number | string;
}

export interface Route {
  id: string;
  shortName?: string;
  longName?: string;
  color?: string;
  textColor?: string;
  type?: number;
}

export interface Stop {
  id: string;
  name: string;
  displayName?: string;
  lat?: number;
  lon?: number;
  parentStation?: string;
  parentId?: string;
  mode?: TransitMode;
}

export type ServedRoute = Route & {
  headsigns?: string[];
  directionHeadsigns?: DirectionHeadsigns;
  directions?: number[];
};

export type NearbyStop = Stop & {
  distanceMeters?: number;
  servedRoutes?: ServedRoute[];
  routeMatch?: boolean;
  routeHeadsigns?: string[];
  directionHeadsigns?: DirectionHeadsigns;
  note?: string;
};

export type StopLookup = {
  requestedId: string;
  found: boolean;
  stop?: Stop;
  servedRoutes?: ServedRoute[];
};

export type RouteCatalogEntry = Route & {
  mode: StopMode;
};

export interface Arrival {
  mode: TransitMode;
  route: Route;
  stop: Stop;
  direction: Direction;
  destination?: string;
  displayDirection?: string;
  headsign?: string;
  arrivalTime: string;
  departureTime?: string;
  minutes: number;
  tripId?: string;
  realtime: boolean;
  source: "mta-gtfs-rt" | "mta-bustime";
  raw?: unknown;
}

export interface Vehicle {
  mode: TransitMode;
  route: Route;
  vehicleId?: string;
  tripId?: string;
  stop?: Stop;
  lat?: number;
  lon?: number;
  bearing?: number;
  destinationName?: string;
  recordedAt?: string;
  source: "mta-bustime";
  raw?: unknown;
}

export interface Alert {
  id: string;
  mode?: TransitMode;
  routes: Route[];
  stops: Stop[];
  header?: string;
  description?: string;
  url?: string;
  effect?: string;
  severity?: string;
  activePeriods: { start?: string; end?: string }[];
  source: "mta-gtfs-rt";
  raw?: unknown;
}

export interface SubwayArrivalQuery {
  stopId: SubwayStopId;
  route?: SubwayRoute;
  direction?: SubwayDirectionAlias;
  limit?: number;
  includeRaw?: boolean;
}

export interface SubwayArrivalBoardQuery {
  lat: number;
  lon: number;
  route?: SubwayRoute;
  radiusMeters?: number;
  limitStations?: number;
  limitArrivals?: number;
  includeRaw?: boolean;
}

export type ArrivalBoardDirection = {
  direction: Direction;
  headsign?: string;
  arrivals: Arrival[];
};

export type SubwayArrivalBoardStation = {
  station: Stop;
  distanceMeters: number;
  directions: ArrivalBoardDirection[];
};

export interface SubwayDirectionQuery {
  route: SubwayRoute;
  fromStopId: SubwayStopId;
  destination: string;
}

export interface SubwayDirectionResolution {
  route: Route;
  destination: string;
  normalizedDestination: string;
  resolved: boolean;
  direction?: SubwayResolvedDirection;
  displayDirection?: string;
  terminal?: string;
  fromStop?: Stop;
  destinationStop?: Stop;
  matches?: Stop[];
  reason?: string;
}

export interface BusArrivalQuery {
  stopId: BusStopId;
  route?: BusRoute;
  limit?: number;
  includeRaw?: boolean;
}

export interface BusArrivalBoardQuery {
  lat: number;
  lon: number;
  route?: BusRoute;
  radiusMeters?: number;
  limitStops?: number;
  limitArrivals?: number;
  includeRaw?: boolean;
}

export type BusArrivalBoardRoute = {
  route: Route;
  headsign?: string;
  arrivals: Arrival[];
};

export type BusArrivalBoardStop = {
  stop: Stop;
  distanceMeters: number;
  routes: BusArrivalBoardRoute[];
};

export interface BusVehicleQuery {
  route?: BusRoute;
  vehicleId?: string;
  limit?: number;
  includeRaw?: boolean;
}

export interface AlertQuery {
  mode?: TransitMode;
  route?: RouteId;
  stopId?: StopId;
  includeRaw?: boolean;
}

export interface StopsNearQuery {
  lat: number;
  lon: number;
  modes?: TransitMode[];
  route?: RouteId;
  includeRoutes?: boolean;
  radiusMeters?: number;
  limit?: number;
}

export interface StopsByIdsQuery {
  ids: StopId[];
  includeRoutes?: boolean;
}

export interface RoutesListQuery {
  modes?: StopMode[];
}

export type RoutePatternStop = Stop & {
  arrivals?: Arrival[];
};

export type RoutePattern = {
  direction: string;
  headsigns?: string[];
  stops: RoutePatternStop[];
};

export type RouteStopsResponse = {
  route: Route;
  mode: StopMode;
  directions: RoutePattern[];
};

export interface SubwayRouteStationsQuery {
  route: SubwayRoute;
  direction?: SubwayDirectionAlias;
  includeArrivals?: boolean;
  limitArrivals?: number;
  limitStops?: number;
  includeRaw?: boolean;
}

export interface BusRouteStopsQuery {
  route: BusRoute;
  direction?: number | string;
  includeArrivals?: boolean;
  limitArrivals?: number;
  limitStops?: number;
  includeRaw?: boolean;
}
