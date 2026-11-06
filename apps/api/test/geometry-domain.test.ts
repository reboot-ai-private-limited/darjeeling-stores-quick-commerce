import { describe, expect, it } from "vitest";
import {
  isPointInRing,
  isPointOnRingBoundary,
  pointInPolygon,
  pointOnBoundary,
  polygonsOverlap,
  polygonArea,
  polygonSignedArea,
  validatePolygon,
} from "../src/modules/geography/domain/geometry.js";
import {
  SYNTHETIC_POINTS,
  SYNTHETIC_POLYGONS,
} from "./integration/support/geography-fixture.js";

describe("F03-03: Geometry domain policy & polygon validation", () => {
  describe("validatePolygon", () => {
    it("accepts valid simple polygons", () => {
      const valid = validatePolygon(SYNTHETIC_POLYGONS.zoneA);
      expect(valid.type).toBe("Polygon");
      expect(valid.coordinates[0]).toHaveLength(5);
    });

    it("rejects non-polygon types", () => {
      expect(() => validatePolygon(null)).toThrow("GeoJSON object");
      expect(() => validatePolygon({ type: "MultiPolygon", coordinates: [] })).toThrow(
        "Geometry type must be 'Polygon'"
      );
      expect(() => validatePolygon({ type: "Point", coordinates: [88.26, 27.03] })).toThrow(
        "Geometry type must be 'Polygon'"
      );
    });

    it("rejects missing, empty, or multi-ring coordinates", () => {
      expect(() => validatePolygon({ type: "Polygon", coordinates: "invalid" })).toThrow(
        "array of rings"
      );
      expect(() => validatePolygon({ type: "Polygon", coordinates: [] })).toThrow(
        "must contain an outer ring"
      );
      expect(() => validatePolygon(SYNTHETIC_POLYGONS.withHole)).toThrow(
        "holes or multiple rings is not supported"
      );
    });

    it("rejects rings with fewer than 4 coordinates", () => {
      expect(() => validatePolygon(SYNTHETIC_POLYGONS.tooFewCoordinates)).toThrow(
        "at least 3 distinct vertices"
      );
    });

    it("rejects unclosed rings where first and last coordinates do not match", () => {
      expect(() => validatePolygon(SYNTHETIC_POLYGONS.unclosed)).toThrow(
        "ring must be closed"
      );
    });

    it("rejects polygons with more than 1,000 vertices", () => {
      const hugeRing: [number, number][] = [];
      const count = 1002;
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        hugeRing.push([88.26 + 0.01 * Math.cos(angle), 27.03 + 0.01 * Math.sin(angle)]);
      }
      hugeRing.push([...hugeRing[0]!]);

      expect(() => validatePolygon({ type: "Polygon", coordinates: [hugeRing] })).toThrow(
        "exceeds maximum limit of 1,000 vertices"
      );
    });

    it("rejects out-of-bounds latitude and longitude", () => {
      expect(() => validatePolygon(SYNTHETIC_POLYGONS.outOfBoundsLat)).toThrow(
        "Latitude at index"
      );

      const outOfBoundsLng = {
        type: "Polygon",
        coordinates: [
          [
            [185.0, 27.035],
            [186.0, 27.035],
            [186.0, 27.05],
            [185.0, 27.05],
            [185.0, 27.035],
          ],
        ],
      };
      expect(() => validatePolygon(outOfBoundsLng)).toThrow("Longitude at index");
    });

    it("rejects consecutive duplicate coordinates", () => {
      const duplicateCoord = {
        type: "Polygon",
        coordinates: [
          [
            [88.26, 27.035],
            [88.26, 27.035], // duplicate
            [88.275, 27.035],
            [88.275, 27.05],
            [88.26, 27.05],
            [88.26, 27.035],
          ],
        ],
      };
      expect(() => validatePolygon(duplicateCoord)).toThrow("Consecutive duplicate coordinate");
    });

    it("rejects collinear zero-area polygons", () => {
      expect(() => validatePolygon(SYNTHETIC_POLYGONS.zeroAreaCollinear)).toThrow(
        "zero or degenerate area"
      );
    });

    it("rejects self-intersecting polygons (figure-8 / bow-tie)", () => {
      expect(() => validatePolygon(SYNTHETIC_POLYGONS.selfIntersecting)).toThrow(
        "self-intersecting"
      );
    });

    it("rejects antimeridian crossing spans", () => {
      const antimeridianCrossing = {
        type: "Polygon",
        coordinates: [
          [
            [-170.0, 27.035],
            [170.0, 27.035],
            [170.0, 27.05],
            [-170.0, 27.05],
            [-170.0, 27.035],
          ],
        ],
      };
      expect(() => validatePolygon(antimeridianCrossing)).toThrow(
        "crosses the antimeridian"
      );
    });
  });

  describe("polygonsOverlap", () => {
    const polyA = validatePolygon(SYNTHETIC_POLYGONS.zoneA);
    const polyBAdjacent = validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent);
    const polyCDisjoint = validatePolygon(SYNTHETIC_POLYGONS.zoneCDisjoint);
    const polyOverlappingA = validatePolygon(SYNTHETIC_POLYGONS.overlappingA);
    const polyContainedInA = validatePolygon(SYNTHETIC_POLYGONS.containedInA);
    const polyIdenticalToA = validatePolygon(SYNTHETIC_POLYGONS.identicalToA);

    it("returns false for completely disjoint polygons", () => {
      expect(polygonsOverlap(polyA, polyCDisjoint)).toBe(false);
      expect(polygonsOverlap(polyCDisjoint, polyA)).toBe(false);
    });

    it("returns false for adjacent polygons sharing an edge (zero positive area)", () => {
      // polyA and polyBAdjacent share the segment along lng=88.275 between lat 27.035 and 27.050
      expect(polygonsOverlap(polyA, polyBAdjacent)).toBe(false);
      expect(polygonsOverlap(polyBAdjacent, polyA)).toBe(false);
    });

    it("returns false for polygons touching only at a vertex", () => {
      const vertexTouchingPoly = validatePolygon({
        type: "Polygon",
        coordinates: [
          [
            [88.275, 27.05], // shared top-right vertex with Zone A
            [88.29, 27.05],
            [88.29, 27.065],
            [88.275, 27.065],
            [88.275, 27.05],
          ],
        ],
      });
      expect(polygonsOverlap(polyA, vertexTouchingPoly)).toBe(false);
      expect(polygonsOverlap(vertexTouchingPoly, polyA)).toBe(false);
    });

    it("returns true for crossing polygons with positive area of intersection", () => {
      expect(polygonsOverlap(polyA, polyOverlappingA)).toBe(true);
      expect(polygonsOverlap(polyOverlappingA, polyA)).toBe(true);
    });

    it("returns true for strict containment (polygon inside another)", () => {
      expect(polygonsOverlap(polyA, polyContainedInA)).toBe(true);
      expect(polygonsOverlap(polyContainedInA, polyA)).toBe(true);
    });

    it("returns true for identical polygons", () => {
      expect(polygonsOverlap(polyA, polyIdenticalToA)).toBe(true);
      expect(polygonsOverlap(polyIdenticalToA, polyA)).toBe(true);
    });

    it("returns true when shared collinear edge has interiors on the same side", () => {
      // Zone A is from [88.260, 27.035] to [88.275, 27.050]
      // A smaller rectangle sharing the right edge [88.275, 27.035]-[88.275, 27.050]
      // but extending leftwards (same interior side as Zone A)
      const sameSideInteriorPoly = validatePolygon({
        type: "Polygon",
        coordinates: [
          [
            [88.27, 27.035],
            [88.275, 27.035],
            [88.275, 27.05],
            [88.27, 27.05],
            [88.27, 27.035],
          ],
        ],
      });
      expect(polygonsOverlap(polyA, sameSideInteriorPoly)).toBe(true);
    });

    it("regression: detects positive overlap between thin rectangles sharing collinear edge without false negatives", () => {
      // Thin rectangle A: height 5e-7 (lng 88.260 to 88.270, lat 27.0350000 to 27.0350005)
      const thinRectA = validatePolygon({
        type: "Polygon",
        coordinates: [
          [
            [88.26, 27.035],
            [88.27, 27.035],
            [88.27, 27.0350005],
            [88.26, 27.0350005],
            [88.26, 27.035],
          ],
        ],
      });

      // Overlapping thin rectangle B: shifted right, overlapping lng 88.265 to 88.270 with same height
      const thinRectB = validatePolygon({
        type: "Polygon",
        coordinates: [
          [
            [88.265, 27.035],
            [88.275, 27.035],
            [88.275, 27.0350005],
            [88.265, 27.0350005],
            [88.265, 27.035],
          ],
        ],
      });

      // Must detect overlap
      expect(polygonsOverlap(thinRectA, thinRectB)).toBe(true);
      expect(polygonsOverlap(thinRectB, thinRectA)).toBe(true);

      // Adjacent thin rectangle C: shares the vertical boundary at lng 88.270, disjoint interior
      const thinRectCAdjacent = validatePolygon({
        type: "Polygon",
        coordinates: [
          [
            [88.27, 27.035],
            [88.28, 27.035],
            [88.28, 27.0350005],
            [88.27, 27.0350005],
            [88.27, 27.035],
          ],
        ],
      });

      // Shared edge on boundary should NOT be considered overlap
      expect(polygonsOverlap(thinRectA, thinRectCAdjacent)).toBe(false);
      expect(polygonsOverlap(thinRectCAdjacent, thinRectA)).toBe(false);
    });
  });

  describe("pointInPolygon and boundary checks", () => {
    const polyA = validatePolygon(SYNTHETIC_POLYGONS.zoneA);
    const polyB = validatePolygon(SYNTHETIC_POLYGONS.zoneBAdjacent);

    it("correctly identifies point inside polygon", () => {
      expect(pointInPolygon(SYNTHETIC_POINTS.insideZoneA, polyA)).toBe(true);
      expect(pointInPolygon(SYNTHETIC_POINTS.insideZoneA, polyB)).toBe(false);

      expect(pointInPolygon(SYNTHETIC_POINTS.insideZoneB, polyB)).toBe(true);
      expect(pointInPolygon(SYNTHETIC_POINTS.insideZoneB, polyA)).toBe(false);
    });

    it("correctly identifies points strictly outside all polygons", () => {
      expect(pointInPolygon(SYNTHETIC_POINTS.outsideAll, polyA)).toBe(false);
      expect(pointInPolygon(SYNTHETIC_POINTS.outsideAll, polyB)).toBe(false);
    });

    it("treats point on shared edge as inside both adjacent polygons", () => {
      expect(pointInPolygon(SYNTHETIC_POINTS.onSharedEdgeAB, polyA)).toBe(true);
      expect(pointInPolygon(SYNTHETIC_POINTS.onSharedEdgeAB, polyB)).toBe(true);
      expect(pointOnBoundary(SYNTHETIC_POINTS.onSharedEdgeAB, polyA)).toBe(true);
      expect(pointOnBoundary(SYNTHETIC_POINTS.onSharedEdgeAB, polyB)).toBe(true);
    });

    it("treats point on vertex as inside and on boundary", () => {
      expect(pointInPolygon(SYNTHETIC_POINTS.onVertexA, polyA)).toBe(true);
      expect(pointOnBoundary(SYNTHETIC_POINTS.onVertexA, polyA)).toBe(true);
    });

    it("distinguishes interior points from boundary points", () => {
      expect(pointOnBoundary(SYNTHETIC_POINTS.insideZoneA, polyA)).toBe(false);
    });
  });

  describe("area calculations", () => {
    it("computes correct positive area", () => {
      // Rectangle with width 0.015 and height 0.015
      const area = polygonArea(SYNTHETIC_POLYGONS.zoneA.coordinates[0]);
      expect(area).toBeCloseTo(0.015 * 0.015, 8);
    });
  });
});
