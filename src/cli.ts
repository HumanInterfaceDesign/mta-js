#!/usr/bin/env bun
import { MTA } from "../index";

const args = Bun.argv.slice(2);

if (args[0] !== "db" || args[1] !== "push") {
  console.error("Usage: mta-js db push --database-url=<url> [--database-auth-token=<token>]");
  process.exit(1);
}

const options = Object.fromEntries(
  args.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")];
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
  const result = await mta.database.push();
  console.log(
    `Pushed GTFS schema (${result.statements} statements${result.remote ? ", remote" : ", local"}).`,
  );
} finally {
  mta.close();
}
