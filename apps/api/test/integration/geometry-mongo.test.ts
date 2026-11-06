import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose, { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  pointInPolygon,
  pointOnBoundary,
  polygonsOverlap,
  validatePolygon,
  createGeographyModule,
} from "../../src/modules/geography/geography.public.js";
import {
  SYNTHETIC_IDS,
  SYNTHETIC_POINTS,
  SYNTHETIC_POLYGONS,
  SYNTHETIC_ACTORS,
} from "./support/geography-fixture.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("geometry_mongo_test")).asPromise();

  await db.collection("zones_geo").createIndex({ polygon: "2dsphere" }, { name: "polygon_2dsphere" });

  const zoneA = validatePolygon(SYNTHETIC_POLYGONS.zoneA);
  const zoneB = validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent);

  await db.collection("zones_geo").insertMany([
    {
      _id: new Types.ObjectId(SYNTHETIC_IDS.zone1),
      name: "Zone A",
      polygon: zoneA,
      isEnabled: true,
    },
    {
      _id: new Types.ObjectId(SYNTHETIC_IDS.zone2),
      name: "Zone B",
      polygon: zoneB,
      isEnabled: true,
    },
  ]);
}, 120000);

afterAll(async () => {
  await db?.close();
  await mongo?.stop();
});

describe("F03-03: Real MongoDB 2dsphere index compatibility and boundary resolution", () => {
  it("Mongo 2dsphere index agrees with pure domain pointInPolygon for interior points", async () => {
    const ptA = SYNTHETIC_POINTS.insideZoneA;
    const queryA = await db
      .collection("zones_geo")
      .find({
        polygon: {
          $geoIntersects: {
            $geometry: { type: "Point", coordinates: [ptA.lng, ptA.lat] },
          },
        },
      })
      .toArray();

    expect(queryA).toHaveLength(1);
    expect(String(queryA[0]!._id)).toBe(SYNTHETIC_IDS.zone1);
    expect(pointInPolygon(ptA, validatePolygon(SYNTHETIC_POLYGONS.zoneA))).toBe(true);
    expect(pointInPolygon(ptA, validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent))).toBe(false);

    const ptB = SYNTHETIC_POINTS.insideZoneB;
    const queryB = await db
      .collection("zones_geo")
      .find({
        polygon: {
          $geoIntersects: {
            $geometry: { type: "Point", coordinates: [ptB.lng, ptB.lat] },
          },
        },
      })
      .toArray();

    expect(queryB).toHaveLength(1);
    expect(String(queryB[0]!._id)).toBe(SYNTHETIC_IDS.zone2);
    expect(pointInPolygon(ptB, validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent))).toBe(true);
    expect(pointInPolygon(ptB, validatePolygon(SYNTHETIC_POLYGONS.zoneA))).toBe(false);
  });

  it("Mongo 2dsphere index agrees for points outside all zones", async () => {
    const ptOutside = SYNTHETIC_POINTS.outsideAll;
    const query = await db
      .collection("zones_geo")
      .find({
        polygon: {
          $geoIntersects: {
            $geometry: { type: "Point", coordinates: [ptOutside.lng, ptOutside.lat] },
          },
        },
      })
      .toArray();

    expect(query).toHaveLength(0);
    expect(pointInPolygon(ptOutside, validatePolygon(SYNTHETIC_POLYGONS.zoneA))).toBe(false);
    expect(pointInPolygon(ptOutside, validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent))).toBe(false);
  });

  it("Mongo 2dsphere index matches both adjacent zones on a shared boundary edge", async () => {
    const ptEdge = SYNTHETIC_POINTS.onSharedEdgeAB;
    const matches = await db
      .collection("zones_geo")
      .find({
        polygon: {
          $geoIntersects: {
            $geometry: { type: "Point", coordinates: [ptEdge.lng, ptEdge.lat] },
          },
        },
      })
      .toArray();

    // Both adjacent zones intersect the shared edge
    expect(matches).toHaveLength(2);
    expect(pointOnBoundary(ptEdge, validatePolygon(SYNTHETIC_POLYGONS.zoneA))).toBe(true);
    expect(pointOnBoundary(ptEdge, validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent))).toBe(true);

    // Deterministic tie-breaking rule: sort by _id ascending so lowest ObjectId string wins stably
    const winningZone = matches.sort((a, b) => String(a._id).localeCompare(String(b._id)))[0]!;
    expect(String(winningZone._id)).toBe(SYNTHETIC_IDS.zone1);
  });

  it("Mongo 2dsphere index matches vertex point", async () => {
    const ptVertex = SYNTHETIC_POINTS.onVertexA;
    const matches = await db
      .collection("zones_geo")
      .find({
        polygon: {
          $geoIntersects: {
            $geometry: { type: "Point", coordinates: [ptVertex.lng, ptVertex.lat] },
          },
        },
      })
      .toArray();

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => String(m._id) === SYNTHETIC_IDS.zone1)).toBe(true);
    expect(pointOnBoundary(ptVertex, validatePolygon(SYNTHETIC_POLYGONS.zoneA))).toBe(true);
  });

  it("confirms pure domain polygonsOverlap allows shared boundary without positive area", () => {
    const polyA = validatePolygon(SYNTHETIC_POLYGONS.zoneA);
    const polyB = validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent);
    expect(polygonsOverlap(polyA, polyB)).toBe(false);
  });
  it("rejects spherical overlap that a planar check misses, matching the indexed resolver", async () => {
    const rectangle = (x0: number, x1: number, y0: number, y1: number) => validatePolygon({ type: "Polygon", coordinates: [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]] });
    const a = rectangle(0, 10, 40, 50), b = rectangle(4, 6, 50.05, 51);
    await db.collection("spherical_probe").createIndex({ polygon: "2dsphere" });
    await db.collection("spherical_probe").insertMany([{ polygon: a }, { polygon: b }]);
    const matches = await db.collection("spherical_probe").find({ polygon: { $geoIntersects: { $geometry: { type: "Point", coordinates: [5, 50.07] } } } }).toArray();
    expect(matches).toHaveLength(2);
    expect(pointInPolygon({ lng: 5, lat: 50.07 }, a)).toBe(true);
    expect(polygonsOverlap(a, b)).toBe(true);
    expect(polygonsOverlap(b, a)).toBe(true);
    const geography = createGeographyModule({ connection: db });
    await geography.ensureIndexes();
    const actor = SYNTHETIC_ACTORS.zoneManager;
    const requestId = "00000000-0000-4000-8000-000000000001";
    const city = await geography.cityService.createCity({ name: "Spherical city", state: "Test" }, actor, requestId);
    await geography.zoneService.createZone({ cityId: city.id, name: "Spherical A", polygon: a }, actor, requestId);
    await expect(geography.zoneService.createZone({ cityId: city.id, name: "Spherical B", polygon: b }, actor, requestId))
      .rejects.toMatchObject({ status: 409, code: "ZONE_OVERLAP" });
    const draft = await geography.zoneService.createZone({ cityId: city.id, name: "Draft B", polygon: b, isEnabled: false }, actor, requestId);
    await expect(geography.zoneService.updateZone(draft.id, { isEnabled: true }, actor, requestId))
      .rejects.toMatchObject({ status: 409, code: "ZONE_OVERLAP" });
  });

});
