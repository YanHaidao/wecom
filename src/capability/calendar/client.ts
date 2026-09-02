// ============================================================================
// Calendar Client - Complete Implementation
// 严格遵循企业微信官方 API 文档：https://developer.work.weixin.qq.com/document/path/93329
// ============================================================================
import { getAddonAccessToken } from "../../addon/access-token.js";
import {
  resolveAddonEgressProxyUrl,
  type WecomAddonAgentAccount,
} from "../../addon/agent-account.js";
import { WECOM_ADDON_LIMITS, WECOM_API_BASE } from "../../addon/api-constants.js";
import { wecomFetch } from "../../http.js";
import type {
  CreateCalendarRequest,
  CreateCalendarResponse,
  UpdateCalendarRequest,
  UpdateCalendarResponse,
  GetCalendarRequest,
  GetCalendarResponse,
  DeleteCalendarResponse,
  CreateScheduleResponse,
  GetSystemCalendarIdResponse,
  CreateSystemScheduleRequest,
  CalendarInfo,
} from "./types.js";

type ResolvedAgentAccount = WecomAddonAgentAccount;

// ============================================================================
// Constants - 官方 API 限定值
// ============================================================================

const CALENDAR_LIMITS = {
  ADMINS_MAX: 3,
  SHARES_MAX: 2000,
  PUBLIC_USERS_MAX: 1000,
  PUBLIC_PARTIES_MAX: 100,
  SUMMARY_MIN_LENGTH: 1,
  SUMMARY_MAX_LENGTH: 128,
  DESCRIPTION_MAX_LENGTH: 512,
  COLOR_PATTERN: /^#?[0-9A-Fa-f]{6}$/,
  SCHEDULE_ATTENDEES_MAX: 1000,
  SCHEDULE_DESCRIPTION_MAX_LENGTH: 1000,
  SCHEDULE_LOCATION_MAX_LENGTH: 128,
  SCHEDULE_SUMMARY_MAX_LENGTH: 128,
  REMINDER_BEFORE_EVENT_VALUES: [0, 300, 900, 3600, 86400],
  REMINDER_TIME_DIFFS_VALUES: [0, -300, -900, -3600, -86400, 32400, -172800, -604800],
  REPEAT_TYPE_VALUES: [0, 1, 2, 5, 7],
  TIMEZONE_MIN: -12,
  TIMEZONE_MAX: 12,
  CAL_ID_LIST_MAX: 1000,
  SCHEDULE_ID_LIST_MAX: 1000,
  GET_SCHEDULE_LIMIT_MIN: 1,
  GET_SCHEDULE_LIMIT_MAX: 1000,
  OP_MODE_VALUES: [0, 1, 2],
  PERMISSION_VALUES: [1, 3],
  RESPONSE_STATUS_VALUES: [1, 2, 4],
} as const;

// ============================================================================
// Validation Functions
// ============================================================================

function validateString(
  value: unknown,
  fieldName: string,
  opts?: { min?: number; max?: number; pattern?: RegExp; allowEmpty?: boolean },
): string {
  const str = String(value ?? "");
  if (!opts?.allowEmpty && !str.trim()) {
    throw new Error(`${fieldName} 不能为空`);
  }
  if (opts?.min !== undefined && str.length < opts.min) {
    throw new Error(`${fieldName} 长度不能少于 ${opts.min} 字符`);
  }
  if (opts?.max !== undefined && str.length > opts.max) {
    throw new Error(`${fieldName} 长度不能超过 ${opts.max} 字符`);
  }
  if (opts?.pattern && !opts.pattern.test(str)) {
    throw new Error(`${fieldName} 格式不正确`);
  }
  return str;
}

function validateNumber(
  value: unknown,
  fieldName: string,
  opts?: { min?: number; max?: number; required?: boolean },
): number {
  if (value === undefined || value === null) {
    if (opts?.required) throw new Error(`${fieldName} 是必填项`);
    return 0;
  }
  const num = Number(value);
  if (isNaN(num)) throw new Error(`${fieldName} 必须是数字`);
  if (opts?.min !== undefined && num < opts.min)
    throw new Error(`${fieldName} 不能小于 ${opts.min}`);
  if (opts?.max !== undefined && num > opts.max)
    throw new Error(`${fieldName} 不能大于 ${opts.max}`);
  return num;
}

