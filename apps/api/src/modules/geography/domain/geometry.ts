import { s2 } from "s2js";
import { invalidPolygon } from "./errors.js";

export type Coordinate = [number, number]; // [lng, lat]

export interface GeoPolygon {
  type: "Polygon";
  coordinates: Coordinate[][];
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

const EPSILON = 1e-10;

/** Computes the 2D cross product of vector OA and OB: (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x) */
function crossProduct(o: Coordinate, a: Coordinate, b: Coordinate): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Signed area using Shoelace formula. Positive = CCW, Negative = CW. */
export function polygonSignedArea(ring: Coordinate[]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    const p1 = ring[i]!;
    const p2 = ring[i + 1]!;
    area += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return area / 2;
}

/** Absolute area of a polygon ring. */
export function polygonArea(ring: Coordinate[]): number {
  return Math.abs(polygonSignedArea(ring));
}

/** Check if point q lies on segment pr (assuming p, q, r are collinear). */
function onSegment(p: Coordinate, q: Coordinate, r: Coordinate): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) + EPSILON &&
    q[0] >= Math.min(p[0], r[0]) - EPSILON &&
    q[1] <= Math.max(p[1], r[1]) + EPSILON &&
    q[1] >= Math.min(p[1], r[1]) - EPSILON
  );
}

/**
 * Checks if two line segments (p1-p2) and (q1-q2) intersect strictly in their relative interiors.
 * Touching at endpoints or collinear contact does NOT count as a strict crossing.
 */
export function segmentsIntersectStrictly(
  p1: Coordinate,
  p2: Coordinate,
  q1: Coordinate,
  q2: Coordinate
): boolean {
  const d1 = crossProduct(q1, q2, p1);
  const d2 = crossProduct(q1, q2, p2);
  const d3 = crossProduct(p1, p2, q1);
  const d4 = crossProduct(p1, p2, q2);

  // Both endpoints of each segment must be strictly on opposite sides of the other segment's line
  if (
    ((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) &&
    ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if two line segments share any points (interior crossing, endpoint touching, or overlapping).
 */
export function segmentsIntersect(
  p1: Coordinate,
  p2: Coordinate,
  q1: Coordinate,
  q2: Coordinate
): boolean {
  if (segmentsIntersectStrictly(p1, p2, q1, q2)) return true;

  const d1 = crossProduct(q1, q2, p1);
  const d2 = crossProduct(q1, q2, p2);
  const d3 = crossProduct(p1, p2, q1);
  const d4 = crossProduct(p1, p2, q2);

  if (Math.abs(d1) <= EPSILON && onSegment(q1, p1, q2)) return true;
  if (Math.abs(d2) <= EPSILON && onSegment(q1, p2, q2)) return true;
  if (Math.abs(d3) <= EPSILON && onSegment(p1, q1, p2)) return true;
  if (Math.abs(d4) <= EPSILON && onSegment(p1, q2, p2)) return true;

  return false;
}

/**
 * Checks whether a 2D point [lng, lat] lies on the boundary of a polygon ring.
 */
export function isPointOnRingBoundary(point: Coordinate, ring: Coordinate[]): boolean {
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const cross = crossProduct(a, b, point);
    if (Math.abs(cross) <= EPSILON && onSegment(a, point, b)) {
      return true;
    }
  }
  return false;
}

/**
 * Tests whether a point [lng, lat] is inside a polygon ring using the Ray-Casting algorithm.
 * If includeBoundary is true, points on the boundary are considered inside.
 */
export function isPointInRing(
  point: Coordinate,
  ring: Coordinate[],
  includeBoundary = true
): boolean {
  if (isPointOnRingBoundary(point, ring)) {
    return includeBoundary;
  }

  const [px, py] = point;
  let inside = false;
  const n = ring.length;

  for (let i = 0, j = n - 2; i < n - 1; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];

    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Validates that the GeoJSON Polygon satisfies all F03 domain rules:
 * 1. type === "Polygon"
 * 2. Exactly one outer ring (no holes, no MultiPolygon)
 * 3. Closed (first point equals last point)
 * 4. At least 3 distinct vertices (minimum 4 coordinate pairs)
 * 5. Maximum 1,000 vertices
 * 6. Finite coordinates: lat in [-85, 85], lng in [-180, 180]
 * 7. No antimeridian crossing
 * 8. Positive non-zero area
 * 9. No self-intersections
 */
export function validatePolygon(polygon: unknown): GeoPolygon {
  if (!polygon || typeof polygon !== "object") {
    throw invalidPolygon("Polygon must be a GeoJSON object");
  }

  const p = polygon as Record<string, unknown>;
  if (p.type !== "Polygon") {
    throw invalidPolygon("Geometry type must be 'Polygon'");
  }

  if (!Array.isArray(p.coordinates)) {
    throw invalidPolygon("Polygon coordinates must be an array of rings");
  }

  if (p.coordinates.length !== 1) {
    throw invalidPolygon(
      p.coordinates.length === 0
        ? "Polygon must contain an outer ring"
        : "Polygon with holes or multiple rings is not supported"
    );
  }

  const ring = p.coordinates[0];
  if (!Array.isArray(ring)) {
    throw invalidPolygon("Polygon outer ring must be an array of coordinates");
  }

  if (ring.length < 4) {
    throw invalidPolygon("Polygon must have at least 3 distinct vertices (minimum 4 coordinates with closure)");
  }

  if (ring.length > 1001) {
    throw invalidPolygon("Polygon exceeds maximum limit of 1,000 vertices");
  }

  // Check closure
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    !Array.isArray(first) ||
    !Array.isArray(last) ||
    first.length < 2 ||
    last.length < 2 ||
    Math.abs(first[0] - last[0]) > EPSILON ||
    Math.abs(first[1] - last[1]) > EPSILON
  ) {
    throw invalidPolygon("Polygon ring must be closed (first coordinate must equal last coordinate)");
  }

  let minLng = Infinity;
  let maxLng = -Infinity;

  // Validate individual coordinates
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    if (!Array.isArray(pt) || pt.length < 2) {
      throw invalidPolygon(`Invalid coordinate at index ${i}`);
    }
    const [lng, lat] = pt;
    if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw invalidPolygon(`Longitude at index ${i} must be a finite number between -180 and 180 (got ${lng})`);
    }
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -85 || lat > 85) {
      throw invalidPolygon(`Latitude at index ${i} must be a finite number between -85 and 85 (got ${lat})`);
    }

    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;

    // Check adjacent duplicate vertices (other than first and last)
    if (i < ring.length - 1) {
      const next = ring[i + 1]!;
      if (Math.abs(lng - next[0]) <= EPSILON && Math.abs(lat - next[1]) <= EPSILON) {
        throw invalidPolygon(`Consecutive duplicate coordinate at index ${i}`);
      }
    }
  }

  // Antimeridian crossing check
  if (maxLng - minLng > 180) {
    throw invalidPolygon("Polygon crosses the antimeridian, which is not supported");
  }

  // Self-intersection check: no two non-adjacent segments may intersect
  const coords = ring as Coordinate[];
  const numSegments = coords.length - 1;

  for (let i = 0; i < numSegments; i++) {
    const p1 = coords[i]!;
    const p2 = coords[i + 1]!;

    for (let j = i + 1; j < numSegments; j++) {
      // Adjacent segments naturally share an endpoint; skip adjacent
      if (Math.abs(i - j) <= 1 || (i === 0 && j === numSegments - 1)) {
        continue;
      }

      const q1 = coords[j]!;
      const q2 = coords[j + 1]!;

      if (segmentsIntersect(p1, p2, q1, q2)) {
        throw invalidPolygon(`Polygon is self-intersecting between edges (${i}-${i + 1}) and (${j}-${j + 1})`);
      }
    }
  }

  // Area check (only valid simple polygons reach this check)
  const area = polygonArea(coords);
  if (area < 1e-12) {
    throw invalidPolygon("Polygon has zero or degenerate area");
  }

  return {
    type: "Polygon",
    coordinates: [coords],
  };
}

