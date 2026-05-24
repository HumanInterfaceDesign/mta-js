#!/usr/bin/env bun
import { MTA } from "../index";
import { defaultStaticGtfsUrls } from "./defaults";
import type { StaticGtfsImportStrategy, TransitMode } from "./types";

const args = Bun.argv.slice(2);

const command = args.slice(0, 2).join(" ");
if (command !== "db push" && command !== "db import") {
  usage();
}

const options = Object.fromEntries(
  args.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "true"];
  }),
);

const databaseUrl =
  options["database-url"] ??
  process.env.MTA_DATABASE_URL ??
  process.env.TURSO_DATABASE_URL ??
  process.env.DATABASE_URL;
const databaseAuthToken =
  options["database-auth-token"] ??
  process.env.MTA_DATABASE_AUTH_TOKEN ??
  process.env.TURSO_AUTH_TOKEN;
const databaseLocalPath = options["database-local-path"] ?? process.env.MTA_DATABASE_LOCAL_PATH;

if (!databaseUrl) {
  console.error("Missing database URL. Pass --database-url or set MTA_DATABASE_URL/TURSO_DATABASE_URL/DATABASE_URL.");
  process.exit(1);
}

const mta = new MTA({
  databaseUrl,
  databaseAuthToken,
  databaseLocalPath,
});

try {
  if (command === "db push") {
    const result = await mta.database.push();
    console.log(`Pushed GTFS schema (${result.statements} statements${result.remote ? ", remote" : ", local"}).`);
  } else {
    const mode = parseMode(options.mode);
    const strategy = parseStrategy(options.strategy);
    const sourceUrl = options["source-url"] ?? defaultSourceUrl(mode);
    if (!sourceUrl) {
      throw new Error(`No default GTFS source URL for mode ${mode}. Pass --source-url.`);
    }

    const summary = await mta.database.importStaticData({
      mode,
      sourceUrl,
      strategy,
    });
    if (!summary) {
      throw new Error("Import completed but no local summary was available. Rehydrate the database and check gtfs_imports.");
    }
    console.log(
      [
        `Imported ${summary.mode} GTFS (${strategy})`,
        `source=${summary.sourceUrl ?? "unknown"}`,
        `stops=${summary.stopCount}`,
        `routes=${summary.routeCount}`,
        `trips=${summary.tripCount}`,
        `stop_times=${summary.stopTimeCount}`,
      ].join(" "),
    );
  }
} finally {
  mta.close();
}

function parseMode(value: string | undefined): TransitMode {
  const mode = (value ?? "subway") as TransitMode;
  if (!["subway", "bus", "lirr", "metro-north"].includes(mode)) {
    throw new Error(`Unsupported mode: ${value}`);
  }
  return mode;
}

function parseStrategy(value: string | undefined): StaticGtfsImportStrategy {
  const strategy = (value ?? "core") as StaticGtfsImportStrategy;
  if (!["core", "schedule"].includes(strategy)) {
    throw new Error(`Unsupported import strategy: ${value}`);
  }
  return strategy;
}

function defaultSourceUrl(mode: TransitMode) {
  if (mode === "subway") return defaultStaticGtfsUrls.subway;
  return undefined;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  mta-js db push --database-url=<url> [--database-auth-token=<token>]",
      "  mta-js db import --mode=subway [--strategy=core|schedule] [--source-url=<url>]",
    ].join("\n"),
  );
  process.exit(1);
}
