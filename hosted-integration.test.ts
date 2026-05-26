import { describe, expect, test } from "bun:test";
import { MTA } from "./index";

const apiKey = process.env.MTA_API_KEY;

describe.skipIf(!apiKey)("hosted integration tests", () => {
  test("runs the docs quickstart against the hosted API", async () => {
    const mta = new MTA({
      apiKey,
    });

    const arrivals = await mta.subway.arrivals({
      stopId: "A27",
      route: "A",
    });

    const stops = await mta.stops.near({
      lat: 40.7356,
      lon: -73.9804,
      modes: ["subway", "bus"],
      route: "M23",
      limit: 10,
    });

    const vehicles = await mta.bus.vehicles({
      route: "M23",
      limit: 5,
    });

    expect(Array.isArray(arrivals)).toBe(true);
    expect(Array.isArray(stops)).toBe(true);
    expect(Array.isArray(vehicles)).toBe(true);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((stop) => stop.routeMatch)).toBe(true);
  }, 30_000);
});
