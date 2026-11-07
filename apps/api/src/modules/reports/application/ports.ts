export interface DashboardFilter {
  /** Indian calendar day shown, and the instants it spans. */
  date: string; start: Date; end: Date; now: Date;
  /** `null` means every warehouse. */
  warehouseIds: readonly string[] | null;
  /** An active order this many minutes past its promise counts as delayed. */
  delayedAfterMinutes: number;
  lowStock: { grams: number; units: number };
}

export interface Dashboard {
  date: string;
  orders: { today: number; active: number; delivered: number; cancelled: number };
  revenue: { today: number };
  riders: { online: number; onBreak: number; offline: number };
  pendingRefunds: number; lowStock: number; offlineDeliveryReviews: number; reconciliationOpen: number; riderCashOutstanding: number;
  unacknowledgedAssignments: number; delayedOrders: number;
  byWarehouse: { warehouseId: string; orders: number; revenue: number }[];
}

export interface DashboardStore { dashboard(filter: DashboardFilter): Promise<Dashboard> }

/** Settings the dashboard needs, read on every request so a change applies at once. */
export interface DashboardSettings { delayedAfterMinutes: number; lowStockGrams: number; lowStockUnits: number }
export type SettingsSource = (warehouseId?: string) => Promise<DashboardSettings>;
export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = { delayedAfterMinutes: 5, lowStockGrams: 5000, lowStockUnits: 5 };
