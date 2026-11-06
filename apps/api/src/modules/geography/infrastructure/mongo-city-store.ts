import { Types, type ClientSession, type Connection } from "mongoose";
import type { CityStore } from "../application/ports.js";
import type { City } from "../domain/city.js";
import { conflict } from "../domain/errors.js";

interface CityDoc {
  _id: Types.ObjectId;
  name: string;
  state: string;
  canonicalName: string;
  canonicalState: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toCity(doc: CityDoc): City {
  return {
    id: String(doc._id),
    name: doc.name,
    state: doc.state,
    canonicalName: doc.canonicalName,
    canonicalState: doc.canonicalState,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function handleDuplicateKey(error: unknown): never {
  const err = error as { code?: number };
  if (err?.code === 11000) {
    throw conflict("City with this name and state already exists");
  }
  throw error;
}

export function createMongoCityStore(connection: Connection): CityStore {
  const collection = () => connection.collection<CityDoc>("cities");

  return {
    async ensureIndexes(): Promise<void> {
      await collection().createIndex(
        { canonicalName: 1, canonicalState: 1 },
        { unique: true, name: "canonical_city_state_unique" }
      );
      await collection().createIndex(
        { isActive: 1, name: 1 },
        { name: "active_cities_name" }
      );
      await collection().createIndex(
        { name: 1 },
        { name: "cities_name" }
      );
    },

    async findActive(): Promise<City[]> {
      const docs = await collection()
        .find({ isActive: true })
        .sort({ name: 1 })
        .toArray();
      return docs.map(toCity);
    },

    async findAll(): Promise<City[]> {
      const docs = await collection()
        .find({})
        .sort({ name: 1 })
        .toArray();
      return docs.map(toCity);
    },

    async findById(id: string, session?: ClientSession): Promise<City | null> {
      if (!Types.ObjectId.isValid(id)) return null;
      const doc = await collection().findOne(
        { _id: new Types.ObjectId(id) },
        session ? { session } : {}
      );
      return doc ? toCity(doc) : null;
    },

    async findByCanonical(
      canonicalName: string,
      canonicalState: string,
      excludeId?: string,
      session?: ClientSession
    ): Promise<City | null> {
      const filter: Record<string, unknown> = {
        canonicalName,
        canonicalState,
      };
      if (excludeId && Types.ObjectId.isValid(excludeId)) {
        filter._id = { $ne: new Types.ObjectId(excludeId) };
      }
      const doc = await collection().findOne(
        filter,
        session ? { session } : {}
      );
      return doc ? toCity(doc) : null;
    },

    async create(city: City, session: ClientSession): Promise<City> {
      const now = new Date();
      const doc: CityDoc = {
        _id: new Types.ObjectId(city.id),
        name: city.name,
        state: city.state,
        canonicalName: city.canonicalName,
        canonicalState: city.canonicalState,
        isActive: city.isActive,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await collection().insertOne(doc, { session });
        return toCity(doc);
      } catch (error) {
        handleDuplicateKey(error);
      }
    },

    async update(
      id: string,
      patch: { name?: string; state?: string; canonicalName?: string; canonicalState?: string; isActive?: boolean },
      session: ClientSession
    ): Promise<City | null> {
      if (!Types.ObjectId.isValid(id)) return null;

      const updateDoc: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (patch.name !== undefined) updateDoc.name = patch.name;
      if (patch.state !== undefined) updateDoc.state = patch.state;
      if (patch.canonicalName !== undefined) updateDoc.canonicalName = patch.canonicalName;
      if (patch.canonicalState !== undefined) updateDoc.canonicalState = patch.canonicalState;
      if (patch.isActive !== undefined) updateDoc.isActive = patch.isActive;

      try {
        const result = await collection().findOneAndUpdate(
          { _id: new Types.ObjectId(id) },
          { $set: updateDoc },
          { session, returnDocument: "after" }
        );
        return result ? toCity(result) : null;
      } catch (error) {
        handleDuplicateKey(error);
      }
    },
  };
}
