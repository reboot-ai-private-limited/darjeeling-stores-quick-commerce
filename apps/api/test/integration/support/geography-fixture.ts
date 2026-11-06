import type { AccessActor } from "../../../src/modules/access/access.public.js";

/** Synthetic 24-character hexadecimal MongoDB ObjectIds for isolated testing. */
export const SYNTHETIC_IDS = {
  city1: "672b123456789abcdef01101",
  city2: "672b123456789abcdef01102",
  zone1: "672b123456789abcdef01201",
  zone2: "672b123456789abcdef01202",
  zone3: "672b123456789abcdef01203",
  locality1: "672b123456789abcdef01301",
  locality2: "672b123456789abcdef01302",
  warehouse1: "672b123456789abcdef01401",
  warehouse2: "672b123456789abcdef01402",
  warehouse3: "672b123456789abcdef01403",
  userAdmin: "672b123456789abcdef01001",
  userStaff: "672b123456789abcdef01002",
} as const;

/** Synthetic Staff Access Actors with strictly isolated permissions and scopes. */
export function createSyntheticStaffActor(
  permissions: readonly string[],
  scope: { all: boolean; warehouseIds: readonly string[] } = { all: true, warehouseIds: [] },
  userId = SYNTHETIC_IDS.userStaff,
  roleName = "admin"
) {
  return {
    id: userId,
    roleName,
    kind: "staff" as const,
    permissions,
    scope,
  };
}

export const SYNTHETIC_ACTORS = {
  superAdmin: createSyntheticStaffActor(["*"], { all: true, warehouseIds: [] }, SYNTHETIC_IDS.userAdmin),
  zoneManager: createSyntheticStaffActor(["zones:manage"], { all: true, warehouseIds: [] }),
  warehouseViewerAll: createSyntheticStaffActor(["warehouses:view"], { all: true, warehouseIds: [] }),
  warehouseViewerScoped: (warehouseId: string) =>
    createSyntheticStaffActor(["warehouses:view"], { all: false, warehouseIds: [warehouseId] }),
  warehouseManagerAll: createSyntheticStaffActor(["warehouses:manage"], { all: true, warehouseIds: [] }),
  warehouseManagerScoped: (warehouseId: string) =>
    createSyntheticStaffActor(["warehouses:manage"], { all: false, warehouseIds: [warehouseId] }),
  opsManager: createSyntheticStaffActor(["zones:manage", "warehouses:manage", "ops_mode:manage"], { all: true, warehouseIds: [] }),
  unauthorizedStaff: createSyntheticStaffActor(["catalog:view"], { all: true, warehouseIds: [] }),
};

/** GeoJSON Polygon with single closed outer ring: [lng, lat] */
export type GeoPolygon = {
  type: "Polygon";
  coordinates: [number, number][][];
};

/**
 * Synthetic Polygons for geography and overlap testing.
 * Uses GeoJSON standard coordinates [lng, lat].
 */
