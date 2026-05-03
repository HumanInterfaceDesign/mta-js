export type TransitMode = "subway" | "bus" | "lirr" | "metro-north";

export type Direction = "north" | "south" | "east" | "west" | "unknown";

export interface MTAOptions {
  busTimeKey?: string;
  databaseUrl?: string;
  databaseAuthToken?: string;
  databaseLocalPath?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  staticData?: StaticGtfsSeed;
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

export interface StaticGtfsImportOptions {
  limits?: StaticGtfsImportLimits;
  rehydrate?: boolean;
}

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
  lat?: number;
  lon?: number;
  parentStation?: string;
  mode?: TransitMode;
}

export interface Arrival {
  mode: TransitMode;
  route: Route;
  stop: Stop;
  direction: Direction;
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
  stopId: string;
  route?: string;
  direction?: Direction | "uptown" | "downtown";
  limit?: number;
  includeRaw?: boolean;
}

export interface BusArrivalQuery {
  stopId: string;
  route?: string;
  limit?: number;
  includeRaw?: boolean;
}

export interface BusVehicleQuery {
  route?: string;
  vehicleId?: string;
  limit?: number;
  includeRaw?: boolean;
}

export interface AlertQuery {
  mode?: TransitMode;
  route?: string;
  stopId?: string;
  includeRaw?: boolean;
}

export interface StopsNearQuery {
  lat: number;
  lon: number;
  modes?: TransitMode[];
  radiusMeters?: number;
  limit?: number;
}
