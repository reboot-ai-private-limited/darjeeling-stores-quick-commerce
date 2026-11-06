import { Types, type ClientSession, type Connection } from "mongoose";
import type { LocalityStore } from "../application/ports.js";
import { conflict } from "../domain/errors.js";
import type { Locality } from "../domain/locality.js";

interface LocalityDoc {
  _id: Types.ObjectId;
  cityId: Types.ObjectId;
  name: string;
  location: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  zoneId: Types.ObjectId | null;
  travelMinutes: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toLocality(doc: LocalityDoc): Locality {
  return {
    id: String(doc._id),
    cityId: String(doc.cityId),
    name: doc.name,
    location: {
      lat: doc.location.coordinates[1],
      lng: doc.location.coordinates[0],
    },
    zoneId: doc.zoneId ? String(doc.zoneId) : null,
    travelMinutes: doc.travelMinutes ?? null,
    sortOrder: doc.sortOrder ?? 0,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function handleDuplicateKey(error: unknown): never {
  const err = error as { code?: number };
  if (err?.code === 11000) {
    throw conflict("Locality name already exists in this city");
  }
  throw error;
}

export function createMongoLocalityStore(connection: Connection): LocalityStore {
  const collection = () => connection.collection<LocalityDoc>("localities");

  return {
    async ensureIndexes(): Promise<void> {
      await collection().createIndex(
        { cityId: 1, name: 1 },
        { unique: true, name: "locality_city_name_unique" }
      );
      await collection().createIndex(
        { cityId: 1, isActive: 1, sortOrder: 1, name: 1 },
        { name: "locality_city_active_sort" }
      );
      await collection().createIndex(
        { location: "2dsphere" },
        { name: "locality_location_2dsphere" }
      );
    },

    async findActiveByCity(cityId: string): Promise<Locality[]> {
      if (!Types.ObjectId.isValid(cityId)) return [];
      const docs = await collection()
        .find({
          cityId: new Types.ObjectId(cityId),
          isActive: true,
        })
        .sort({ sortOrder: 1, name: 1 })
        .toArray();
      return docs.map(toLocality);
    },

    async findAll(filter?: { cityId?: string | undefined }): Promise<Locality[]> {
      const query: Record<string, unknown> = {};
      if (filter?.cityId && Types.ObjectId.isValid(filter.cityId)) {
        query.cityId = new Types.ObjectId(filter.cityId);
      }
      const docs = await collection()
        .find(query)
        .sort({ sortOrder: 1, name: 1 })
        .toArray();
      return docs.map(toLocality);
    },

    async findById(id: string, session?: ClientSession): Promise<Locality | null> {
      if (!Types.ObjectId.isValid(id)) return null;
      const doc = await collection().findOne(
        { _id: new Types.ObjectId(id) },
        session ? { session } : {}
      );
      return doc ? toLocality(doc) : null;
    },

    async findByNameInCity(
      cityId: string,
      name: string,
      excludeId?: string,
      session?: ClientSession
    ): Promise<Locality | null> {
      if (!Types.ObjectId.isValid(cityId)) return null;
      const query: Record<string, unknown> = {
        cityId: new Types.ObjectId(cityId),
        name,
      };
      if (excludeId && Types.ObjectId.isValid(excludeId)) {
        query._id = { $ne: new Types.ObjectId(excludeId) };
      }
      const doc = await collection().findOne(query, session ? { session } : {});
      return doc ? toLocality(doc) : null;
    },

    async create(locality: Locality, session: ClientSession): Promise<Locality> {
      const now = new Date();
      const doc: LocalityDoc = {
        _id: new Types.ObjectId(locality.id),
        cityId: new Types.ObjectId(locality.cityId),
        name: locality.name,
        location: {
          type: "Point",
          coordinates: [locality.location.lng, locality.location.lat],
        },
        zoneId: locality.zoneId && Types.ObjectId.isValid(locality.zoneId) ? new Types.ObjectId(locality.zoneId) : null,
        travelMinutes: locality.travelMinutes,
        sortOrder: locality.sortOrder,
        isActive: locality.isActive,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await collection().insertOne(doc, { session });
        return toLocality(doc);
      } catch (error) {
        handleDuplicateKey(error);
      }
    },

    async update(id: string, patch: Partial<Locality>, session: ClientSession): Promise<Locality | null> {
      if (!Types.ObjectId.isValid(id)) return null;

      const updateDoc: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (patch.cityId !== undefined) updateDoc.cityId = new Types.ObjectId(patch.cityId);
      if (patch.name !== undefined) updateDoc.name = patch.name;
      if (patch.location !== undefined) {
        updateDoc.location = {
          type: "Point",
          coordinates: [patch.location.lng, patch.location.lat],
        };
      }
      if (patch.zoneId !== undefined) {
        updateDoc.zoneId = patch.zoneId && Types.ObjectId.isValid(patch.zoneId) ? new Types.ObjectId(patch.zoneId) : null;
      }
      if (patch.travelMinutes !== undefined) updateDoc.travelMinutes = patch.travelMinutes;
      if (patch.sortOrder !== undefined) updateDoc.sortOrder = patch.sortOrder;
      if (patch.isActive !== undefined) updateDoc.isActive = patch.isActive;

      try {
        const result = await collection().findOneAndUpdate(
          { _id: new Types.ObjectId(id) },
          { $set: updateDoc },
          { session, returnDocument: "after" }
        );
        return result ? toLocality(result) : null;
      } catch (error) {
        handleDuplicateKey(error);
      }
    },
  };
}
