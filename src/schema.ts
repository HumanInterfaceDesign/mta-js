export const gtfsSchemaStatements = [
  `create table if not exists stops (
    id text primary key,
    name text not null,
    lat real,
    lon real,
    parent_station text,
    location_type integer,
    mode text
  )`,
  `create table if not exists routes (
    id text primary key,
    short_name text,
    long_name text,
    type integer,
    color text,
    text_color text
  )`,
  `create table if not exists trips (
    id text primary key,
    route_id text not null,
    service_id text,
    headsign text,
    direction_id integer
  )`,
  `create table if not exists stop_times (
    trip_id text not null,
    arrival_time text,
    departure_time text,
    stop_id text not null,
    stop_sequence integer,
    primary key (trip_id, stop_sequence, stop_id)
  )`,
  `create table if not exists gtfs_imports (
    mode text primary key,
    imported_at text not null,
    source_url text,
    stop_count integer not null default 0,
    route_count integer not null default 0,
    trip_count integer not null default 0,
    stop_time_count integer not null default 0
  )`,
  "create index if not exists stops_parent_station_idx on stops(parent_station)",
  "create index if not exists stops_lat_lon_idx on stops(lat, lon)",
  "create index if not exists routes_short_name_idx on routes(short_name)",
  "create index if not exists stop_times_stop_id_idx on stop_times(stop_id)",
] as const;

export function gtfsSchemaSql() {
  return `${gtfsSchemaStatements.join(";\n")};`;
}
