import type { Ctx } from "../../catalog/catalog.public.js";
import { forbidden, notFound, validation } from "../../catalog/catalog.public.js";
import {
  changeProblems, defsOf, dependencyProblems, DEFS, isGroup, REGISTRY, resolveKey, type Group, type ScopeRef, type SettingValue, type Source,
} from "../domain/registry.js";
import type { HistoryQuery, HistoryRow, SettingChange, SettingsStore } from "./ports.js";

export interface SettingView { key: string; value: SettingValue; source: Source; version: number }
export interface GroupView { group: Group; scope: ScopeRef; values: SettingView[] }
export interface PutInput { scope: ScopeRef; values: Record<string, unknown> }

export interface SettingsDeps { store: SettingsStore; now: () => Date }

export function createSettingsService({ store, now }: SettingsDeps) {
  /** Nearest first: warehouse, its zone, global. */
  async function chainOf(scope: ScopeRef): Promise<ScopeRef[]> {
    if (scope.type === "global") return [scope];
    if (scope.type === "zone") return [scope, { type: "global", id: null }];
    const zoneId = await store.zoneOf(scope.id!);
    return [scope, ...(zoneId ? [{ type: "zone" as const, id: zoneId }] : []), { type: "global", id: null }];
  }

  async function checkScope(ctx: Ctx, scope: ScopeRef): Promise<void> {
    const { actor } = ctx;
    if (scope.type === "global") { if (scope.id !== null) throw validation("A global scope has no id"); }
    else if (!scope.id) throw validation(`A ${scope.type} scope needs an id`);
    if (scope.type === "warehouse") {
      if (!(await store.zoneOf(scope.id!))) throw notFound("Warehouse");
      if (!actor.scope.all && !actor.scope.warehouseIds.includes(scope.id!)) throw forbidden("This warehouse is outside your scope");
    } else if (scope.type === "zone") {
      if (!(await store.zoneExists(scope.id!))) throw notFound("Zone");
      if (!actor.scope.all) throw forbidden("Zone and global settings need all-warehouse access");
    } else if (!actor.scope.all) throw forbidden("Zone and global settings need all-warehouse access");
  }

  async function effective(group: Group, scope: ScopeRef): Promise<GroupView> {
    const chain = await chainOf(scope);
    const stored = await store.layers(group, chain);
    const values = defsOf(group).map(def => {
      const layers = stored.filter(s => s.key === def.key).map(s => ({ scope: s.scope, value: s.value, version: s.version }));
      return { key: def.key, ...resolveKey(def, layers) };
    });
    return { group, scope, values };
  }

  const requireGroup = (name: string): Group => { if (!isGroup(name)) throw notFound("Settings group"); return name; };

  const listeners: (() => Promise<void> | void)[] = [];
  /** Tells the modules that keep a copy of the settings to read them again. A failing listener never fails the save. */
  async function changed() { await Promise.allSettled(listeners.map(async listener => listener())); }

  return {
    /** Called after every saved change (and after the save is visible), so a module can refresh what it holds. */
    onChange(listener: () => Promise<void> | void): void { listeners.push(listener); },

    registry() { return REGISTRY.map(def => ({ ...def })); },

    async get(ctx: Ctx, groupName: string, scope: ScopeRef): Promise<GroupView> {
      const group = requireGroup(groupName);
      await checkScope(ctx, scope);
      return effective(group, scope);
    },

    async put(ctx: Ctx, groupName: string, input: PutInput): Promise<GroupView> {
      const group = requireGroup(groupName);
      await checkScope(ctx, input.scope);
      const problems = changeProblems(group, input.scope, input.values);
      if (problems.length > 0) throw validation("Invalid settings", problems);
      const before = await effective(group, input.scope);
      const stored = await store.layers(group, await chainOf(input.scope));
      const ownValue = (key: string) => stored.find(s => s.key === key && s.scope === input.scope.type)?.value ?? null;
      const changes: SettingChange[] = Object.entries(input.values).filter(([key, value]) => JSON.stringify(ownValue(key)) !== JSON.stringify(value)).map(([key, value]) => ({ key, value }));
      if (changes.length === 0) return before;
      // What the scope would resolve to after the change, to check rules that tie several keys together.
      const after: Record<string, SettingValue> = {};
      for (const row of before.values) after[row.key] = row.value;
      for (const change of changes) {
        if (change.value !== null) after[change.key] = change.value as SettingValue;
        else {
          const parent = stored.filter(s => s.key === change.key && s.scope !== input.scope.type);
          after[change.key] = resolveKey(DEFS.get(`${group}.${change.key}`)!, parent.map(s => ({ scope: s.scope, value: s.value, version: s.version }))).value;
        }
      }
      const rules = dependencyProblems(after);
      if (rules.length > 0) throw validation("Invalid settings", rules);
      await store.apply({
          group, scope: input.scope, changes, by: ctx.actor.userId, at: now(),
      });
      await changed();
      return effective(group, input.scope);
    },

    async history(ctx: Ctx, query: Omit<HistoryQuery, "warehouseIds">): Promise<{ rows: HistoryRow[]; nextCursor: string | null }> {
      if (query.group && !isGroup(query.group)) throw validation("Unknown settings group", [{ path: "group", message: "Unknown group" }]);
      return store.history({ ...query, warehouseIds: ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds });
    },

    /** The settings a module should use, with no permission check. Other modules call this on each request, so a change applies at once. */
    async effectiveValues(group: Group, scope: ScopeRef = { type: "global", id: null }): Promise<Record<string, SettingValue>> {
      const view = await effective(group, scope);
      return Object.fromEntries(view.values.map(v => [v.key, v.value]));
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
