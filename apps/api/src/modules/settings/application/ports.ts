import type { Group, ScopeRef, ScopeType } from "../domain/registry.js";

export interface HistoryRow { group: string; key: string; scope: ScopeRef; oldValue: unknown; newValue: unknown; by: string; at: Date }
export interface HistoryQuery {
  group?: string | undefined; key?: string | undefined; scopeId?: string | undefined; from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined;
  /** `null` means every scope; otherwise only these warehouses' own overrides are visible. */
  warehouseIds: readonly string[] | null;
}

export interface StoredSetting { key: string; scope: ScopeType; value: unknown; version: number }
/** `value: null` removes the override. */
export interface SettingChange { key: string; value: unknown }
export interface ApplyInput {
  group: Group; scope: ScopeRef; changes: readonly SettingChange[]; by: string; at: Date;
}

export interface SettingsStore {
  ensureIndexes(): Promise<void>;
  /** The stored overrides of a group at each scope in the chain. */
  layers(group: Group, chain: readonly ScopeRef[]): Promise<StoredSetting[]>;
  /** Applies every change with its history row in one transaction. */
  apply(input: ApplyInput): Promise<void>;
  history(query: HistoryQuery): Promise<{ rows: HistoryRow[]; nextCursor: string | null }>;
  /** The zone of a warehouse, or null when the warehouse does not exist. */
  zoneOf(warehouseId: string): Promise<string | null>;
  zoneExists(zoneId: string): Promise<boolean>;
}
