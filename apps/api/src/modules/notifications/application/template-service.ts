import { conflict, notFound, validation } from "../../catalog/catalog.public.js";
import { CHANNELS, KNOWN_VARS, variablesIn, type Category, type Channel, type Template } from "../domain/notification.js";
import { DuplicateTemplateError, type AuditEntry, type NotificationStore } from "./ports.js";

export interface TemplateInput {
  key: string; channel: Channel; title: string | null; body: string; whatsappTemplateName: string | null;
  category: Category; language: string; isActive: boolean;
}
export type TemplatePatch = Partial<TemplateInput>;

const view = (t: Template) => ({
  id: t.id, key: t.key, channel: t.channel, title: t.title, body: t.body, whatsappTemplateName: t.whatsappTemplateName,
  category: t.category, language: t.language, isActive: t.isActive,
});

/** Checks a template the way an admin would expect: known variables, the fields its channel needs, and the right category. */
export function checkTemplate(t: TemplateInput): void {
  for (const [field, text] of [["body", t.body], ["title", t.title ?? ""]] as const) {
    const unknown = variablesIn(text).find(name => !(KNOWN_VARS as readonly string[]).includes(name));
    if (unknown) throw validation(`{{${unknown}}} is not a variable the server can fill in`, { field, variable: unknown });
  }
  if (t.channel === "whatsapp" && !t.whatsappTemplateName) throw validation("A WhatsApp template needs the name of the template approved by the provider", { field: "whatsappTemplateName" });
  if (t.channel !== "whatsapp" && t.whatsappTemplateName) throw validation("whatsappTemplateName applies to WhatsApp templates only", { field: "whatsappTemplateName" });
  if (t.channel !== "push" && t.title) throw validation("Only push templates have a title", { field: "title" });
  if (t.channel === "sms" && t.category === "marketing") throw validation("SMS is only used for login codes and cannot carry marketing", { field: "category" });
}

/** Admin-editable message templates (F23). */
export function createTemplateService(deps: { store: NotificationStore; now: () => Date; newId: () => string }) {
  const { store, now, newId } = deps;

  return {
    async list() {
      const data = (await store.listTemplates()).sort((a, b) => a.key.localeCompare(b.key) || CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel)).map(view);
      return data;
    },

    async create(input: TemplateInput, audit: Omit<AuditEntry, "action" | "entityId" | "entityType">) {
      checkTemplate(input);
      const at = now();
      const template: Template = { id: newId(), ...input, createdAt: at, updatedAt: at };
      try { await store.insertTemplate(template, { ...audit, action: "notification_template.create", entityType: "notification_template", entityId: template.id }); }
      catch (error) { if (error instanceof DuplicateTemplateError) throw conflict("A template with this key and channel already exists", { field: "key" }); throw error; }
      return view(template);
    },

    async update(id: string, patch: TemplatePatch, audit: Omit<AuditEntry, "action" | "entityId" | "entityType">) {
      const current = await store.getTemplate(id);
      if (!current) throw notFound("Template");
      const next: Template = { ...current, ...patch, updatedAt: now() };
      checkTemplate(next);
      try { await store.saveTemplate(next, { ...audit, action: "notification_template.update", entityType: "notification_template", entityId: id }); }
      catch (error) { if (error instanceof DuplicateTemplateError) throw conflict("A template with this key and channel already exists", { field: "key" }); throw error; }
      return view(next);
    },
  };
}

export type TemplateService = ReturnType<typeof createTemplateService>;
