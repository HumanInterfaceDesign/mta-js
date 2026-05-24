export class MTAError extends Error {
  override name = "MTAError";
}

export class MissingBusTimeKeyError extends MTAError {
  override name = "MissingBusTimeKeyError";

  constructor() {
    super("MTA BusTime API calls require a busTimeKey.");
  }
}

export class UnknownRouteError extends MTAError {
  override name = "UnknownRouteError";

  constructor(route: string) {
    super(`Unknown MTA route: ${route}`);
  }
}

export class UnknownStopError extends MTAError {
  override name = "UnknownStopError";

  constructor(stopId: string) {
    super(`Unknown MTA stop: ${stopId}`);
  }
}

export class StaticDataMissingError extends MTAError {
  override name = "StaticDataMissingError";

  constructor(mode: string) {
    super(`Static GTFS data for ${mode} is missing. Run mta.database.importStaticData or the db import CLI before using this lookup.`);
  }
}

export class FeedError extends MTAError {
  override name = "FeedError";

  constructor(message: string, readonly response?: Response) {
    super(message);
  }
}
