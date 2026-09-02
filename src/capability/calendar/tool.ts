// ============================================================================
// Calendar Tool - Complete Implementation
// 严格遵循企业微信官方 API 文档：https://developer.work.weixin.qq.com/document/path/93329
// ============================================================================
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  resolveAddonAgentAccount,
  type WecomAddonAgentAccount,
} from "../../addon/agent-account.js";
import { wecomEnterpriseCalendarToolSchema } from "../../addon/capability-matrix.js";
import { isWecomAddonToolContext, resolveBoundWecomAccountId } from "../../addon/tool-context.js";
import { WecomCalendarClient } from "./client.js";

// ============================================================================
// Helper Functions
// ============================================================================

function readString(v: unknown): string {
  return String(v ?? "").trim();
}

function readNumber(v: unknown): number {
  const num = Number(v);
  return isNaN(num) ? 0 : num;
}

function readArray(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

function buildResult(payload: any) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function resolveAccount(
  api: OpenClawPluginApi,
  paramsAccountId?: string,
  toolContext?: any,
): WecomAddonAgentAccount | undefined {
  const accountId = resolveBoundWecomAccountId({
    cfg: api.config,
    requestedAccountId: paramsAccountId,
    toolContext,
  });
  return resolveAddonAgentAccount(api.config, accountId);
}

// ============================================================================
// Tool Registration
// ============================================================================

export function registerWecomCalendarTool(api: OpenClawPluginApi): void {
  if (typeof api?.registerTool !== "function") {
    return;
  }

  const client = new WecomCalendarClient();

  api.registerTool(
    (toolContext: any) => {
      if (!isWecomAddonToolContext(toolContext)) {
        return null;
      }

      return {
        name: "wecom_calendar",
        label: "WeCom Advanced Calendar",
        description: "企业微信日历容器和系统日历操作。常规日程操作使用 wecom-cli。",
        parameters: wecomEnterpriseCalendarToolSchema,
        async execute(_toolCallId: string, params: any) {
          try {
            const account = resolveAccount(api, params.accountId, toolContext);

            if (!account || !account.configured) {
              return buildResult({
                ok: false,
                action: params.action,
                error: "账号未配置或不存在",
                accountId: params.accountId,
              });
            }

            switch (params.action) {
              // ========================================================================
              // Calendar APIs
              // ========================================================================

              case "calendar_create": {
                const r = await client.createCalendar({
                  agent: account,
                  request: {
                    calendar: {
                      summary: readString(params.summary),
                      color: readString(params.color),
                      description:
                        params.description !== undefined
                          ? readString(params.description)
                          : undefined,
                      admins: readArray(params.admins),
                      set_as_default: params.set_as_default,
                      shares: readArray(params.shares),
                      is_public: params.is_public,
                      public_range: params.public_range,
                      is_corp_calendar: params.is_corp_calendar,
                    },
                    agentid: params.agentid,
                  },
                });
                return buildResult({
                  ok: true,
                  action: "calendar_create",
                  calId: r.calId,
                  raw: r.raw,
                });
              }

              case "calendar_update": {
                const r = await client.updateCalendar({
                  agent: account,
                  request: {
                    skip_public_range: params.skip_public_range,
                    calendar: {
                      cal_id: readString(params.cal_id),
                      summary: readString(params.summary),
                      color: readString(params.color),
                      description:
                        params.description !== undefined
                          ? readString(params.description)
                          : undefined,
                      admins: readArray(params.admins),
                      shares: readArray(params.shares),
                      public_range: params.public_range,
                    },
                  },
                });
                return buildResult({
                  ok: true,
                  action: "calendar_update",
                  calId: r.calId,
                  raw: r.raw,
                });
              }

              case "calendar_get": {
                const r = await client.getCalendar({
                  agent: account,
                  request: {
                    cal_id_list: readArray(params.cal_id_list),
                  },
                });
                return buildResult({
                  ok: true,
                  action: "calendar_get",
                  calendarList: r.calendarList,
                  raw: r.raw,
                });
              }

              case "calendar_delete": {
                const r = await client.deleteCalendar({
                  agent: account,
                  calId: readString(params.cal_id),
                });
                return buildResult({
                  ok: true,
                  action: "calendar_delete",
                  calId: r.calId,
                  raw: r.raw,
                });
              }

              // ========================================================================
              // System Calendar APIs
              // ========================================================================

              case "schedule_get_system_calid": {
                const r = await client.getSystemCalendarId({
                  agent: account,
                  userid: readString(params.userid),
                });
                return buildResult({
                  ok: true,
                  action: "schedule_get_system_calid",
                  calId: r.calId,
                  raw: r.raw,
                });
              }

              case "schedule_create_in_system": {
                const r = await client.createSystemSchedule({
                  agent: account,
                  request: {
                    schedule: {
                      organizer: readString(params.organizer),
                      start_time: readNumber(params.start_time),
                      end_time: readNumber(params.end_time),
                      is_whole_day: params.is_whole_day,
                      summary:
                        params.summary !== undefined ? readString(params.summary) : undefined,
                      description:
                        params.description !== undefined
                          ? readString(params.description)
                          : undefined,
                      location:
                        params.location !== undefined ? readString(params.location) : undefined,
                      attendees: readArray(params.attendees),
                      reminders: params.reminders,
                    },
                  },
                });
                return buildResult({
                  ok: true,
                  action: "schedule_create_in_system",
                  scheduleId: r.scheduleId,
                  raw: r.raw,
                });
              }

              // ========================================================================
              // Default: Unknown Action
              // ========================================================================

              default:
                throw new Error(`未知操作：${params.action}`);
            }
          } catch (err) {
            return buildResult({
              ok: false,
              action: params.action,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    },
    { name: "wecom_calendar" },
  );
}
