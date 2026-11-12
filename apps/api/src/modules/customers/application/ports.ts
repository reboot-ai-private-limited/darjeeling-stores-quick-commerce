import type { Customer, CustomerStats, CustomerStatus, Transition } from "../domain/customer.js";

export interface CustomerQuery {
  q?: string | undefined; status?: CustomerStatus | undefined; codAllowed?: boolean | undefined; limit: number; cursor?: string | undefined;
  /** `null` means every customer; otherwise only customers who ordered from these warehouses, with figures from those warehouses. */
  warehouseIds: readonly string[] | null;
}
export interface CustomerRow { customer: Customer; stats: CustomerStats }
export interface CustomerDetail extends CustomerRow {
  addresses: { id: string; label: string; line1: string; landmark: string; locality: string; pincode: string; contactName: string; contactPhone: string; isDefault: boolean; isDeliverable: boolean }[];
  recentOrders: { id: string; orderNo: string; status: string; warehouseId: string; total: number; createdAt: Date }[];
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: "not_found" | "wrong_status" | "has_active_orders" };

export interface CustomerStore {
  list(query: CustomerQuery): Promise<{ rows: CustomerRow[]; nextCursor: string | null }>;
  /** `warehouseIds` limits the order figures and the recent orders to those warehouses. */
  get(id: string, warehouseIds: readonly string[] | null): Promise<CustomerDetail | null>;
  /** Every customer, newest first, for the export. */
  all(limit: number): Promise<CustomerRow[]>;
  staffName(userId: string): Promise<string | null>;
  /** Sets the COD flag and/or adds a note, in one transaction. */
  edit(input: { id: string; codAllowed?: boolean; note?: { text: string; by: string }; at: Date }): Promise<Outcome<Customer>>;
  transition(input: {
    id: string; action: Exclude<Transition, "finalise">; reason: string | null; by: string; at: Date;
  }): Promise<Outcome<Customer>>;
  /** Anonymises the customer and removes their addresses, carts, devices and login codes. Orders and payments stay. */
  finalise(input: { id: string; by: string; at: Date }): Promise<Outcome<{ customer: Customer; addressIds: string[] }>>;
}

/** Deletes the private files of an address (voice note, house photo). Provided by the media module. */
export interface CustomerMedia { removeAddressMedia(addressId: string, reason: string): Promise<number> }
export const noCustomerMedia: CustomerMedia = { removeAddressMedia: async () => 0 };

export const EXPORT_LIMIT = 50_000;
