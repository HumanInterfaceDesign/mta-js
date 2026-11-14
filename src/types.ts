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
export type StopMode =
  | "subway"
  | "bus"
  | "path"
  | "nj-transit-rail"
  | "nyc-ferry"
  | "lirr"
  | "metro-north";

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

export type RegionalMode = "subway" | "bus" | "path" | "nj-transit-rail" | "nyc-ferry" | "lirr" | "metro-north";
export type CommuterRailMode =
  | "lirr"
  | "metro-north"
  | "mbta"
  | "bart"
  | "king-county-metro"
  | "capmetro"
  | "pace"
  | "tri-rail"
  | "brightline"
  | "rtd"
  | "metro-transit"
  | "prt"
  | "marta"
  | "via"
  | "gcrta"
  | "cats"
  | "sacrt"
  | "marc"
  | "uta"
  | "jta"
  | "muni"
  | "caltrain"
  | "wmata-rail"
  | "wmata-bus"
  | "sound-transit"
  | "houston-metro"
  | "sdmts"
  | "metra"
  | "trimet"
  | "metrolink";
export type HostedArrivalDirection = "north" | "south" | "east" | "west" | "unknown" | "uptown" | "downtown";

export interface PathStation {
  id: string;
  gtfsId?: string;
  name: string;
  displayName: string;
  lat?: number;
  lon?: number;
  state: "NJ";
  mode: "path";
}

export interface PathRoute {
  id: string;
  gtfsId?: string;
  shortName?: string;
  longName?: string;
  color?: string;
  textColor?: string;
  mode: "path";
}

export interface PathArrivalRoute {
  id: string;
  gtfsId?: string;
  shortName?: string;
  longName?: string;
  type?: number;
  color?: string;
  textColor?: string;
}

export interface PathArrivalStop {
  id: string;
  gtfsId?: string;
  name?: string;
  displayName?: string;
  lat?: number;
  lon?: number;
  state: "NJ";
  mode: "path";
}

export interface PathArrival {
  mode: "path";
  route: PathArrivalRoute;
  stop: PathArrivalStop;
  direction: HostedArrivalDirection;
  destination?: string;
  displayDirection?: string;
  headsign?: string;
  arrivalTime: string;
  minutes: number;
  realtime: boolean;
  source: string;
  raw?: unknown;
}

export interface HostedRoutePatternRoute {
  id: string;
  gtfsId?: string;
  shortName?: string;
  longName?: string;
  type?: number;
  color?: string;
  textColor?: string;
}

export interface HostedRoutePatternArrivalStop {
  id: string;
  name: string;
  displayName?: string;
  lat?: number;
  lon?: number;
  mode?: RegionalMode;
  parentId?: string;
}

export interface HostedRoutePatternArrival {
  mode: "subway" | "bus" | "path" | "nj-transit-rail" | "lirr" | "metro-north";
  route: HostedRoutePatternRoute;
  stop: HostedRoutePatternArrivalStop;
  direction: HostedArrivalDirection;
  destination?: string;
  displayDirection?: string;
  headsign?: string;
  arrivalTime: string;
  departureTime?: string;
  minutes: number;
  tripId?: string;
  realtime: boolean;
  source: string;
  raw?: unknown;
}

export interface HostedRoutePatternStop extends HostedRoutePatternArrivalStop {
  arrivals?: HostedRoutePatternArrival[];
}

export interface HostedRoutePatternDirection {
  direction: string;
  headsigns?: string[];
  stops: HostedRoutePatternStop[];
}

export interface PathRouteStations {
  route: HostedRoutePatternRoute;
  mode: RegionalMode;
  directions: HostedRoutePatternDirection[];
}

export interface PathArrivalsQuery {
  station?: string;
  route?: string;
  direction?: "to-ny" | "to-nj" | "east" | "west";
  limit?: number;
  includeRaw?: boolean;
}

export interface PathRouteStationsQuery {
  route: string;
  direction?: "east" | "west";
}

