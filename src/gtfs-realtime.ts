import protobuf from "protobufjs";

const proto = `
syntax = "proto2";
package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}

message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional Incrementality incrementality = 2 [default = FULL_DATASET];
  optional uint64 timestamp = 3;

  enum Incrementality {
    FULL_DATASET = 0;
    DIFFERENTIAL = 1;
  }
}

message FeedEntity {
  required string id = 1;
  optional bool is_deleted = 2 [default = false];
  optional TripUpdate trip_update = 3;
  optional VehiclePosition vehicle = 4;
  optional Alert alert = 5;
}

message TripUpdate {
  optional TripDescriptor trip = 1;
  optional VehicleDescriptor vehicle = 3;
  repeated StopTimeUpdate stop_time_update = 2;
  optional uint64 timestamp = 4;
  optional int32 delay = 5;
}

message StopTimeEvent {
  optional int32 delay = 1;
  optional int64 time = 2;
  optional int32 uncertainty = 3;
}

message StopTimeUpdate {
  optional uint32 stop_sequence = 1;
  optional string stop_id = 4;
  optional StopTimeEvent arrival = 2;
  optional StopTimeEvent departure = 3;
  optional ScheduleRelationship schedule_relationship = 5 [default = SCHEDULED];

  enum ScheduleRelationship {
    SCHEDULED = 0;
    SKIPPED = 1;
    NO_DATA = 2;
    UNSCHEDULED = 3;
  }
}

message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional VehicleDescriptor vehicle = 8;
  optional Position position = 2;
  optional uint32 current_stop_sequence = 3;
  optional string stop_id = 7;
  optional VehicleStopStatus current_status = 4 [default = IN_TRANSIT_TO];
  optional uint64 timestamp = 5;
}

message Alert {
  repeated TimeRange active_period = 1;
  repeated EntitySelector informed_entity = 5;
  optional Cause cause = 6 [default = UNKNOWN_CAUSE];
  optional Effect effect = 7 [default = UNKNOWN_EFFECT];
  optional TranslatedString url = 8;
  optional TranslatedString header_text = 10;
  optional TranslatedString description_text = 11;

  enum Cause {
    UNKNOWN_CAUSE = 1;
    OTHER_CAUSE = 2;
    TECHNICAL_PROBLEM = 3;
    STRIKE = 4;
    DEMONSTRATION = 5;
    ACCIDENT = 6;
    HOLIDAY = 7;
    WEATHER = 8;
    MAINTENANCE = 9;
    CONSTRUCTION = 10;
    POLICE_ACTIVITY = 11;
    MEDICAL_EMERGENCY = 12;
  }

  enum Effect {
    NO_SERVICE = 1;
    REDUCED_SERVICE = 2;
    SIGNIFICANT_DELAYS = 3;
    DETOUR = 4;
    ADDITIONAL_SERVICE = 5;
    MODIFIED_SERVICE = 6;
    OTHER_EFFECT = 7;
    UNKNOWN_EFFECT = 8;
    STOP_MOVED = 9;
    NO_EFFECT = 10;
    ACCESSIBILITY_ISSUE = 11;
  }
}

message TimeRange {
  optional uint64 start = 1;
  optional uint64 end = 2;
}

message Position {
  required float latitude = 1;
  required float longitude = 2;
  optional float bearing = 3;
  optional double odometer = 4;
  optional float speed = 5;
}

message TripDescriptor {
  optional string trip_id = 1;
  optional string route_id = 5;
  optional uint32 direction_id = 6;
  optional string start_time = 2;
  optional string start_date = 3;
  optional ScheduleRelationship schedule_relationship = 4;

  enum ScheduleRelationship {
    SCHEDULED = 0;
    ADDED = 1;
    UNSCHEDULED = 2;
    CANCELED = 3;
    REPLACEMENT = 5;
    DUPLICATED = 6;
    DELETED = 7;
  }
}

message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
  optional string license_plate = 3;
}

message EntitySelector {
  optional string agency_id = 1;
  optional string route_id = 2;
  optional int32 route_type = 3;
  optional TripDescriptor trip = 4;
  optional string stop_id = 5;
}

message TranslatedString {
  repeated Translation translation = 1;

  message Translation {
    required string text = 1;
    optional string language = 2;
  }
}

enum VehicleStopStatus {
  INCOMING_AT = 0;
  STOPPED_AT = 1;
  IN_TRANSIT_TO = 2;
}
`;

const root = protobuf.parse(proto).root;
const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

export function decodeFeedMessage(bytes: ArrayBuffer | Uint8Array) {
  const decoded = FeedMessage.decode(new Uint8Array(bytes));
  return FeedMessage.toObject(decoded, {
    longs: Number,
    enums: String,
    defaults: false,
    arrays: true,
  }) as GtfsRealtimeFeed;
}

export function encodeFeedMessage(feed: GtfsRealtimeFeed) {
  const message = FeedMessage.fromObject(feed);
  return FeedMessage.encode(message).finish();
}

export interface GtfsRealtimeFeed {
  header?: {
    gtfsRealtimeVersion?: string;
    incrementality?: string;
    timestamp?: number;
  };
  entity: GtfsRealtimeEntity[];
}

export interface GtfsRealtimeEntity {
  id: string;
  isDeleted?: boolean;
  tripUpdate?: {
    trip?: {
      tripId?: string;
      routeId?: string;
      directionId?: number;
      startTime?: string;
      startDate?: string;
      scheduleRelationship?: string;
    };
    vehicle?: {
      id?: string;
      label?: string;
      licensePlate?: string;
    };
    stopTimeUpdate: {
      stopSequence?: number;
      stopId?: string;
      arrival?: { delay?: number; time?: number; uncertainty?: number };
      departure?: { delay?: number; time?: number; uncertainty?: number };
      scheduleRelationship?: string;
    }[];
    timestamp?: number;
    delay?: number;
  };
  vehicle?: unknown;
  alert?: {
    activePeriod: { start?: number; end?: number }[];
    informedEntity: {
      agencyId?: string;
      routeId?: string;
      routeType?: number;
      stopId?: string;
      trip?: { tripId?: string; routeId?: string };
    }[];
    cause?: string;
    effect?: string;
    url?: TranslatedString;
    headerText?: TranslatedString;
    descriptionText?: TranslatedString;
  };
}

export interface TranslatedString {
  translation: { text: string; language?: string }[];
}
