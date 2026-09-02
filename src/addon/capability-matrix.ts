import { wecomCalendarToolSchema } from "../capability/calendar/schema.js";
import { wecomDocToolSchema } from "../capability/doc/schema.js";

export const WECOM_ENTERPRISE_DOC_ACTIONS = [
  "copy",
  "share",
  "get_auth",
  "diagnose_auth",
  "validate_share_link",
  "delete",
  "set_safety_setting",
  "mod_doc_member_notified_scope",
  "create_form",
  "modify_form",
  "get_form_info",
  "get_form_answer",
  "get_form_statistic",
  "smartsheet_add_group",
  "smartsheet_del_group",
  "smartsheet_update_group",
  "smartsheet_get_groups",
  "smartsheet_add_external_records",
  "smartsheet_update_external_records",
  "smartsheet_get_sheet_priv",
  "smartsheet_update_sheet_priv",
  "smartsheet_create_rule",
  "smartsheet_mod_rule_member",
  "smartsheet_delete_rule",
  "doc_assign_advanced_account",
  "doc_cancel_advanced_account",
  "doc_get_advanced_account_list",
  "upload_doc_image",
] as const;

export const WECOM_ENTERPRISE_CALENDAR_ACTIONS = [
  "calendar_create",
  "calendar_update",
  "calendar_get",
  "calendar_delete",
  "schedule_get_system_calid",
  "schedule_create_in_system",
] as const;

type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionOf(schema: unknown): string | undefined {
  const candidate = schema as { properties?: { action?: { const?: unknown } } };
  return typeof candidate.properties?.action?.const === "string"
    ? candidate.properties.action.const
    : undefined;
}

function mergeSchemas(schemas: readonly JsonSchema[]): JsonSchema {
  if (schemas.length === 0) {
    return {};
  }

  const result: JsonSchema = {};
  const types = new Set(schemas.map((schema) => schema.type).filter((type) => type !== undefined));
  if (types.size === 1) {
    result.type = [...types][0];
  }

  const description = schemas.find((schema) => typeof schema.description === "string")?.description;
  if (description) {
    result.description = description;
  }

  const values = schemas.flatMap((schema) => {
    if (Array.isArray(schema.enum)) {
      return schema.enum;
    }
    return schema.const === undefined ? [] : [schema.const];
  });
  if (values.length > 0) {
    result.enum = [...new Set(values)];
  }

  const propertyNames = new Set(
    schemas.flatMap((schema) =>
      isRecord(schema.properties) ? Object.keys(schema.properties) : [],
    ),
  );
  if (propertyNames.size > 0) {
    result.properties = Object.fromEntries(
      [...propertyNames].map((name) => [
        name,
        mergeSchemas(
          schemas
            .map((schema) => (isRecord(schema.properties) ? schema.properties[name] : undefined))
            .filter(isRecord),
        ),
      ]),
    );
  }

  const itemSchemas = schemas.map((schema) => schema.items).filter(isRecord);
  if (itemSchemas.length > 0) {
    result.items = mergeSchemas(itemSchemas);
  }

  if (schemas.every((schema) => schema.additionalProperties === false)) {
    result.additionalProperties = false;
  }

  return result;
}

function sanitizeSchema(schema: JsonSchema): JsonSchema {
  const base: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["oneOf", "anyOf", "allOf", "format"].includes(key)) {
      continue;
    }
    if (key === "properties" && isRecord(value)) {
      base.properties = Object.fromEntries(
        Object.entries(value).map(([name, property]) => [
          name,
          isRecord(property) ? sanitizeSchema(property) : {},
        ]),
      );
      continue;
    }
    if (key === "items" && isRecord(value)) {
      base.items = sanitizeSchema(value);
      continue;
    }
    base[key] = value;
  }

  const alternatives = [schema.oneOf, schema.anyOf, schema.allOf]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter(isRecord)
    .map(sanitizeSchema);
  if (alternatives.length === 0) {
    return base;
  }

  return mergeSchemas([base, mergeSchemas(alternatives)]);
}

function selectActions<T extends { oneOf: readonly unknown[] }>(
  schema: T,
  actions: readonly string[],
) {
  const allowed = new Set(actions);
  const selected = schema.oneOf.filter((entry) => {
    const action = actionOf(entry);
    return action !== undefined && allowed.has(action);
  });
  const propertyNames = new Set(
    selected.flatMap((entry) => {
      if (!isRecord(entry) || !isRecord(entry.properties)) {
        return [];
      }
      return Object.keys(entry.properties).filter((name) => name !== "action");
    }),
  );

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: [...actions],
        description: "YanHaidao WeCom enhanced operation to execute.",
      },
      ...Object.fromEntries(
        [...propertyNames].map((name) => [
          name,
          mergeSchemas(
            selected
              .map((entry) =>
                isRecord(entry) && isRecord(entry.properties) ? entry.properties[name] : undefined,
              )
              .filter(isRecord)
              .map(sanitizeSchema),
          ),
        ]),
      ),
    },
    required: ["action"],
  };
}

export const wecomEnterpriseDocToolSchema = selectActions(
  wecomDocToolSchema,
  WECOM_ENTERPRISE_DOC_ACTIONS,
);

export const wecomEnterpriseCalendarToolSchema = selectActions(
  wecomCalendarToolSchema,
  WECOM_ENTERPRISE_CALENDAR_ACTIONS,
);
