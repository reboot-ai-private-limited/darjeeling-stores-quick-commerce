import { validationError } from "./errors.js";

export interface City {
  id: string;
  name: string;
  state: string;
  canonicalName: string;
  canonicalState: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CityDTO {
  id: string;
  name: string;
  state: string;
  isActive: boolean;
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalKey(name: string, state: string): { canonicalName: string; canonicalState: string } {
  return {
    canonicalName: normalizeName(name).toLowerCase(),
    canonicalState: normalizeName(state).toLowerCase(),
  };
}

export function validateCityInput(name: string, state: string): { name: string; state: string; canonicalName: string; canonicalState: string } {
  const normName = normalizeName(name);
  const normState = normalizeStateName(state);
  if (normName.length < 1 || normName.length > 100) {
    throw validationError("City name must be between 1 and 100 characters");
  }
  if (normState.length < 1 || normState.length > 100) {
    throw validationError("State name must be between 1 and 100 characters");
  }
  const { canonicalName, canonicalState } = canonicalKey(normName, normState);
  return { name: normName, state: normState, canonicalName, canonicalState };
}

export function normalizeStateName(value: string): string {
  return normalizeName(value);
}

export function toCityDTO(city: { id: string; name: string; state: string; isActive: boolean }): CityDTO {
  return {
    id: city.id,
    name: city.name,
    state: city.state,
    isActive: city.isActive,
  };
}
