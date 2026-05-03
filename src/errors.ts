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

export class FeedError extends MTAError {
  override name = "FeedError";

  constructor(message: string, readonly response?: Response) {
    super(message);
  }
}
