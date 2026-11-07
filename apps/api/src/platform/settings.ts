/** Where a setting is being read for. A warehouse is the most specific, then its zone, then everything. */
export interface ScopeHint { zoneId?: string | undefined; warehouseId?: string | undefined }

/**
 * A module's settings, read fresh on each use so an admin's change applies on the next request.
 * The real provider reads the admin settings; tests and small setups pass fixed values through `settingsProvider`.
 */
export type SettingsProvider<T> = (scope?: ScopeHint) => Promise<T>;

/** A live provider is used as it is; fixed (or no) values are completed from the defaults and returned every time. */
export function settingsProvider<T extends object>(defaults: T, source?: Partial<T> | SettingsProvider<T>): SettingsProvider<T> {
  if (typeof source === "function") return source;
  const fixed: T = { ...defaults, ...source };
  return async () => fixed;
}

/**
 * A settings object that reads from its sources each time a value is used, instead of copying them once at start-up, so a change the owner
 * makes in admin applies to the next request. Later sources win; a source that does not have a key (or has it as `undefined`) is skipped, and
 * the defaults fill the rest. Spreading the result (`{ ...settings }`) takes a snapshot, so pass the object on as it is.
 */
export function liveSettings<T extends object>(defaults: T, ...sources: (Partial<T> | undefined)[]): T {
  const read = (key: PropertyKey): unknown => {
    for (let i = sources.length - 1; i >= 0; i--) {
      const value = (sources[i] as Record<PropertyKey, unknown> | undefined)?.[key];
      if (value !== undefined) return value;
    }
    return (defaults as Record<PropertyKey, unknown>)[key];
  };
  return new Proxy({} as T, {
    get: (_target, key) => read(key),
    has: (_target, key) => key in defaults,
    ownKeys: () => Reflect.ownKeys(defaults),
    getOwnPropertyDescriptor: (_target, key) => (key in defaults ? { enumerable: true, configurable: true, writable: false, value: read(key) } : undefined),
  });
}
