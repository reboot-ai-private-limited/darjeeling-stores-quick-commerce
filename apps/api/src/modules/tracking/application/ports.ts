export interface StoredPoint { riderId: string; at: Date; location: { lat: number; lng: number }; accuracyM: number | null; speedKmh: number | null }
export interface StoredEta { orderId: string; riderId: string; minutes: number; etaAt: Date; updatedAt: Date }

export interface TrackingStore {
  ensureIndexes(): Promise<void>;
  /** Keeps the points; one already stored for the same rider and time is skipped. Returns how many were new. */
  insertPoints(points: readonly StoredPoint[]): Promise<number>;
  recentPoints(riderId: string, limit: number): Promise<StoredPoint[]>;
  getEta(orderId: string): Promise<StoredEta | null>;
  saveEta(eta: StoredEta): Promise<void>;
  clearEta(orderId: string): Promise<void>;
  revoke(orderId: string, at: Date): Promise<void>;
  isRevoked(orderId: string): Promise<boolean>;
}