function validateArray(
  value: unknown,
  fieldName: string,
  opts?: { min?: number; max?: number; required?: boolean },
): any[] {
  if (!Array.isArray(value)) {
    if (opts?.required) throw new Error(`${fieldName} 必须是数组`);
    return [];
  }
  if (opts?.min !== undefined && value.length < opts.min) {
    throw new Error(`${fieldName} 至少需要 ${opts.min} 项`);
  }
  if (opts?.max !== undefined && value.length > opts.max) {
    throw new Error(`${fieldName} 不能超过 ${opts.max} 项`);
  }
  return value;
}

function validateCalendarAdmins(admins?: string[]): string[] | undefined {
  if (!admins) return undefined;
  validateArray(admins, "admins", { max: CALENDAR_LIMITS.ADMINS_MAX });
  return admins.map((id, i) => validateString(id, `admins[${i}]`, { allowEmpty: false }));
}

function validateCalendarShares(
  shares?: Array<{ userid: string; permission?: 1 | 3 }>,
): Array<{ userid: string; permission?: 1 | 3 }> | undefined {
  if (!shares) return undefined;
  validateArray(shares, "shares", { max: CALENDAR_LIMITS.SHARES_MAX });
  return shares.map((s, i) => {
    const userid = validateString(s.userid, `shares[${i}].userid`, { allowEmpty: false });
    if (s.permission !== undefined && !CALENDAR_LIMITS.PERMISSION_VALUES.includes(s.permission)) {
      throw new Error(`shares[${i}].permission 必须是 1 或 3`);
    }
    return { userid, permission: s.permission };
  });
}

function validatePublicRange(publicRange?: {
  userids?: string[];
  partyids?: number[];
}): { userids?: string[]; partyids?: number[] } | undefined {
  if (!publicRange) return undefined;
  const result: { userids?: string[]; partyids?: number[] } = {};
  if (publicRange.userids) {
    validateArray(publicRange.userids, "public_range.userids", {
      max: CALENDAR_LIMITS.PUBLIC_USERS_MAX,
    });
    result.userids = publicRange.userids.map((id, i) =>
      validateString(id, `public_range.userids[${i}]`, { allowEmpty: false }),
    );
  }
  if (publicRange.partyids) {
    validateArray(publicRange.partyids, "public_range.partyids", {
      max: CALENDAR_LIMITS.PUBLIC_PARTIES_MAX,
    });
    result.partyids = publicRange.partyids.map((id, i) =>
      validateNumber(id, `public_range.partyids[${i}]`, { min: 1, required: true }),
    );
  }
  return result;
}

function validateScheduleAttendees(
  attendees?: Array<{ userid: string }>,
): Array<{ userid: string }> | undefined {
  if (!attendees) return undefined;
  validateArray(attendees, "attendees", { max: CALENDAR_LIMITS.SCHEDULE_ATTENDEES_MAX });
  return attendees.map((a, i) => ({
    userid: validateString(a.userid, `attendees[${i}].userid`, { allowEmpty: false, max: 64 }),
  }));
}

