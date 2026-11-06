import { Types, type ClientSession, type Connection } from "mongoose";
import type { WarehouseStore } from "../application/ports.js";
import { conflict } from "../domain/errors.js";
import type { Warehouse } from "../domain/warehouse.js";
import type { ZonePause } from "../domain/zone.js";

interface WarehouseDoc {
  _id: Types.ObjectId;
  zoneId: Types.ObjectId;
  name: string;
  code: string;
  location: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  address: string;
  isEnabled: boolean;
  priority: number;
  packMinutes: number;
  riderArrivalMinutes: number;
  defaultTravelMinutes: number;
  punchInRadiusMeters: number;
  pause: ZonePause | null;
  createdAt: Date;
  updatedAt: Date;
}

function toWarehouse(doc: WarehouseDoc): Warehouse {
  return {
    id: String(doc._id),
    zoneId: String(doc.zoneId),
    name: doc.name,
    code: doc.code,
    location: {
      lat: doc.location.coordinates[1],
      lng: doc.location.coordinates[0],
    },
    address: doc.address,
    isEnabled: doc.isEnabled,
    priority: doc.priority,
    packMinutes: doc.packMinutes,
    riderArrivalMinutes: doc.riderArrivalMinutes,
    defaultTravelMinutes: doc.defaultTravelMinutes,
    punchInRadiusMeters: doc.punchInRadiusMeters,
    pause: doc.pause ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function handleDuplicateKey(error: unknown): never {
  const err = error as { code?: number };
  if (err?.code === 11000) {
    throw conflict("Warehouse code already exists");
  }
  throw error;
}

export function createMongoWarehouseStore(connection: Connection): WarehouseStore {
  const collection = () => connection.collection<WarehouseDoc>("warehouses");

  return {
    async ensureIndexes(): Promise<void> {
      await collection().createIndex(
        { code: 1 },
        { unique: true, name: "warehouse_code_unique" }
      );
      await collection().createIndex(
        { zoneId: 1 },
        { name: "warehouse_zone_id" }
      );
      await collection().createIndex(
        { location: "2dsphere" },
        { name: "warehouse_location_2dsphere" }
      );
      await collection().createIndex(
        { isEnabled: 1, priority: 1 },
        { name: "warehouse_enabled_priority" }
      );
    },

    async findAll(filter?: {
      zoneId?: string | undefined;
      isEnabled?: boolean | undefined;
      ids?: readonly string[] | undefined;
    }): Promise<Warehouse[]> {
      const query: Record<string, unknown> = {};

      if (filter?.zoneId && Types.ObjectId.isValid(filter.zoneId)) {
        query.zoneId = new Types.ObjectId(filter.zoneId);
      }
      if (filter?.isEnabled !== undefined) {
        query.isEnabled = filter.isEnabled;
      }
      if (filter?.ids) {
        const validIds = filter.ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
        query._id = { $in: validIds };
      }

      const docs = await collection()
        .find(query)
        .sort({ priority: 1, name: 1 })
        .toArray();
      return docs.map(toWarehouse);
    },

    async findById(id: string, session?: ClientSession): Promise<Warehouse | null> {
      if (!Types.ObjectId.isValid(id)) return null;
      const doc = await collection().findOne(
        { _id: new Types.ObjectId(id) },
        session ? { session } : {}
      );
      return doc ? toWarehouse(doc) : null;
    },

    async findByCode(code: string, excludeId?: string, session?: ClientSession): Promise<Warehouse | null> {
      const query: Record<string, unknown> = {
        code: code.trim().toUpperCase(),
      };
      if (excludeId && Types.ObjectId.isValid(excludeId)) {
        query._id = { $ne: new Types.ObjectId(excludeId) };
      }
      const doc = await collection().findOne(query, session ? { session } : {});
      return doc ? toWarehouse(doc) : null;
    },

    async create(warehouse: Warehouse, session: ClientSession): Promise<Warehouse> {
      const now = new Date();
      const doc: WarehouseDoc = {
        _id: new Types.ObjectId(warehouse.id),
        zoneId: new Types.ObjectId(warehouse.zoneId),
        name: warehouse.name,
        code: warehouse.code.trim().toUpperCase(),
        location: {
          type: "Point",
          coordinates: [warehouse.location.lng, warehouse.location.lat],
        },
        address: warehouse.address,
        isEnabled: warehouse.isEnabled,
        priority: warehouse.priority,
        packMinutes: warehouse.packMinutes,
        riderArrivalMinutes: warehouse.riderArrivalMinutes,
        defaultTravelMinutes: warehouse.defaultTravelMinutes,
        punchInRadiusMeters: warehouse.punchInRadiusMeters,
        pause: warehouse.pause,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await collection().insertOne(doc, { session });
        return toWarehouse(doc);
      } catch (error) {
        handleDuplicateKey(error);
      }
    },

    async update(id: string, patch: Partial<Warehouse>, session: ClientSession): Promise<Warehouse | null> {
      if (!Types.ObjectId.isValid(id)) return null;

      const updateDoc: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (patch.name !== undefined) updateDoc.name = patch.name;
      if (patch.location !== undefined) {
        updateDoc.location = {
          type: "Point",
          coordinates: [patch.location.lng, patch.location.lat],
        };
      }
      if (patch.address !== undefined) updateDoc.address = patch.address;
      if (patch.isEnabled !== undefined) updateDoc.isEnabled = patch.isEnabled;
      if (patch.priority !== undefined) updateDoc.priority = patch.priority;
      if (patch.packMinutes !== undefined) updateDoc.packMinutes = patch.packMinutes;
      if (patch.riderArrivalMinutes !== undefined) updateDoc.riderArrivalMinutes = patch.riderArrivalMinutes;
      if (patch.defaultTravelMinutes !== undefined) updateDoc.defaultTravelMinutes = patch.defaultTravelMinutes;
      if (patch.punchInRadiusMeters !== undefined) updateDoc.punchInRadiusMeters = patch.punchInRadiusMeters;
      if (patch.pause !== undefined) updateDoc.pause = patch.pause;

      try {
        const result = await collection().findOneAndUpdate(
          { _id: new Types.ObjectId(id) },
          { $set: updateDoc },
          { session, returnDocument: "after" }
        );
        return result ? toWarehouse(result) : null;
      } catch (error) {
        handleDuplicateKey(error);
      }
    },
  };
}
