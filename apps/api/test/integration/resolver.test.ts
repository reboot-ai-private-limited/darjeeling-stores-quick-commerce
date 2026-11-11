import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createGeographyModule } from "../../src/modules/geography/geography.public.js";
import {
  createSyntheticStaffActor,
  SYNTHETIC_ACTORS,
  SYNTHETIC_POINTS,
  SYNTHETIC_POLYGONS,
} from "./support/geography-fixture.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let geoModule: ReturnType<typeof createGeographyModule>;

let city1Id: string;
let city2Id: string;
let zoneAId: string;
let zoneBId: string;
let zonePausedId: string;
let zoneDisabledId: string;
let localityLinkedId: string;
let localityUnlinkedId: string;
let localityDisabledZoneId: string;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("resolver_test")).asPromise();

  geoModule = createGeographyModule({
    connection: db,
    resolveActor: (req) => {
      const actorKey = req.get("X-Test-Actor");
      if (!actorKey) return null;
      if (actorKey === "zoneManager") return SYNTHETIC_ACTORS.zoneManager;
      if (actorKey === "opsManager") return SYNTHETIC_ACTORS.opsManager;
      if (actorKey === "scopedStaff")
        return createSyntheticStaffActor(["zones:manage"], {
          all: false,
          warehouseIds: ["672b123456789abcdef01401"],
        });
      return null;
    },
    validateCsrf: (req) => req.get("X-CSRF-Token") === "1",
  });

  await geoModule.ensureIndexes();
  app = createApp({ additionalRoutes: geoModule.routes });
}, 120000);