export interface NjTransitRailStation {
  id: string;
  name: string;
  shortName?: string;
  mode: "nj-transit-rail";
  raw?: unknown;
}

export interface NjTransitRailDepartureStop {
  station: NjTransitRailStation;
  arrivalTime?: string;
  departureTime?: string;
  status?: string;
  departed?: boolean;
  pickupOnly?: boolean;
  dropoffOnly?: boolean;
}

export interface NjTransitRailDeparture {
  mode: "nj-transit-rail";
  route: HostedRoutePatternRoute;
  station: NjTransitRailStation;
  destination?: string;
  departureTime: string;
  minutes: number;
  track?: string;
  trainId?: string;
  tripId?: string;
  status?: string;
  delaySeconds?: number;
  lastUpdated?: string;
  lat?: number;
  lon?: number;
  stops?: NjTransitRailDepartureStop[];
  realtime: boolean;
  source: string;
  raw?: unknown;
}

export interface NjTransitRailVehicle {
  mode: "nj-transit-rail";
  route: HostedRoutePatternRoute;
  vehicleId?: string;
  trainId: string;
  direction?: string;
  trackCircuitId?: string;
  nextStop?: NjTransitRailStation;
  lat?: number;
  lon?: number;
  departureTime?: string;
  delaySeconds?: number;
  recordedAt?: string;
  source: string;
  raw?: unknown;
}

export interface NjTransitRailAlert {
  id: string;
  mode: "nj-transit-rail";
  type?: string;
  header?: string;
  description?: string;
  publishedAt?: string;
  routes: HostedRoutePatternRoute[];
  stations: NjTransitRailStation[];
  source: string;
  raw?: unknown;
}

export interface NjTransitRailRouteStations {
  route: HostedRoutePatternRoute;
  mode: RegionalMode;
  directions: HostedRoutePatternDirection[];
}

export interface NjTransitRailStationsQuery {
  includeRaw?: boolean;
}

export interface NjTransitRailDeparturesQuery {
  station: string;
  line?: string;
  includeStops?: boolean;
  limit?: number;
  includeRaw?: boolean;
}

export interface NjTransitRailVehiclesQuery {
  line?: string;
  limit?: number;
  includeRaw?: boolean;
}

export interface NjTransitRailAlertsQuery {
  station?: string;
  line?: string;
  limit?: number;
  includeRaw?: boolean;
}

export interface NjTransitRailRouteStationsQuery {
  route: string;
  direction?: string;
}

export interface NycFerryStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  parentId?: string;
  mode: "nyc-ferry";
}

export interface NycFerryRoute {
  id: string;
  shortName?: string;
  longName?: string;
  type?: number;
  color?: string;
  textColor?: string;
  mode: "nyc-ferry";
}

export interface NycFerryRouteStops {
  route: NycFerryRoute;
  mode: "nyc-ferry";
  directions: {
    direction: string;
    headsigns?: string[];
    stops: NycFerryStop[];
  }[];
}

export interface NycFerryArrival {
  mode: "nyc-ferry";
  route: NycFerryRoute;
  stop: NycFerryStop;
  direction: string;
  destination?: string;
  headsign?: string;
  arrivalTime: string;
  minutes: number;
  tripId?: string;
  realtime: boolean;
  source: string;
}

export interface NycFerryVehicle {
  mode: "nyc-ferry";
  route: NycFerryRoute;
  vehicleId?: string;
  tripId?: string;
  stop?: NycFerryStop;
  lat?: number;
  lon?: number;
  bearing?: number;
  destinationName?: string;
  recordedAt?: string;
  source: string;
}

export interface NycFerryAlert {
  id: string;
  mode: "nyc-ferry";
  header?: string;
  description?: string;
  url?: string;
  effect?: string;
  activePeriods: { start?: string; end?: string }[];
  routeIds: string[];
  stopIds: string[];
  source: string;
}

export interface NycFerryRouteStopsQuery {
  route: string;
}

