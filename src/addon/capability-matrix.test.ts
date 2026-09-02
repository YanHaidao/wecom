import { describe, expect, it } from "vitest";
import {
  WECOM_ENTERPRISE_CALENDAR_ACTIONS,
  WECOM_ENTERPRISE_DOC_ACTIONS,
  wecomEnterpriseCalendarToolSchema,
  wecomEnterpriseDocToolSchema,
} from "./capability-matrix.js";

const EXPECTED_DOC_ADDON_ACTIONS = [
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

const OFFICIAL_DOC_ACTIONS = [
  "create",
  "rename",
  "get_info",
  "set_join_rule",
  "set_member_auth",
  "grant_access",
  "add_collaborators",
  "get_content",
  "update_content",
  "get_sheet_properties",
  "edit_sheet_data",
  "get_sheet_data",
  "smartsheet_add_records",
  "smartsheet_update_records",
  "smartsheet_del_records",
  "smartsheet_get_records",
  "smartsheet_get_sheets",
  "smartsheet_add_sheet",
  "smartsheet_del_sheet",
  "smartsheet_update_sheet",
  "smartsheet_get_views",
  "smartsheet_add_view",
  "smartsheet_del_view",
  "smartsheet_update_view",
  "smartsheet_get_fields",
  "smartsheet_add_fields",
  "smartsheet_del_fields",
  "smartsheet_update_fields",
] as const;

const RETIRED_DOC_ACTIONS = [
  "get_doc_security_setting",
  "mod_doc_security_setting",
] as const;

const EXPECTED_CALENDAR_ADDON_ACTIONS = [
  "calendar_create",
  "calendar_update",
  "calendar_get",
  "calendar_delete",
  "schedule_get_system_calid",
  "schedule_create_in_system",
] as const;

const OFFICIAL_CALENDAR_ACTIONS = [
  "schedule_create",
  "schedule_update",
  "schedule_add_attendees",
  "schedule_del_attendees",
  "schedule_get_by_calendar",
  "schedule_get",
  "schedule_delete",
] as const;

function schemaActions(schema: { properties: { action: { enum: readonly string[] } } }): string[] {
  return [...schema.properties.action.enum];
}

function findForbiddenSchemaKeywords(value: unknown, path = "$schema"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenSchemaKeywords(entry, `${path}[${index}]`));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    const nextPath = `${path}.${key}`;
    return ["oneOf", "anyOf", "allOf", "format"].includes(key)
      ? [nextPath]
      : findForbiddenSchemaKeywords(entry, nextPath);
  });
}

describe("official CLI and YanHaidao enhanced capability boundary", () => {
  it("exposes exactly the reviewed enterprise document actions", () => {
    expect([...WECOM_ENTERPRISE_DOC_ACTIONS].sort()).toEqual(
      [...EXPECTED_DOC_ADDON_ACTIONS].sort(),
    );
    expect(schemaActions(wecomEnterpriseDocToolSchema).sort()).toEqual(
      [...EXPECTED_DOC_ADDON_ACTIONS].sort(),
    );
  });

  it("does not re-expose document operations already owned by official wecom-cli", () => {
    const exposed = new Set(schemaActions(wecomEnterpriseDocToolSchema));
    for (const officialAction of [...OFFICIAL_DOC_ACTIONS, ...RETIRED_DOC_ACTIONS]) {
      expect(exposed.has(officialAction), officialAction).toBe(false);
    }
  });

  it("exposes only calendar-container operations missing from official wecom-cli", () => {
    expect([...WECOM_ENTERPRISE_CALENDAR_ACTIONS].sort()).toEqual(
      [...EXPECTED_CALENDAR_ADDON_ACTIONS].sort(),
    );
    expect(schemaActions(wecomEnterpriseCalendarToolSchema).sort()).toEqual(
      [...EXPECTED_CALENDAR_ADDON_ACTIONS].sort(),
    );
    const exposed = new Set(schemaActions(wecomEnterpriseCalendarToolSchema));
    for (const officialAction of OFFICIAL_CALENDAR_ACTIONS) {
      expect(exposed.has(officialAction), officialAction).toBe(false);
    }
  });

  it("partitions every legacy action into standard, enhanced, or retired ownership", () => {
    const documentActions = [
      ...EXPECTED_DOC_ADDON_ACTIONS,
      ...OFFICIAL_DOC_ACTIONS,
      ...RETIRED_DOC_ACTIONS,
    ];
    const calendarActions = [...EXPECTED_CALENDAR_ADDON_ACTIONS, ...OFFICIAL_CALENDAR_ACTIONS];

    expect(documentActions).toHaveLength(58);
    expect(new Set(documentActions).size).toBe(58);
    expect(calendarActions).toHaveLength(13);
    expect(new Set(calendarActions).size).toBe(13);
  });

  it("publishes single-object tool schemas accepted by strict OpenClaw validators", () => {
    expect(wecomEnterpriseDocToolSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
    });
    expect(wecomEnterpriseCalendarToolSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
    });
    expect(findForbiddenSchemaKeywords(wecomEnterpriseDocToolSchema)).toEqual([]);
    expect(findForbiddenSchemaKeywords(wecomEnterpriseCalendarToolSchema)).toEqual([]);
  });
});