function validateReminders(reminders?: any): any | undefined {
  if (!reminders) return undefined;
  const result: any = {};

  if (reminders.is_remind !== undefined) {
    if (![0, 1].includes(reminders.is_remind)) throw new Error("reminders.is_remind 必须是 0 或 1");
    result.is_remind = reminders.is_remind;
  }

  if (reminders.is_repeat !== undefined) {
    if (![0, 1].includes(reminders.is_repeat)) throw new Error("reminders.is_repeat 必须是 0 或 1");
    result.is_repeat = reminders.is_repeat;
  }

  if (reminders.remind_before_event_secs !== undefined) {
    const val = reminders.remind_before_event_secs;
    if (!CALENDAR_LIMITS.REMINDER_BEFORE_EVENT_VALUES.includes(val)) {
      throw new Error(
        `reminders.remind_before_event_secs 必须是 ${CALENDAR_LIMITS.REMINDER_BEFORE_EVENT_VALUES.join(",")}`,
      );
    }
    result.remind_before_event_secs = val;
  }

  if (reminders.remind_time_diffs !== undefined) {
    validateArray(reminders.remind_time_diffs, "reminders.remind_time_diffs");
    result.remind_time_diffs = reminders.remind_time_diffs.map((v: number, i: number) => {
      if (!CALENDAR_LIMITS.REMINDER_TIME_DIFFS_VALUES.includes(v as any)) {
        throw new Error(
          `reminders.remind_time_diffs[${i}] 必须是 ${CALENDAR_LIMITS.REMINDER_TIME_DIFFS_VALUES.join(",")}`,
        );
      }
      return v as any;
    });
  }

  if (reminders.repeat_type !== undefined) {
    if (!CALENDAR_LIMITS.REPEAT_TYPE_VALUES.includes(reminders.repeat_type)) {
      throw new Error(
        `reminders.repeat_type 必须是 ${CALENDAR_LIMITS.REPEAT_TYPE_VALUES.join(",")}`,
      );
    }
    result.repeat_type = reminders.repeat_type;
  }

  if (reminders.repeat_until !== undefined) {
    result.repeat_until = validateNumber(reminders.repeat_until, "reminders.repeat_until", {
      min: 0,
    });
  }

  if (reminders.is_custom_repeat !== undefined) {
    if (![0, 1].includes(reminders.is_custom_repeat)) {
      throw new Error("reminders.is_custom_repeat 必须是 0 或 1");
    }
    result.is_custom_repeat = reminders.is_custom_repeat;
  }

  if (reminders.repeat_interval !== undefined) {
    result.repeat_interval = validateNumber(
      reminders.repeat_interval,
      "reminders.repeat_interval",
      { min: 1 },
    );
  }

  if (reminders.repeat_day_of_week !== undefined) {
    validateArray(reminders.repeat_day_of_week, "reminders.repeat_day_of_week");
    result.repeat_day_of_week = reminders.repeat_day_of_week.map((v: number, i: number) => {
      if (v < 1 || v > 7) throw new Error(`reminders.repeat_day_of_week[${i}] 必须是 1-7`);
      return v;
    });
  }

  if (reminders.repeat_day_of_month !== undefined) {
    validateArray(reminders.repeat_day_of_month, "reminders.repeat_day_of_month");
    result.repeat_day_of_month = reminders.repeat_day_of_month.map((v: number, i: number) => {
      if (v < 1 || v > 31) throw new Error(`reminders.repeat_day_of_month[${i}] 必须是 1-31`);
      return v;
    });
  }

  if (reminders.timezone !== undefined) {
    result.timezone = validateNumber(reminders.timezone, "reminders.timezone", {
      min: CALENDAR_LIMITS.TIMEZONE_MIN,
      max: CALENDAR_LIMITS.TIMEZONE_MAX,
    });
  }

  if (reminders.exclude_time_list !== undefined) {
    validateArray(reminders.exclude_time_list, "reminders.exclude_time_list");
    result.exclude_time_list = reminders.exclude_time_list.map((item: any, i: number) => ({
      start_time: validateNumber(item.start_time, `reminders.exclude_time_list[${i}].start_time`, {
        min: 0,
        required: true,
      }),
    }));
  }

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

async function parseResponse<T>(res: Response, label: string): Promise<T> {
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`${label}: 无效的 JSON 响应`);
  }

  if (!json || typeof json !== "object") {
    throw new Error(`${label}: 空响应`);
  }

  if (Array.isArray(json)) {
    const failed = json.find((i: any) => Number(i?.errcode ?? 0) !== 0);
    if (failed) throw new Error(`${label}: ${failed?.errmsg || "failed"} (${failed?.errcode})`);
    return json as T;
  }

  const errCode = Number(json.errcode ?? 0);
  if (errCode !== 0) {
    throw new Error(`${label}: ${json.errmsg || "failed"} (${errCode})`);
  }

  return json as T;
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

// ============================================================================
// WecomCalendarClient Class
// ============================================================================

