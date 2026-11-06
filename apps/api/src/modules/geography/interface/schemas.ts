import { z } from "zod";

export const hexIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Must be a 24-character hexadecimal ObjectId");

export const createCitySchema = z
  .object({
    name: z.string().trim().min(1, "City name is required").max(100, "City name must be at most 100 characters"),
    state: z.string().trim().min(1, "State name is required").max(100, "State name must be at most 100 characters"),
  })
  .strict();

export const updateCitySchema = z
  .object({
    name: z.string().trim().min(1, "City name must not be empty").max(100, "City name must be at most 100 characters").optional(),
    state: z.string().trim().min(1, "State name must not be empty").max(100, "State name must be at most 100 characters").optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => data.name !== undefined || data.state !== undefined || data.isActive !== undefined,
    { message: "At least one field must be provided to update" }
  );

export type CreateCityBody = z.infer<typeof createCitySchema>;
export type UpdateCityBody = z.infer<typeof updateCitySchema>;

export const createZoneSchema = z
  .object({
    cityId: hexIdSchema,
    name: z.string().trim().min(1, "Zone name is required").max(100, "Zone name must be at most 100 characters"),
    polygon: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))),
    }),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export type CreateZoneBody = z.infer<typeof createZoneSchema>;

export const zonePauseSchema = z
  .object({
    active: z.boolean(),
    message: z.string().trim().min(1, "Pause message is required").max(500, "Pause message must be at most 500 characters"),
    until: z.string().datetime().nullable().optional(),
  })
  .strict();

export const updateZoneSchema = z
  .object({
    name: z.string().trim().min(1, "Zone name must not be empty").max(100, "Zone name must be at most 100 characters").optional(),
    polygon: z
      .object({
        type: z.literal("Polygon"),
        coordinates: z.array(z.array(z.array(z.number()))),
      })
      .optional(),
    isEnabled: z.boolean().optional(),
    pause: zonePauseSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.polygon !== undefined ||
      data.isEnabled !== undefined ||
      data.pause !== undefined,
    { message: "At least one field must be provided to update" }
  );

export type UpdateZoneBody = z.infer<typeof updateZoneSchema>;

export const locationPointSchema = z
  .object({
    lat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90"),
    lng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180"),
  })
  .strict();

export const createLocalitySchema = z
  .object({
    cityId: hexIdSchema,
    name: z.string().trim().min(1, "Locality name is required").max(100, "Locality name must be at most 100 characters"),
    location: locationPointSchema,
    zoneId: hexIdSchema.nullable().optional(),
    travelMinutes: z.number().int().min(0, "Travel minutes must be a non-negative integer").nullable().optional(),
    sortOrder: z.number().int().min(0, "Sort order must be a non-negative integer").optional(),
  })
  .strict();

export type CreateLocalityBody = z.infer<typeof createLocalitySchema>;

export const updateLocalitySchema = z
  .object({
    name: z.string().trim().min(1, "Locality name must not be empty").max(100, "Locality name must be at most 100 characters").optional(),
    cityId: hexIdSchema.optional(),
    location: locationPointSchema.optional(),
    zoneId: hexIdSchema.nullable().optional(),
    travelMinutes: z.number().int().min(0, "Travel minutes must be a non-negative integer").nullable().optional(),
    sortOrder: z.number().int().min(0, "Sort order must be a non-negative integer").optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.cityId !== undefined ||
      data.location !== undefined ||
      data.zoneId !== undefined ||
      data.travelMinutes !== undefined ||
      data.sortOrder !== undefined ||
      data.isActive !== undefined,
    { message: "At least one field must be provided to update" }
  );

export type UpdateLocalityBody = z.infer<typeof updateLocalitySchema>;

export const resolveLocationSchema = z
  .object({
    lat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90").optional(),
    lng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180").optional(),
    localityId: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasCoords = data.lat !== undefined || data.lng !== undefined;
      const hasLocality = data.localityId !== undefined;
      if (hasCoords && hasLocality) return false;
      if (!hasCoords && !hasLocality) return false;
      if (hasCoords && (data.lat === undefined || data.lng === undefined)) return false;
      return true;
    },
    { message: "Provide either valid coordinates (lat, lng) or localityId, not both" }
  );

export type ResolveLocationBody = z.infer<typeof resolveLocationSchema>;

export const createWarehouseSchema = z
  .object({
    zoneId: hexIdSchema,
    name: z.string().trim().min(1, "Warehouse name is required").max(100, "Warehouse name must be at most 100 characters"),
    code: z.string().trim().regex(/^[A-Za-z0-9-]{2,20}$/, "Warehouse code must be 2-20 alphanumeric characters or hyphens"),
    location: locationPointSchema,
    address: z.string().trim().min(3, "Address must be at least 3 characters").max(500, "Address must be at most 500 characters"),
    priority: z.number().int().min(1, "Priority must be an integer >= 1").optional().default(1),
    packMinutes: z.number().int().min(0, "Pack minutes must be a non-negative integer").optional().default(5),
    riderArrivalMinutes: z.number().int().min(0, "Rider arrival minutes must be a non-negative integer").optional().default(5),
    defaultTravelMinutes: z.number().int().min(0, "Default travel minutes must be a non-negative integer").optional().default(10),
    punchInRadiusMeters: z.number().int().min(0, "Punch-in radius must be a non-negative integer").optional().default(150),
  })
  .strict();

export type CreateWarehouseBody = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z
  .object({
    name: z.string().trim().min(1, "Warehouse name must not be empty").max(100, "Warehouse name must be at most 100 characters").optional(),
    location: locationPointSchema.optional(),
    address: z.string().trim().min(3, "Address must be at least 3 characters").max(500, "Address must be at most 500 characters").optional(),
    isEnabled: z.boolean().optional(),
    priority: z.number().int().min(1, "Priority must be an integer >= 1").optional(),
    packMinutes: z.number().int().min(0, "Pack minutes must be a non-negative integer").optional(),
    riderArrivalMinutes: z.number().int().min(0, "Rider arrival minutes must be a non-negative integer").optional(),
    defaultTravelMinutes: z.number().int().min(0, "Default travel minutes must be a non-negative integer").optional(),
    punchInRadiusMeters: z.number().int().min(0, "Punch-in radius must be a non-negative integer").optional(),
    pause: zonePauseSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.location !== undefined ||
      data.address !== undefined ||
      data.isEnabled !== undefined ||
      data.priority !== undefined ||
      data.packMinutes !== undefined ||
      data.riderArrivalMinutes !== undefined ||
      data.defaultTravelMinutes !== undefined ||
      data.punchInRadiusMeters !== undefined ||
      data.pause !== undefined,
    { message: "At least one field must be provided to update" }
  );

export type UpdateWarehouseBody = z.infer<typeof updateWarehouseSchema>;
