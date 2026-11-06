import { Types, type ClientSession, type Connection } from "mongoose";
import type { ZoneStore } from "../application/ports.js";
import { conflict } from "../domain/errors.js";
import type { GeoPolygon } from "../domain/geometry.js";
import type { Zone, ZonePause } from "../domain/zone.js";

interface ZoneDoc {
  _id: Types.ObjectId;
  cityId: Types.ObjectId;
  name: string;
  polygon: GeoPolygon;
  isEnabled: boolean;
  pause: ZonePause | null;
  createdAt: Date;
  updatedAt: Date;
}

function toZone(doc: ZoneDoc): Zone {
  return {
    id: String(doc._id),
    cityId: String(doc.cityId),
    name: doc.name,
    polygon: doc.polygon,
    isEnabled: doc.isEnabled,
    pause: doc.pause ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function handleDuplicateKey(error: unknown): never {
  const err = error as { code?: number };
  if (err?.code === 11000) {
    throw conflict("Zone name already exists in this city");
  }
  throw error;
}

export function createMongoZoneStore(connection: Connection): ZoneStore {
  const collection = () => connection.collection<ZoneDoc>("zones");
  const versions = () => connection.collection<{ _id: string; revision: number; updatedAt: Date }>("geography_versions");

  return {
    async ensureIndexes(): Promise<void> {
      await collection().createIndex(
        { polygon: "2dsphere" },
        { name: "zone_polygon_2dsphere" }
      );
      await collection().createIndex(
        { cityId: 1, name: 1 },
        { unique: true, name: "zone_city_name_unique" }
      );
      await collection().createIndex(
        { isEnabled: 1 },
        { name: "zone_is_enabled" }
      );
    },

    async serializeGeometry(session: ClientSession): Promise<number> {
      const now = new Date();
      const result = await versions().findOneAndUpdate(
        { _id: "geography" },
        { $inc: { revision: 1 }, $setOnInsert: { createdAt: now }, $set: { updatedAt: now } },
        { session, upsert: true, returnDocument: "after" }
      );
      return result?.revision ?? 1;
    },

    async findAll(filter?: { cityId?: string | undefined }): Promise<Zone[]> {
      const query: Record<string, unknown> = {};
      if (filter?.cityId && Types.ObjectId.isValid(filter.cityId)) {
        query.cityId = new Types.ObjectId(filter.cityId);
      }
      const docs = await collection()
        .find(query)
        .sort({ name: 1 })
        .toArray();
      return docs.map(toZone);
    },

    async findById(id: string, session?: ClientSession): Promise<Zone | null> {
      if (!Types.ObjectId.isValid(id)) return null;
      const doc = await collection().findOne(
        { _id: new Types.ObjectId(id) },
        session ? { session } : {}
      );
      return doc ? toZone(doc) : null;
    },

    async findEnabled(excludeId?: string | undefined, session?: ClientSession): Promise<Zone[]> {
      const query: Record<string, unknown> = { isEnabled: true };
      if (excludeId && Types.ObjectId.isValid(excludeId)) {
        query._id = { $ne: new Types.ObjectId(excludeId) };
      }
      const docs = await collection()
        .find(query, session ? { session } : {})
        .toArray();
      return docs.map(toZone);
    },

    async findByNameInCity(
      cityId: string,
      name: string,
      excludeId?: string,
      session?: ClientSession
    ): Promise<Zone | null> {
      if (!Types.ObjectId.isValid(cityId)) return null;
      const query: Record<string, unknown> = {
        cityId: new Types.ObjectId(cityId),
        name,
      };
      if (excludeId && Types.ObjectId.isValid(excludeId)) {
        query._id = { $ne: new Types.ObjectId(excludeId) };
      }
      const doc = await collection().findOne(query, session ? { session } : {});
      return doc ? toZone(doc) : null;
    },

    async findByPoint(lng: number, lat: number): Promise<Zone[]> {
      const docs = await collection()
        .find({
          isEnabled: true,
          polygon: {
            $geoIntersects: {
              $geometry: {
                type: "Point",
                coordinates: [lng, lat],
              },
            },
          },
        })
        .toArray();
      return docs.map(toZone);
    },

    async create(zone: Zone, session: ClientSession): Promise<Zone> {
      const now = new Date();
      const doc: ZoneDoc = {
        _id: new Types.ObjectId(zone.id),
        cityId: new Types.ObjectId(zone.cityId),
        name: zone.name,
        polygon: zone.polygon,
        isEnabled: zone.isEnabled,
        pause: zone.pause,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await collection().insertOne(doc, { session });
        return toZone(doc);
      } catch (error) {
        handleDuplicateKey(error);
      }
    },

    async update(id: string, patch: Partial<Zone>, session: ClientSession): Promise<Zone | null> {
      if (!Types.ObjectId.isValid(id)) return null;

      const updateDoc: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (patch.name !== undefined) updateDoc.name = patch.name;
      if (patch.polygon !== undefined) updateDoc.polygon = patch.polygon;
      if (patch.isEnabled !== undefined) updateDoc.isEnabled = patch.isEnabled;
      if (patch.pause !== undefined) updateDoc.pause = patch.pause;

      try {
        const result = await collection().findOneAndUpdate(
          { _id: new Types.ObjectId(id) },
          { $set: updateDoc },
          { session, returnDocument: "after" }
        );
        return result ? toZone(result) : null;
      } catch (error) {
        handleDuplicateKey(error);
      }
    },
  };
}