export class WecomCalendarClient {
  private async post<T>(
    path: string,
    label: string,
    agent: ResolvedAgentAccount,
    body: any,
  ): Promise<T> {
    if (!agent?.corpId || !agent?.corpSecret) {
      throw new Error(`${label}: 账号配置不完整，需要 corpId 和 corpSecret`);
    }

    const token = await getAddonAccessToken(agent);
    const url = `${WECOM_API_BASE}${path}?access_token=${encodeURIComponent(token)}`;
    const proxyUrl = resolveAddonEgressProxyUrl(agent.network);

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await wecomFetch(
          url,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body || {}),
          },
          { proxyUrl, timeoutMs: WECOM_ADDON_LIMITS.requestTimeoutMs },
        );
        return await parseResponse<T>(res, label);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    throw lastError || new Error(`${label}: 请求失败`);
  }

  // ========================================================================
  // Calendar APIs
  // ========================================================================

  /**
   * 创建日历
   * POST /cgi-bin/oa/calendar/add
   */
  async createCalendar(p: {
    agent: ResolvedAgentAccount;
    request: CreateCalendarRequest;
  }): Promise<{ raw: CreateCalendarResponse; calId: string }> {
    const calendar = p.request.calendar;

    // 验证必填字段
    const summary = validateString(calendar.summary, "calendar.summary", {
      min: CALENDAR_LIMITS.SUMMARY_MIN_LENGTH,
      max: CALENDAR_LIMITS.SUMMARY_MAX_LENGTH,
    });
    const color = validateString(calendar.color, "calendar.color", {
      pattern: CALENDAR_LIMITS.COLOR_PATTERN,
    });

    // 验证可选字段
    const description =
      calendar.description !== undefined
        ? validateString(calendar.description, "calendar.description", {
            max: CALENDAR_LIMITS.DESCRIPTION_MAX_LENGTH,
            allowEmpty: true,
          })
        : undefined;

    const admins = validateCalendarAdmins(calendar.admins);
    const shares = validateCalendarShares(calendar.shares);
    const publicRange = validatePublicRange(calendar.public_range);

    if (calendar.set_as_default !== undefined && ![0, 1].includes(calendar.set_as_default)) {
      throw new Error("calendar.set_as_default 必须是 0 或 1");
    }
    if (calendar.is_public !== undefined && ![0, 1].includes(calendar.is_public)) {
      throw new Error("calendar.is_public 必须是 0 或 1");
    }
    if (calendar.is_corp_calendar !== undefined && ![0, 1].includes(calendar.is_corp_calendar)) {
      throw new Error("calendar.is_corp_calendar 必须是 0 或 1");
    }

    // 全员日历必须是公共日历且必须指定 public_range
    if (calendar.is_corp_calendar === 1) {
      if (calendar.is_public !== 1) {
        throw new Error("全员日历必须设置 is_public=1");
      }
      if (!publicRange || (!publicRange.userids && !publicRange.partyids)) {
        throw new Error("全员日历必须指定 public_range");
      }
    }

    const request: CreateCalendarRequest = {
      calendar: {
        summary,
        color: normalizeColor(color),
        description,
        admins,
        set_as_default: calendar.set_as_default,
        shares,
        is_public: calendar.is_public,
        public_range: publicRange,
        is_corp_calendar: calendar.is_corp_calendar,
      },
    };

    if (p.request.agentid !== undefined) {
      request.agentid = p.request.agentid;
    }

    const json = await this.post<CreateCalendarResponse>(
      "/cgi-bin/oa/calendar/add",
      "create_calendar",
      p.agent,
      request,
    );
    return { raw: json, calId: json.cal_id };
  }

  /**
   * 更新日历
   * POST /cgi-bin/oa/calendar/update
   * 注意：更新操作是覆盖式，不是增量式
   */
  async updateCalendar(p: {
    agent: ResolvedAgentAccount;
    request: UpdateCalendarRequest;
  }): Promise<{ raw: UpdateCalendarResponse; calId: string }> {
    const calendar = p.request.calendar;

    const calId = validateString(calendar.cal_id, "calendar.cal_id", { allowEmpty: false });
    const summary = validateString(calendar.summary, "calendar.summary", {
      min: CALENDAR_LIMITS.SUMMARY_MIN_LENGTH,
      max: CALENDAR_LIMITS.SUMMARY_MAX_LENGTH,
    });
    const color = validateString(calendar.color, "calendar.color", {
      pattern: CALENDAR_LIMITS.COLOR_PATTERN,
    });
    const description =
      calendar.description !== undefined
        ? validateString(calendar.description, "calendar.description", {
            max: CALENDAR_LIMITS.DESCRIPTION_MAX_LENGTH,
            allowEmpty: true,
          })
        : undefined;

    const admins = validateCalendarAdmins(calendar.admins);
    const shares = validateCalendarShares(calendar.shares);
    const publicRange = validatePublicRange(calendar.public_range);

    if (
      p.request.skip_public_range !== undefined &&
      ![0, 1].includes(p.request.skip_public_range)
    ) {
      throw new Error("skip_public_range 必须是 0 或 1");
    }

    const request: UpdateCalendarRequest = {
      calendar: {
        cal_id: calId,
        summary,
        color: normalizeColor(color),
        description,
        admins,
        shares,
        public_range: publicRange,
      },
      skip_public_range: p.request.skip_public_range,
    };

    const json = await this.post<UpdateCalendarResponse>(
      "/cgi-bin/oa/calendar/update",
      "update_calendar",
      p.agent,
      request,
    );
    return { raw: json, calId: calId };
  }

  /**
   * 获取日历详情
   * POST /cgi-bin/oa/calendar/get
   */
  async getCalendar(p: {
    agent: ResolvedAgentAccount;
    request: GetCalendarRequest;
  }): Promise<{ raw: GetCalendarResponse; calendarList: CalendarInfo[] }> {
    const calIdList = validateArray(p.request.cal_id_list, "cal_id_list", {
      min: 1,
      max: CALENDAR_LIMITS.CAL_ID_LIST_MAX,
      required: true,
    }).map((id, i) => validateString(id, `cal_id_list[${i}]`, { allowEmpty: false }));

    const request: GetCalendarRequest = { cal_id_list: calIdList };
    const json = await this.post<GetCalendarResponse>(
      "/cgi-bin/oa/calendar/get",
      "get_calendar",
      p.agent,
      request,
    );
    return { raw: json, calendarList: json.calendar_list || [] };
  }

  /**
   * 删除日历
   * POST /cgi-bin/oa/calendar/del
   */
  async deleteCalendar(p: {
    agent: ResolvedAgentAccount;
    calId: string;
  }): Promise<{ raw: DeleteCalendarResponse; calId: string }> {
    const calId = validateString(p.calId, "calId", { allowEmpty: false });
    const json = await this.post<DeleteCalendarResponse>(
      "/cgi-bin/oa/calendar/del",
      "delete_calendar",
      p.agent,
      { cal_id: calId },
    );
    return { raw: json, calId: calId };
  }

  // ========================================================================
  // System Calendar APIs
  // ========================================================================

  /**
   * 获取默认日历本 ID
   * POST /cgi-bin/oa/calendar/get_system_calid
   */
  async getSystemCalendarId(p: {
    agent: ResolvedAgentAccount;
    userid: string;
  }): Promise<{ raw: GetSystemCalendarIdResponse; calId: string }> {
    const userid = validateString(p.userid, "userid", { allowEmpty: false });
    const json = await this.post<GetSystemCalendarIdResponse>(
      "/cgi-bin/oa/calendar/get_system_calid",
      "get_system_calid",
      p.agent,
      { userid },
    );
    return { raw: json, calId: json.cal_id };
  }

  /**
   * 在默认日历本中创建日程
   * POST /cgi-bin/oa/schedule/add_schedule_in_system_cal
   */
  async createSystemSchedule(p: {
    agent: ResolvedAgentAccount;
    request: CreateSystemScheduleRequest;
  }): Promise<{ raw: CreateScheduleResponse; scheduleId: string }> {
    const schedule = p.request.schedule;

    const organizer = validateString(schedule.organizer, "schedule.organizer", {
      allowEmpty: false,
    });
    const startTime = validateNumber(schedule.start_time, "schedule.start_time", {
      min: 0,
      required: true,
    });
    const endTime = validateNumber(schedule.end_time, "schedule.end_time", {
      min: 0,
      required: true,
    });

    if (endTime <= startTime) {
      throw new Error("schedule.end_time 必须大于 schedule.start_time");
    }

    if (schedule.is_whole_day !== undefined && ![0, 1].includes(schedule.is_whole_day)) {
      throw new Error("schedule.is_whole_day 必须是 0 或 1");
    }

    const summary =
      schedule.summary !== undefined
        ? validateString(schedule.summary, "schedule.summary", {
            max: CALENDAR_LIMITS.SCHEDULE_SUMMARY_MAX_LENGTH,
            allowEmpty: true,
          })
        : undefined;

    const description =
      schedule.description !== undefined
        ? validateString(schedule.description, "schedule.description", {
            max: CALENDAR_LIMITS.SCHEDULE_DESCRIPTION_MAX_LENGTH,
            allowEmpty: true,
          })
        : undefined;

    const location =
      schedule.location !== undefined
        ? validateString(schedule.location, "schedule.location", {
            max: CALENDAR_LIMITS.SCHEDULE_LOCATION_MAX_LENGTH,
            allowEmpty: true,
          })
        : undefined;

    const attendees = validateScheduleAttendees(schedule.attendees);
    const reminders = validateReminders(schedule.reminders);

    const request: CreateSystemScheduleRequest = {
      schedule: {
        organizer,
        start_time: startTime,
        end_time: endTime,
        is_whole_day: schedule.is_whole_day,
        summary,
        description,
        location,
        attendees,
        reminders,
      },
    };

    const json = await this.post<CreateScheduleResponse>(
      "/cgi-bin/oa/schedule/add_schedule_in_system_cal",
      "create_system_schedule",
      p.agent,
      request,
    );
    return { raw: json, scheduleId: json.schedule_id };
  }
}
