import type { ClientSession } from "mongoose";
import {
  type City,
  type CityDTO,
  canonicalKey,
  normalizeName,
  normalizeStateName,
  toCityDTO,
  validateCityInput,
} from "../domain/city.js";
import { conflict, forbidden, notFound, validationError } from "../domain/errors.js";
import type { CityStore, GeographyActor, LockActorFn, WriteAuditFn } from "./ports.js";

export interface CreateCityInput {
  name: string;
  state: string;
}

export interface UpdateCityInput {
  name?: string | undefined;
  state?: string | undefined;
  isActive?: boolean | undefined;
}

export interface CityServiceDependencies {
  store: CityStore;
  writeAudit: WriteAuditFn;
  withTransaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  newId: () => string;
  lockActor?: LockActorFn | undefined;
}

export function createCityService(deps: CityServiceDependencies) {
  function assertCityAuthority(actor: GeographyActor | null | undefined): asserts actor is GeographyActor {
    if (!actor) {
      throw forbidden("Authentication required");
    }
    const hasPermission = actor.permissions.includes("*") || actor.permissions.includes("zones:manage");
    if (!hasPermission || !actor.scope.all) {
      throw forbidden("Requires zones:manage permission with all-warehouse scope");
    }
  }

  return {
    async listPublicCities(): Promise<CityDTO[]> {
      const cities = await deps.store.findActive();
      return cities.map(toCityDTO);
    },

    async listAdminCities(actor: GeographyActor | null | undefined): Promise<CityDTO[]> {
      assertCityAuthority(actor);
      const cities = await deps.store.findAll();
      return cities.map(toCityDTO);
    },

    async getCityById(id: string): Promise<CityDTO | null> {
      if (!/^[a-fA-F0-9]{24}$/.test(id)) return null;
      const city = await deps.store.findById(id);
      return city ? toCityDTO(city) : null;
    },

    async createCity(
      input: CreateCityInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<CityDTO> {
      assertCityAuthority(actor);
      const { name, state, canonicalName, canonicalState } = validateCityInput(input.name, input.state);

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertCityAuthority(liveActor);

        const existing = await deps.store.findByCanonical(canonicalName, canonicalState, undefined, session);
        if (existing) {
          throw conflict("City with this name and state already exists");
        }

        const id = deps.newId();
        const cityRecord: City = {
          id,
          name,
          state,
          canonicalName,
          canonicalState,
          isActive: true,
        };

        const created = await deps.store.create(cityRecord, session);
        const dto = toCityDTO(created);

        await deps.writeAudit(
          {
            actorId: liveActor.id ?? "anonymous",
            actorRole: liveActor.roleName ?? "staff",
            action: "city.create",
            entityType: "city",
            entityId: id,
            requestId,
            cityChange: {
              before: null,
              after: dto,
            },
          },
          session
        );

        return dto;
      });
    },

    async updateCity(
      id: string,
      input: UpdateCityInput,
      actor: GeographyActor | null | undefined,
      requestId: string
    ): Promise<CityDTO> {
      assertCityAuthority(actor);
      if (!/^[a-fA-F0-9]{24}$/.test(id)) {
        throw notFound("City");
      }

      const hasUpdate = input.name !== undefined || input.state !== undefined || input.isActive !== undefined;
      if (!hasUpdate) {
        throw validationError("At least one field must be provided to update");
      }

      return deps.withTransaction(async (session) => {
        const liveActor = deps.lockActor ? await deps.lockActor(actor, session) : actor;
        assertCityAuthority(liveActor);

        const current = await deps.store.findById(id, session);
        if (!current) {
          throw notFound("City");
        }

        const newName = input.name !== undefined ? normalizeName(input.name) : current.name;
        const newState = input.state !== undefined ? normalizeStateName(input.state) : current.state;

        if (input.name !== undefined && (newName.length < 1 || newName.length > 100)) {
          throw validationError("City name must be between 1 and 100 characters");
        }
        if (input.state !== undefined && (newState.length < 1 || newState.length > 100)) {
          throw validationError("State name must be between 1 and 100 characters");
        }

        const { canonicalName, canonicalState } = canonicalKey(newName, newState);

        if (canonicalName !== current.canonicalName || canonicalState !== current.canonicalState) {
          const duplicate = await deps.store.findByCanonical(canonicalName, canonicalState, id, session);
          if (duplicate) {
            throw conflict("City with this name and state already exists");
          }
        }

        const patch = {
          name: newName,
          state: newState,
          canonicalName,
          canonicalState,
          isActive: input.isActive !== undefined ? input.isActive : current.isActive,
        };

        const updated = await deps.store.update(id, patch, session);
        if (!updated) {
          throw notFound("City");
        }

        const beforeDTO = toCityDTO(current);
        const afterDTO = toCityDTO(updated);

        await deps.writeAudit(
          {
            actorId: liveActor.id ?? "anonymous",
            actorRole: liveActor.roleName ?? "staff",
            action: "city.update",
            entityType: "city",
            entityId: id,
            requestId,
            cityChange: {
              before: beforeDTO,
              after: afterDTO,
            },
          },
          session
        );

        return afterDTO;
      });
    },
  };
}

export type CityService = ReturnType<typeof createCityService>;
