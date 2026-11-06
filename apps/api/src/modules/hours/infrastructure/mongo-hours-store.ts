import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter, type AuditEvent } from "../../audit/audit.public.js";
import type { Pause, WarehouseHours } from "../domain/hours.js";
import { SlotFullError, type HoursStore } from "../application/ports.js";

type HoursDoc = Omit<WarehouseHours, "warehouseId"> & { _id: string };
type PauseDoc = Omit<Pause, "scope" | "id"> & { _id: string; scope: Pause["scope"]; refId: string };
interface BookingDoc { _id: string; warehouseId: string; date: string; slotStart: string; at: Date }

export function createMongoHoursStore(connection: Connection): HoursStore {
  const hours = () => connection.collection<HoursDoc>("warehouse_hours");
  const pauses = () => connection.collection<PauseDoc>("ops_pauses");
  const bookings = () => connection.collection<BookingDoc>("preorder_bookings");
  const counts = () => connection.collection<{ _id: string; booked: number }>("preorder_slot_counts");
  const writeAudit = createAuditWriter(connection);
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  const toHours = ({ _id, ...rest }: HoursDoc): WarehouseHours => ({ warehouseId: _id, ...rest });
  const toPause = ({ _id: _i, refId, ...rest }: PauseDoc): Pause => ({ id: refId, ...rest });
  const slotKey = (w: string, date: string, start: string) => `${w}|${date}|${start}`;

  return {
    async ensureIndexes() {
      await pauses().createIndex({ scope: 1, refId: 1 });
      await bookings().createIndex({ warehouseId: 1, date: 1 });
    },
    async getHours(id) { const d = await hours().findOne({ _id: id }); return d ? toHours(d) : null; },
    async getManyHours(ids) { return ids.length === 0 ? [] : (await hours().find({ _id: { $in: [...ids] } }).toArray()).map(toHours); },
    async saveHours(h, audit) {
      const { warehouseId, ...rest } = h;
      await inTransaction(async session => {
        await hours().replaceOne({ _id: warehouseId }, rest, { upsert: true, session });
        if (audit) await writeAudit(audit, session);
      });
    },
    async getPause(scope, id) { const d = await pauses().findOne({ _id: `${scope}:${id}` }); return d ? toPause(d) : null; },
    async getPauses(scope, ids) { return ids.length === 0 ? [] : (await pauses().find({ scope, refId: { $in: [...ids] } }).toArray()).map(toPause); },
    async savePause(p, audit) {
      const { id, ...rest } = p;
      await inTransaction(async session => {
        await pauses().replaceOne({ _id: `${p.scope}:${id}` }, { ...rest, refId: id } as never, { upsert: true, session });
        if (audit) await writeAudit(audit, session);
      });
    },

    async holdSlot({ warehouseId, date, slotStart, capacity, orderId, at }) {
      try {
        return await inTransaction(async session => {
          if (await bookings().findOne({ _id: orderId }, { session })) return false;
          const key = slotKey(warehouseId, date, slotStart);
          await counts().updateOne({ _id: key }, { $setOnInsert: { booked: 0 } }, { upsert: true, session });
          const taken = await counts().updateOne({ _id: key, booked: { $lt: capacity } }, { $inc: { booked: 1 } }, { session });
          if (taken.matchedCount === 0) throw new SlotFullError();
          await bookings().insertOne({ _id: orderId, warehouseId, date, slotStart, at }, { session });
          return true;
        });
      } catch (error) {
        if ((error as { code?: number } | null)?.code === 11000) return false;
        throw error;
      }
    },
    async releaseSlot(orderId) {
      return inTransaction(async session => {
        const booking = await bookings().findOne({ _id: orderId }, { session });
        if (!booking) return false;
        await bookings().deleteOne({ _id: orderId }, { session });
        await counts().updateOne({ _id: slotKey(booking.warehouseId, booking.date, booking.slotStart), booked: { $gt: 0 } }, { $inc: { booked: -1 } }, { session });
        return true;
      });
    },
    async booked(warehouseId, date) {
      const rows = await counts().find({ _id: { $regex: `^${warehouseId}\\|${date}\\|` } }).toArray();
      return new Map(rows.map(r => [r._id.split("|")[2]!, r.booked]));
    },
  };
}
