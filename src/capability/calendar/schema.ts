// ============================================================================
// Calendar Schema (日历 JSON Schema 定义)
// 完整参考企业微信官方 API 文档：https://developer.work.weixin.qq.com/document/path/93329
// 所有参数验证规则严格遵循官方文档要求
// ============================================================================

const accountIdProperty = {
  type: "string",
  minLength: 1,
  description: "可选：指定企业微信账号 ID",
};

// --- Calendar Properties ---

const calendarSummaryProperty = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "日历标题，1-128 字符",
};

const calendarColorProperty = {
  type: "string",
  pattern: "^#?[0-9A-Fa-f]{6}$",
  description: "日历颜色，RGB 十六进制格式，如 #FF3030 或 FF3030",
};

const calendarDescriptionProperty = {
  type: "string",
  minLength: 0,
  maxLength: 512,
  description: "日历描述，0-512 字符",
};

const calendarAdminsProperty = {
  type: "array",
  minItems: 1,
  maxItems: 3,
  items: { type: "string", minLength: 1 },
  description: "日历管理员 userid 列表，最多 3 人",
};

const calendarSharesEntrySchema = {
  type: "object",
  required: ["userid"],
  properties: {
    userid: { type: "string", minLength: 1, maxLength: 64, description: "成员 userid" },
    permission: { type: "integer", enum: [1, 3], description: "1:可查看，3:仅查看闲忙状态" },
  },
};

const calendarSharesProperty = {
  type: "array",
  minItems: 1,
  maxItems: 2000,
  items: calendarSharesEntrySchema,
  description: "日历通知范围成员列表，最多 2000 人",
};

const calendarPublicRangeProperty = {
  type: "object",
  properties: {
    userids: {
      type: "array",
      minItems: 1,
      maxItems: 1000,
      items: { type: "string" },
      description: "公开的成员列表，最多 1000 个",
    },
    partyids: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "integer" },
      description: "公开的部门列表，最多 100 个",
    },
  },
};

// --- Schedule Properties ---

const scheduleTimeProperty = {
  type: "integer",
  minimum: 0,
  description: "Unix 时间戳（秒）",
};

const scheduleAttendeeSchema = {
  type: "object",
  required: ["userid"],
  properties: {
    userid: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "日程参与者 ID，不多于 64 字节",
    },
  },
};

const scheduleAttendeesProperty = {
  type: "array",
  minItems: 1,
  maxItems: 1000,
  items: scheduleAttendeeSchema,
  description: "日程参与者列表，最多 1000 人",
};

const scheduleSummaryProperty = {
  type: "string",
  minLength: 0,
  maxLength: 128,
  description: "日程标题，0-128 字符，不填默认显示为新建事件",
};

const scheduleDescriptionProperty = {
  type: "string",
  minLength: 0,
  maxLength: 1000,
  description: "日程描述，不多于 1000 字符",
};

const scheduleLocationProperty = {
  type: "string",
  minLength: 0,
  maxLength: 128,
  description: "日程地址，不多于 128 字符",
};

// 官方严格限定的提醒时间枚举值
const scheduleRemindersSchema = {
  type: "object",
  properties: {
    is_remind: { type: "integer", enum: [0, 1], description: "是否需要提醒，0-否，1-是" },
    is_repeat: { type: "integer", enum: [0, 1], description: "是否重复日程，0-否，1-是" },
    remind_before_event_secs: {
      type: "integer",
      enum: [0, 300, 900, 3600, 86400],
      description:
        "日程开始前多少秒提醒，仅支持：0(事件开始时),300(5 分钟),900(15 分钟),3600(1 小时),86400(1 天)。当 is_remind=1 时有效",
    },
    remind_time_diffs: {
      type: "array",
      items: {
        type: "integer",
        enum: [0, -300, -900, -3600, -86400, 32400, -172800, -604800],
        description:
          "提醒时间差值（秒）：0(事件开始时),-300(-5 分钟),-900(-15 分钟),-3600(-1 小时),-86400(-1 天),32400(当天 09:00),-172800(-2 天),-604800(-1 周)",
      },
      description: "提醒时间与日程开始时间的差值列表，仅支持特定枚举值",
    },
    repeat_type: {
      type: "integer",
      enum: [0, 1, 2, 5, 7],
      description: "重复类型：0-每日，1-每周，2-每月，5-每年，7-工作日。仅当 is_repeat=1 时有效",
    },
    repeat_until: {
      type: "integer",
      minimum: 0,
      description: "重复结束时刻，Unix 时间戳，0 或不填表示一直重复。仅当 is_repeat=1 时有效",
    },
    is_custom_repeat: {
      type: "integer",
      enum: [0, 1],
      description: "是否自定义重复，0-否，1-是。仅当 is_repeat=1 时有效",
    },
    repeat_interval: {
      type: "integer",
      minimum: 1,
      description:
        "重复间隔。仅当 is_custom_repeat=1 时有效。含义随 repeat_type 不同而不同（如 repeat_type=1 每周时，3 表示每 3 周）",
    },
    repeat_day_of_week: {
      type: "array",
      items: { type: "integer", minimum: 1, maximum: 7 },
      description:
        "每周周几重复，1-7（周一至周日）。仅当 is_custom_repeat=1 且 repeat_type=1(每周) 时有效",
    },
    repeat_day_of_month: {
      type: "array",
      items: { type: "integer", minimum: 1, maximum: 31 },
      description: "每月哪几天重复，1-31。仅当 is_custom_repeat=1 且 repeat_type=2(每月) 时有效",
    },
    timezone: {
      type: "integer",
      minimum: -12,
      maximum: 12,
      description: "时区，UTC 偏移量，-12 到 +12，默认为北京时间东八区 (+8)",
    },
  },
};