export const SYNTHETIC_POLYGONS = {
  /** Zone A (Chowrasta rectangle: lng [88.260, 88.275], lat [27.035, 27.050]) */
  zoneA: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 27.035],
        [88.275, 27.035],
        [88.275, 27.050],
        [88.260, 27.050],
        [88.260, 27.035],
      ],
    ],
  },
  /** Zone B (adjacent rectangle sharing the edge lng=88.275 between lat 27.035 and 27.050) */
  zoneBAdjacent: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.275, 27.035],
        [88.290, 27.035],
        [88.290, 27.050],
        [88.275, 27.050],
        [88.275, 27.035],
      ],
    ],
  },
  /** Zone C (disjoint rectangle completely separated from A and B) */
  zoneCDisjoint: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.300, 27.035],
        [88.315, 27.035],
        [88.315, 27.050],
        [88.300, 27.050],
        [88.300, 27.035],
      ],
    ],
  },
  /** Positive-area overlap with Zone A (lng [88.270, 88.285], lat [27.040, 27.055]) */
  overlappingA: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.270, 27.040],
        [88.285, 27.040],
        [88.285, 27.055],
        [88.270, 27.055],
        [88.270, 27.040],
      ],
    ],
  },
  /** Strict subset / containment inside Zone A */
  containedInA: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.265, 27.038],
        [88.272, 27.038],
        [88.272, 27.045],
        [88.265, 27.045],
        [88.265, 27.038],
      ],
    ],
  },
  /** Exact duplicate of Zone A */
  identicalToA: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 27.035],
        [88.275, 27.035],
        [88.275, 27.050],
        [88.260, 27.050],
        [88.260, 27.035],
      ],
    ],
  },
  /** Invalid: Self-intersecting bow-tie */
  selfIntersecting: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 27.035],
        [88.275, 27.050],
        [88.275, 27.035],
        [88.260, 27.050],
        [88.260, 27.035],
      ],
    ],
  },
  /** Invalid: First and last coordinates do not match */
  unclosed: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 27.035],
        [88.275, 27.035],
        [88.275, 27.050],
        [88.260, 27.050],
      ],
    ],
  },
  /** Invalid: Fewer than 4 coordinate pairs (less than 3 distinct vertices + closing) */
  tooFewCoordinates: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 27.035],
        [88.275, 27.035],
        [88.260, 27.035],
      ],
    ],
  },
  /** Invalid: Collinear / zero area */
  zeroAreaCollinear: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 27.035],
        [88.270, 27.035],
        [88.280, 27.035],
        [88.260, 27.035],
      ],
    ],
  },
  /** Invalid: Coordinate out of bounds (lat > 85 or lng > 180) */
  outOfBoundsLat: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 86.0],
        [88.275, 86.0],
        [88.275, 87.0],
        [88.260, 87.0],
        [88.260, 86.0],
      ],
    ],
  },
  /** Invalid: Multiple rings (holes not supported) */
  withHole: {
    type: "Polygon" as const,
    coordinates: [
      [
        [88.260, 27.035],
        [88.275, 27.035],
        [88.275, 27.050],
        [88.260, 27.050],
        [88.260, 27.035],
      ],
      [
        [88.265, 27.040],
        [88.270, 27.040],
        [88.270, 27.045],
        [88.265, 27.045],
        [88.265, 27.040],
      ],
    ],
  },
};

/** Synthetic test coordinates { lat, lng } */
export const SYNTHETIC_POINTS = {
  /** Strictly inside Zone A */
  insideZoneA: { lat: 27.042, lng: 88.268 },
  /** Strictly inside Zone B */
  insideZoneB: { lat: 27.042, lng: 88.282 },
  /** Exactly on the shared edge between Zone A and Zone B (lng=88.275) */
  onSharedEdgeAB: { lat: 27.042, lng: 88.275 },
  /** On a vertex of Zone A */
  onVertexA: { lat: 27.035, lng: 88.260 },
  /** Strictly outside all zones */
  outsideAll: { lat: 27.100, lng: 88.350 },
};

/** Synthetic Cities */
export const SYNTHETIC_CITIES = {
  city1: {
    name: "Darjeeling",
    state: "West Bengal",
  },
  city2: {
    name: "Kalimpong",
    state: "West Bengal",
  },
};

/** Synthetic Localities */
export const SYNTHETIC_LOCALITIES = {
  loc1: {
    name: "Chowrasta",
    location: { lat: 27.0412, lng: 88.2630 },
    travelMinutes: 8,
    sortOrder: 1,
  },
  loc2: {
    name: "Ghoom",
    location: { lat: 27.0125, lng: 88.2575 },
    travelMinutes: 12,
    sortOrder: 2,
  },
};

/** Synthetic Warehouses */
export const SYNTHETIC_WAREHOUSES = {
  wh1: {
    name: "Chowrasta Store",
    code: "CHOW-1",
    location: { lat: 27.0410, lng: 88.2663 },
    address: "Mall Road, Darjeeling",
    priority: 1,
    packMinutes: 5,
    riderArrivalMinutes: 5,
    defaultTravelMinutes: 10,
    punchInRadiusMeters: 150,
  },
  wh2: {
    name: "Ghoom Depot",
    code: "GHOOM-1",
    location: { lat: 27.0120, lng: 88.2570 },
    address: "Hill Cart Road, Ghoom",
    priority: 2,
    packMinutes: 5,
    riderArrivalMinutes: 5,
    defaultTravelMinutes: 15,
    punchInRadiusMeters: 150,
  },
};
