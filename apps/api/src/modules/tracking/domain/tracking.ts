import { haversineMeters } from "../../riders/riders.public.js";

export interface TrackingSettings {
  /** Average road speed used for the ETA estimate until a routes provider is connected. */
  averageSpeedKmh: number;
  /** Roads wind: the straight-line distance is multiplied by this. */
  detourFactor: number;
  /** Rain, night and other extra minutes added to every live ETA (F17 ops mode). */
  extraMinutes: number;
  /** The live ETA is worked out again at most this often. */
  etaRefreshSeconds: number;
  /** A public tracking link works for this long. */
  tokenTtlHours: number;
  /** A position older than this many days is not kept. */
  maxPointAgeDays: number;
  /** How often the phone sends its position: with an order, and when idle but online. */
  pingOnOrderSeconds: number; pingIdleSeconds: number;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
  averageSpeedKmh: 18, detourFactor: 1.3, extraMinutes: 0, etaRefreshSeconds: 60, tokenTtlHours: 24, maxPointAgeDays: 7, pingOnOrderSeconds: 10, pingIdleSeconds: 60,
};

/** Minutes from one place to another. A routes service can replace the baseline later; it answers null when it cannot. */
export interface EtaProvider { minutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<number | null> }

/** The road from one place to another, as points to draw. `approximate` is true for a straight line used when no road answer exists. */
export interface RoutePath { distanceM: number; durationS: number; points: { lat: number; lng: number }[]; approximate: boolean }
export interface RoutePathProvider { path(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RoutePath | null> }

export function baselineEta(settings: TrackingSettings): EtaProvider {
  return {
    async minutes(from, to) {
      const metres = haversineMeters(from, to) * settings.detourFactor;
      return Math.max(1, Math.ceil(metres / 1000 / settings.averageSpeedKmh * 60)) + settings.extraMinutes;
    },
  };
}

/** Statuses in which the customer may see the rider on the map. */
export const RIDER_VISIBLE = ["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"] as const;