// ============================================================================
// Calendar Action Schemas (4 个)
// ============================================================================

const calendarCreateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "summary", "color"],
  properties: {
    action: { const: "calendar_create" },
    accountId: accountIdProperty,
    summary: calendarSummaryProperty,
    color: calendarColorProperty,
    description: calendarDescriptionProperty,
    admins: calendarAdminsProperty,
    set_as_default: {
      type: "integer",
      enum: [0, 1],
      description: "是否将该日历设为默认日历，0-否，1-是（第三方应用不支持）",
    },
    shares: calendarSharesProperty,
    is_public: { type: "integer", enum: [0, 1], description: "是否公共日历，0-否，1-是" },
    public_range: calendarPublicRangeProperty,
    is_corp_calendar: { type: "integer", enum: [0, 1], description: "是否全员日历，0-否，1-是" },
  },
};

const calendarUpdateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "cal_id", "summary", "color"],
  properties: {
    action: { const: "calendar_update" },
    accountId: accountIdProperty,
    cal_id: { type: "string", minLength: 1, description: "日历 ID" },
    skip_public_range: {
      type: "integer",
      enum: [0, 1],
      description: "是否不更新可订阅范围，0-否，1-是",
    },
    summary: calendarSummaryProperty,
    color: calendarColorProperty,
    description: calendarDescriptionProperty,
    admins: calendarAdminsProperty,
    shares: calendarSharesProperty,
    public_range: calendarPublicRangeProperty,
  },
};

const calendarGetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "cal_id_list"],
  properties: {
    action: { const: "calendar_get" },
    accountId: accountIdProperty,
    cal_id_list: {
      type: "array",
      minItems: 1,
      maxItems: 1000,
      items: { type: "string", minLength: 1 },
      description: "日历 ID 列表，一次最多 1000 条",
    },
  },
};

const calendarDeleteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "cal_id"],
  properties: {
    action: { const: "calendar_delete" },
    accountId: accountIdProperty,
    cal_id: { type: "string", minLength: 1, description: "日历 ID" },
  },
};

// ============================================================================
// System Calendar Action Schemas (2 个)
// ============================================================================

const scheduleGetSystemCalidSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "userid"],
  properties: {
    action: { const: "schedule_get_system_calid" },
    accountId: accountIdProperty,
    userid: { type: "string", minLength: 1, description: "指定成员的 userid" },
  },
};

const scheduleCreateInSystemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "organizer", "start_time", "end_time"],
  properties: {
    action: { const: "schedule_create_in_system" },
    accountId: accountIdProperty,
    organizer: { type: "string", minLength: 1, description: "日程创建者 userid" },
    start_time: scheduleTimeProperty,
    end_time: scheduleTimeProperty,
    is_whole_day: { type: "integer", enum: [0, 1] },
    summary: scheduleSummaryProperty,
    description: scheduleDescriptionProperty,
    location: scheduleLocationProperty,
    attendees: scheduleAttendeesProperty,
    reminders: scheduleRemindersSchema,
  },
};

// ============================================================================
// Export Schema
// ============================================================================

export const wecomCalendarToolSchema = {
  oneOf: [
    calendarCreateSchema,
    calendarUpdateSchema,
    calendarGetSchema,
    calendarDeleteSchema,
    scheduleGetSystemCalidSchema,
    scheduleCreateInSystemSchema,
  ],
};
