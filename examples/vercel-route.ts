import { MTA } from "mta-js";

const mta = new MTA({
  apiKey: process.env.MTA_API_KEY,
});

export async function GET() {
  const [lTrainArrivals, m23Stops] = await Promise.all([
    mta.subway.arrivals({ stopId: "L08", route: "L", limit: 3 }),
    mta.stops.near({
      lat: 40.7356,
      lon: -73.9804,
      modes: ["bus"],
      route: "M23",
      includeRoutes: true,
      limit: 3,
    }),
  ]);

  return Response.json({ lTrainArrivals, m23Stops });
}
