import { MTA } from "../index";

const mta = new MTA({
  databaseUrl: process.env.TURSO_DATABASE_URL,
  databaseAuthToken: process.env.TURSO_AUTH_TOKEN,
  databaseLocalPath: "/tmp/mta.sqlite",
  busTimeKey: process.env.MTA_BUS_KEY,
});

export async function GET() {
  await mta.ready();

  const [database, lTrainArrivals, m23Vehicles] = await Promise.all([
    mta.database.status(),
    mta.subway.arrivals({ stopId: "L06", route: "L", limit: 5 }),
    mta.bus.vehicles({ route: "M23", limit: 5 }),
  ]);

  return Response.json({
    database,
    examples: {
      lTrainArrivals,
      m23Vehicles,
    },
  });
}