// MongoDB 2dsphere uses great-circle edges; flat-coordinate overlap checks disagree near curved edges.
function sphericalLoop(polygon: GeoPolygon): s2.Loop {
  const vertices = polygon.coordinates[0]!.slice(0, -1).map(([lng, lat]) =>
    s2.Point.fromLatLng(s2.LatLng.fromDegrees(lat, lng)));
  const loop = new s2.Loop(vertices);
  loop.normalize();
  return loop;
}

/** Shared boundaries are legal; S2 loops intersect only when their interiors overlap. */
export function polygonsOverlap(polyA: GeoPolygon, polyB: GeoPolygon): boolean {
  return sphericalLoop(polyA).intersects(sphericalLoop(polyB));
}

/**
 * Checks if a point { lat, lng } is geographically contained within a GeoJSON Polygon.
 * Supports border detection (points on boundary count as inside).
 */
export function pointInPolygon(point: LatLngPoint, polygon: GeoPolygon): boolean {
  const location = s2.Point.fromLatLng(s2.LatLng.fromDegrees(point.lat, point.lng));
  return pointOnBoundary(point, polygon) || sphericalLoop(polygon).containsPoint(location);
}

/**
 * Checks if a point { lat, lng } is strictly on the boundary of a GeoJSON Polygon.
 */
export function pointOnBoundary(point: LatLngPoint, polygon: GeoPolygon): boolean {
  const location = s2.Point.fromLatLng(s2.LatLng.fromDegrees(point.lat, point.lng));
  const boundary = new s2.Polyline(polygon.coordinates[0]!.map(([lng, lat]) =>
    s2.Point.fromLatLng(s2.LatLng.fromDegrees(lat, lng))));
  const [nearest] = boundary.project(location);
  return location.distance(nearest) <= 8 * Number.EPSILON;
}