afterAll(async () => {
  await db?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  await db.collection("cities").deleteMany({});
  await db.collection("zones").deleteMany({});
  await db.collection("localities").deleteMany({});
  await db.collection("geography_versions").deleteMany({});

  // Seed City 1 (Active) and City 2 (Active)
  const c1 = await geoModule.cityService.createCity(
    { name: "Darjeeling", state: "West Bengal" },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000001"
  );
  const c2 = await geoModule.cityService.createCity(
    { name: "Kalimpong", state: "West Bengal" },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000002"
  );
  city1Id = c1.id;
  city2Id = c2.id;

  // Seed Zone A and adjacent Zone B (sharing edge lng=88.275)
  const zA = await geoModule.zoneService.createZone(
    {
      cityId: city1Id,
      name: "Zone A Chowrasta",
      polygon: SYNTHETIC_POLYGONS.zoneA,
      isEnabled: true,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000003"
  );
  const zB = await geoModule.zoneService.createZone(
    {
      cityId: city1Id,
      name: "Zone B Adjacent",
      polygon: SYNTHETIC_POLYGONS.zoneBAdjacent,
      isEnabled: true,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000004"
  );
  zoneAId = zA.id;
  zoneBId = zB.id;

  // Seed a disjoint paused zone
  const zPaused = await geoModule.zoneService.createZone(
    {
      cityId: city1Id,
      name: "Zone Paused",
      polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
      isEnabled: true,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000005"
  );
  await geoModule.zoneService.updateZone(
    zPaused.id,
    {
      pause: {
        active: true,
        message: "Severe Landslide",
        until: "2099-01-01T00:00:00.000Z",
      },
    },
    SYNTHETIC_ACTORS.opsManager,
    "00000000-0000-4000-8000-000000000006"
  );
  zonePausedId = zPaused.id;

  // Seed a disabled zone
  const zDisabled = await geoModule.zoneService.createZone(
    {
      cityId: city1Id,
      name: "Zone Disabled",
      polygon: {
        type: "Polygon",
        coordinates: [
          [
            [88.350, 27.035],
            [88.365, 27.035],
            [88.365, 27.050],
            [88.350, 27.050],
            [88.350, 27.035],
          ],
        ],
      },
      isEnabled: false,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000007"
  );
  zoneDisabledId = zDisabled.id;

  // Seed localities
  // 1. Linked to Zone A
  const locLinked = await geoModule.localityService.createLocality(
    {
      cityId: city1Id,
      name: "Chowrasta Mall",
      location: { lat: 27.0412, lng: 88.2630 },
      zoneId: zoneAId,
      travelMinutes: 8,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000008"
  );
  localityLinkedId = locLinked.id;

  // 2. Unlinked locality located inside Zone A
  const locUnlinked = await geoModule.localityService.createLocality(
    {
      cityId: city1Id,
      name: "Birch Hill Park",
      location: SYNTHETIC_POINTS.insideZoneA,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000009"
  );
  localityUnlinkedId = locUnlinked.id;

  // 3. Locality explicitly linked to disabled zone
  const locDisabledZone = await geoModule.localityService.createLocality(
    {
      cityId: city1Id,
      name: "Disabled Zone Area",
      location: { lat: 27.042, lng: 88.355 },
      zoneId: zoneDisabledId,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000010"
  );
  localityDisabledZoneId = locDisabledZone.id;
});

describe("F03-07: Point and locality resolution, and zones/check alias", () => {
  for (const endpoint of ["/api/v1/location/resolve", "/api/v1/zones/check"]) {
    describe(`Endpoint: ${endpoint}`, () => {
      it("resolves deliverable point inside an enabled zone", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ lat: SYNTHETIC_POINTS.insideZoneA.lat, lng: SYNTHETIC_POINTS.insideZoneA.lng });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: true,
          zone: {
            id: zoneAId,
            name: "Zone A Chowrasta",
            cityId: city1Id,
          },
        });
      });

      it("resolves undeliverable for point outside all enabled zones", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ lat: SYNTHETIC_POINTS.outsideAll.lat, lng: SYNTHETIC_POINTS.outsideAll.lng });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: false,
        });
      });

      it("returns deliverable: false with paused: true for point in paused zone", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ lat: 27.042, lng: 88.305 }); // inside zoneCDisjoint

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: false,
          paused: true,
          zone: {
            id: zonePausedId,
            name: "Zone Paused",
            cityId: city1Id,
          },
        });
      });

      it("evaluates expired pause as active: false and deliverable: true", async () => {
        // Set pause with expiry in the past
        await geoModule.zoneService.updateZone(
          zonePausedId,
          {
            pause: {
              active: true,
              message: "Past event",
              until: "2020-01-01T00:00:00.000Z",
            },
          },
          SYNTHETIC_ACTORS.opsManager,
          "00000000-0000-4000-8000-000000000011"
        );

        const res = await request(app)
          .post(endpoint)
          .send({ lat: 27.042, lng: 88.305 });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: true,
          zone: {
            id: zonePausedId,
            name: "Zone Paused",
            cityId: city1Id,
          },
        });
      });

      it("returns deliverable: false for point in disabled zone", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ lat: 27.042, lng: 88.355 }); // inside disabled zone

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: false,
        });
      });

      it("returns deliverable: false when parent city is inactive", async () => {
        // Mark City 1 inactive
        await geoModule.cityService.updateCity(
          city1Id,
          { isActive: false },
          SYNTHETIC_ACTORS.zoneManager,
          "00000000-0000-4000-8000-000000000012"
        );

        const res = await request(app)
          .post(endpoint)
          .send({ lat: SYNTHETIC_POINTS.insideZoneA.lat, lng: SYNTHETIC_POINTS.insideZoneA.lng });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: false,
        });
      });

      it("stably resolves border points between adjacent zones to lowest hexadecimal zone ID", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({
            lat: SYNTHETIC_POINTS.onSharedEdgeAB.lat,
            lng: SYNTHETIC_POINTS.onSharedEdgeAB.lng,
          });

        expect(res.status).toBe(200);
        expect(res.body.data.deliverable).toBe(true);

        const expectedWinner = [zoneAId, zoneBId].sort((a, b) => a.localeCompare(b))[0];
        expect(res.body.data.zone.id).toBe(expectedWinner);
      });

      it("resolves locality explicitly linked to an enabled zone", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ localityId: localityLinkedId });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: true,
          zone: {
            id: zoneAId,
            name: "Zone A Chowrasta",
            cityId: city1Id,
          },
        });
      });

      it("resolves locality explicitly linked to a disabled zone as undeliverable without falling back to point", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ localityId: localityDisabledZoneId });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: false,
        });
      });

      it("resolves unlinked locality using its stored Point coordinates", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ localityId: localityUnlinkedId });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          deliverable: true,
          zone: {
            id: zoneAId,
            name: "Zone A Chowrasta",
            cityId: city1Id,
          },
        });
      });

      it("returns 404 for unknown or malformed localityId", async () => {
        expect(
          (await request(app).post(endpoint).send({ localityId: "non-hex-id" })).status
        ).toBe(404);

        expect(
          (
            await request(app)
              .post(endpoint)
              .send({ localityId: "672b123456789abcdef01999" })
          ).status
        ).toBe(404);
      });

      it("returns 404 for inactive locality or locality with inactive city", async () => {
        // Mark locality inactive
        await geoModule.localityService.updateLocality(
          localityLinkedId,
          { isActive: false },
          SYNTHETIC_ACTORS.zoneManager,
          "00000000-0000-4000-8000-000000000013"
        );

        expect(
          (await request(app).post(endpoint).send({ localityId: localityLinkedId })).status
        ).toBe(404);

        // Locality in inactive city
        await geoModule.localityService.updateLocality(
          localityUnlinkedId,
          { isActive: true },
          SYNTHETIC_ACTORS.zoneManager,
          "00000000-0000-4000-8000-000000000014"
        );
        await geoModule.cityService.updateCity(
          city1Id,
          { isActive: false },
          SYNTHETIC_ACTORS.zoneManager,
          "00000000-0000-4000-8000-000000000015"
        );

        expect(
          (await request(app).post(endpoint).send({ localityId: localityUnlinkedId })).status
        ).toBe(404);
      });

      it("enforces validation errors for coordinates XOR localityId", async () => {
        // Supplying both coordinates and localityId
        const both = await request(app)
          .post(endpoint)
          .send({
            lat: 27.04,
            lng: 88.26,
            localityId: localityLinkedId,
          });
        expect(both.status).toBe(400);
        expect(both.body.error.code).toBe("VALIDATION_ERROR");

        // Supplying neither
        const neither = await request(app).post(endpoint).send({});
        expect(neither.status).toBe(400);
        expect(neither.body.error.code).toBe("VALIDATION_ERROR");

        // Supplying only lat without lng
        const onlyLat = await request(app).post(endpoint).send({ lat: 27.04 });
        expect(onlyLat.status).toBe(400);

        // Coordinates out of bounds
        const oob = await request(app)
          .post(endpoint)
          .send({ lat: 95.0, lng: 88.26 });
        expect(oob.status).toBe(400);
      });

      it("does not leak internal warehouse data or flags in response", async () => {
        const res = await request(app)
          .post(endpoint)
          .send({ lat: SYNTHETIC_POINTS.insideZoneA.lat, lng: SYNTHETIC_POINTS.insideZoneA.lng });

        expect(res.status).toBe(200);
        const data = res.body.data;
        expect(Object.keys(data).sort()).toEqual(["deliverable", "zone"]);
        expect(Object.keys(data.zone).sort()).toEqual(["cityId", "id", "name"]);
      });
    });
  }
});
