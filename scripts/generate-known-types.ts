import { parse } from "csv-parse/sync"
import { unzipSync } from "fflate"

const defaultBusGtfsUrls = [
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip",
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_bx.zip",
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip",
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_q.zip",
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_si.zip",
]

const snapshotUrl =
  process.env.MTA_STOPS_SNAPSHOT_URL ??
  process.env.NEXT_PUBLIC_MTA_STOPS_SNAPSHOT_URL

if (!snapshotUrl) {
  throw new Error(
    "MTA_STOPS_SNAPSHOT_URL or NEXT_PUBLIC_MTA_STOPS_SNAPSHOT_URL is required to generate known MTA types.",
  )
}
const busGtfsUrls = (
  process.env.MTA_BUS_GTFS_URLS ??
  process.env.MTA_BUS_GTFS_URL ??
  defaultBusGtfsUrls.join(",")
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)

type SnapshotStop = {
  id: string
  mode?: string
}

type SnapshotRoute = {
  id?: string
  shortName?: string
  type?: number
}

type Snapshot = {
  generatedAt?: string
  stops?: SnapshotStop[]
  stopRoutes?: Record<string, SnapshotRoute[]>
  indexes?: {
    routesToStops?: Record<string, string[]>
  }
}

type GtfsRoute = {
  route_id: string
  route_short_name?: string
  route_long_name?: string
  route_type?: string
  route_color?: string
  route_text_color?: string
}

const snapshot = (await fetch(snapshotUrl).then((response) => {
  if (!response.ok) {
    throw new Error(`Unable to fetch stops snapshot: ${response.status} ${response.statusText}`)
  }
  return response.json()
})) as Snapshot

const stops = snapshot.stops ?? []
const routeEntries = Object.entries(snapshot.indexes?.routesToStops ?? {})
const routeMetadata = new Map<string, SnapshotRoute>()
const routeTypes = new Map<string, number>()

for (const route of await loadBusGtfsRoutes(busGtfsUrls)) {
  for (const id of [route.id, route.shortName]) {
    if (!id) continue
    routeMetadata.set(id, route)
    routeTypes.set(id, 3)
  }
}

for (const routes of Object.values(snapshot.stopRoutes ?? {})) {
  for (const route of routes) {
    for (const id of [route.id, route.shortName]) {
      if (!id) continue
      routeMetadata.set(id, route)
      if (route.type !== undefined) routeTypes.set(id, route.type)
    }
  }
}

function aliasesForRoute(routeId: string) {
  const route = routeMetadata.get(routeId)
  const aliases = new Set([routeId, route?.id, route?.shortName].filter((id): id is string => Boolean(id)))

  for (const id of [...aliases]) {
    if (id.endsWith("-SBS")) aliases.add(id.replace(/-SBS$/, ""))
    if (id.endsWith("+")) aliases.add(id.replace(/\+$/, ""))
  }

  return [...aliases]
}

function routeType(routeId: string) {
  return (
    routeTypes.get(routeId) ??
    routeTypes.get(`${routeId}-SBS`) ??
    routeTypes.get(`${routeId}+`) ??
    routeMetadata.get(routeId)?.type
  )
}

function looksLikeSubwayRoute(routeId: string) {
  if (routeType(routeId) !== undefined) return false
  return /^[A-Z0-9]{1,2}$/.test(routeId)
}

const subwayRouteAliases = new Set(["SI", "SIR"])

const routeIds = [
  ...new Set([
    ...routeEntries.flatMap(([routeId]) => aliasesForRoute(routeId)),
    ...[...routeMetadata.keys()].flatMap((routeId) => aliasesForRoute(routeId)),
  ]),
]
const subwayRoutes = routeIds.filter(
  (routeId) =>
    routeType(routeId) === 1 ||
    looksLikeSubwayRoute(routeId) ||
    subwayRouteAliases.has(routeId),
)
const busRoutes = routeIds.filter((routeId) => routeType(routeId) === 3)
const stopIds = stops.map((stop) => stop.id)
const subwayStopIds = stops.filter((stop) => stop.mode === "subway").map((stop) => stop.id)
const busStopIds = stops.filter((stop) => stop.mode === "bus").map((stop) => stop.id)

async function loadBusGtfsRoutes(urls: string[]) {
  const routes: SnapshotRoute[] = []

  await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Unable to fetch bus GTFS routes from ${url}: ${response.status} ${response.statusText}`)
      }

      const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
      const rows = parseGtfsFile<GtfsRoute>(files, "routes.txt")

      routes.push(
        ...rows.map((route) => ({
          id: route.route_id,
          shortName: route.route_short_name || route.route_id,
          longName: route.route_long_name || undefined,
          type: Number(route.route_type || 3),
          color: route.route_color || undefined,
          textColor: route.route_text_color || undefined,
        })),
      )
    }),
  )

  return routes
}

function parseGtfsFile<T>(files: Record<string, Uint8Array>, name: string) {
  const bytes = files[name]
  if (!bytes) return []

  return parse(new TextDecoder().decode(bytes), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as T[]
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
}

function union(name: string, values: string[]) {
  const sorted = uniqueSorted(values)
  if (!sorted.length) return `export type ${name} = never;\n`

  return [
    `export type ${name} =`,
    ...sorted.map((value, index) => `  ${index === 0 ? "" : "| "}${JSON.stringify(value)}`),
  ].join("\n") + "\n"
}

const generated = `// Generated by scripts/generate-known-types.ts from the hosted stops snapshot.\n// Snapshot generated at: ${snapshot.generatedAt ?? "unknown"}\n// Do not edit by hand.\n\n${union("KnownRoute", routeIds)}\n${union("KnownSubwayRoute", subwayRoutes)}\n${union("KnownBusRoute", busRoutes)}\n${union("KnownStopId", stopIds)}\n${union("KnownSubwayStopId", subwayStopIds)}\n${union("KnownBusStopId", busStopIds)}`

await Bun.write(new URL("../src/generated.ts", import.meta.url), generated)
console.log(
  `Generated src/generated.ts with ${uniqueSorted(routeIds).length} routes and ${uniqueSorted(stopIds).length} stops.`,
)