export interface NycFerryArrivalsQuery {
  stop?: string;
  route?: string;
  limit?: number;
}

export interface NycFerryVehiclesQuery {
  route?: string;
}

export interface CitiBikeStation {
  id: string;
  shortName?: string;
  name: string;
  lat: number;
  lon: number;
  regionId?: string;
  capacity?: number;
  bikesAvailable: number;
  ebikesAvailable: number;
  classicBikesAvailable: number;
  docksAvailable: number;
  bikesDisabled: number;
  docksDisabled: number;
  isInstalled: boolean;
  isRenting: boolean;
  isReturning: boolean;
  lastReported?: string;
  distanceMeters?: number;
  mode:
    | "citi-bike"
    | "bay-wheels"
    | "divvy"
    | "bluebikes"
    | "capital-bikeshare"
    | "biketown"
    | "indego"
    | "metro-bike-share";
  source:
    | "citi-bike-gbfs"
    | "bay-wheels-gbfs"
    | "divvy-gbfs"
    | "bluebikes-gbfs"
    | "capital-bikeshare-gbfs"
    | "biketown-gbfs"
    | "indego-gbfs"
    | "metro-bike-share-gbfs";
}

export interface CitiBikeAlert {
  id: string;
  type?: string;
  stationIds: string[];
  regionIds: string[];
  summary?: string;
  description?: string;
  url?: string;
  times: { start?: string; end?: string }[];
  lastUpdated?: string;
  mode:
    | "citi-bike"
    | "bay-wheels"
    | "divvy"
    | "bluebikes"
    | "capital-bikeshare"
    | "biketown"
    | "indego"
    | "metro-bike-share";
  source:
    | "citi-bike-gbfs"
    | "bay-wheels-gbfs"
    | "divvy-gbfs"
    | "bluebikes-gbfs"
    | "capital-bikeshare-gbfs"
    | "biketown-gbfs"
    | "indego-gbfs"
    | "metro-bike-share-gbfs";
}

export interface CitiBikeStationsQuery {
  lat?: number;
  lon?: number;
  radius?: number;
  limit?: number;
  minBikes?: number;
  minDocks?: number;
  ebike?: boolean;
}

export interface CitiBikeStationQuery {
  id: string;
}

export interface CommuterRailStop {
  id: string;
  code?: string;
  name: string;
  lat: number;
  lon: number;
  parentStation?: string;
  mode: CommuterRailMode;
}

export interface CommuterRailRoute {
  id: string;
  name: string;
  shortName?: string;
  color?: string;
  type?: number;
  mode: CommuterRailMode;
}

export interface CommuterRailRouteStops {
  route: CommuterRailRoute;
  stops: CommuterRailStop[];
}

export interface CommuterRailDeparture {
  route: CommuterRailRoute;
  stop: CommuterRailStop;
  trainNumber?: string;
  headsign?: string;
  destination?: string;
  direction: string;
  peak?: string;
  time: string;
  minutes: number;
  delaySeconds?: number;
  tripId?: string;
  realtime: true;
  source: string;
}

export interface CommuterRailVehicle {
  route: CommuterRailRoute;
  vehicleId?: string;
  tripId?: string;
  trainNumber?: string;
  stop?: CommuterRailStop;
  lat: number;
  lon: number;
  bearing?: number;
  destination?: string;
  recordedAt?: string;
  source: string;
}

export interface CommuterRailAlert {
  id: string;
  header?: string;
  description?: string;
  url?: string;
  effect?: string;
  activePeriods: { start?: string; end?: string }[];
  routeIds: string[];
  stopIds: string[];
  source: string;
}

export interface CommuterRailStopsQuery {
  name?: string;
}

export interface CommuterRailRouteStopsQuery {
  route: string;
}

export interface CommuterRailDeparturesQuery {
  stop: string;
  route?: string;
  limit?: number;
}

export interface CommuterRailVehiclesQuery {
  route?: string;
}
