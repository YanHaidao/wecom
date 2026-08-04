# OpenClaw 企业微信日历能力技能清单

> 本清单列出所有企业微信日历相关的 MCP Tools，按功能模块分类，方便 OpenClaw 直接调用。
> 
> **官方文档**: https://developer.work.weixin.qq.com/document/path/93329  
> **实现版本**: v2.3.16  
> **更新日期**: 2026-03-18

---

## 一、日历管理 (Calendar Management)

### 1.1 创建日历

```json
{
  "name": "wecom_calendar",
  "action": "calendar_create",
  "description": "在企业内创建一个日历，用于日程管理和共享",
  "parameters": {
    "summary": "必填：string，日历标题，1-128 字符",
    "color": "必填：string，RGB 颜色编码 16 进制表示，如 \"#0000FF\" 或 \"0000FF\"",
    "description": "可选：string，日历描述，0-512 字符",
    "admins": "可选：string[]，日历管理员 userid 列表，最多 3 人",
    "set_as_default": "可选：integer(0|1)，是否设为默认日历，0-否，1-是（默认 0，第三方应用不支持）",
    "shares": "可选：object[]，日历通知范围成员列表，最多 2000 人",
    "shares[].userid": "必填：string，日历通知范围成员的 id",
    "shares[].permission": "可选：integer(1|3)，权限（不填默认为可查看），1-可查看，3-仅查看闲忙状态",
    "is_public": "可选：integer(0|1)，是否公共日历，0-否，1-是（默认 0）",
    "public_range": "可选：object，公开范围（仅当是公共日历时有效）",
    "public_range.userids": "可选：string[]，公开的成员列表范围，最多 1000 个成员",
    "public_range.partyids": "可选：integer[]，公开的部门列表范围，最多 100 个部门",
    "is_corp_calendar": "可选：integer(0|1)，是否全员日历，0-否，1-是（默认 0）"
  },
  "returns": {
    "errcode": "integer，错误码（0 表示成功）",
    "errmsg": "string，错误码描述",
    "cal_id": "string，日历 ID",
    "fail_result": "可选：object，无效的输入内容",
    "fail_result.shares[]": "可选：object[]，无效的日历通知范围成员列表",
    "fail_result.shares[].errcode": "integer，错误码",
    "fail_result.shares[].errmsg": "string，错误码说明",
    "fail_result.shares[].userid": "string，日历通知范围成员的 id"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "calendar_create",
  "parameters": {
    "summary": "技术部项目日历",
    "color": "#4A90E2",
    "description": "技术部项目进度和会议安排",
    "admins": ["zhangsan", "lisi"],
    "shares": [
      {"userid": "wangwu", "permission": 1},
      {"userid": "zhaoliu", "permission": 3}
    ],
    "is_public": 1,
    "public_range": {
      "userids": ["zhangsan", "lisi", "wangwu"],
      "partyids": [12345]
    }
  }
}
```

**注意事项**:
- 全员日历（`is_corp_calendar=1`）必须同时满足：
  - `is_public=1`（全员日历也是公共日历的一种）
  - 必须指定 `public_range`（不能为空）
  - 不支持指定颜色、默认日历、只读权限
- 每个企业最多创建 20 个全员日历
- 每人最多创建或订阅 100 个公共日历
- `is_public` 和 `is_corp_calendar` 属性不可更新

---

### 1.2 更新日历

```json
{
  "name": "wecom_calendar",
  "action": "calendar_update",
  "description": "修改指定日历的信息（覆盖式更新，不是增量式）",
  "parameters": {
    "cal_id": "必填：string，日历 ID",
    "summary": "必填：string，日历标题，1-128 字符",
    "color": "必填：string，RGB 颜色编码 16 进制表示",
    "description": "可选：string，日历描述，0-512 字符",
    "admins": "可选：string[]，日历管理员 userid 列表，最多 3 人",
    "shares": "可选：object[]，日历通知范围成员列表，最多 2000 人",
    "shares[].userid": "必填：string，成员 id",
    "shares[].permission": "可选：integer(1|3)，权限（不填默认为可查看）",
    "public_range": "可选：object，公开范围（仅当是公共日历时有效）",
    "public_range.userids": "可选：string[]，公开的成员列表，最多 1000 个",
    "public_range.partyids": "可选：integer[]，公开的部门列表，最多 100 个",
    "skip_public_range": "可选：integer(0|1)，是否不更新可订阅范围，0-否（默认），1-是"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "fail_result": "可选：object，无效的输入内容"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "calendar_update",
  "parameters": {
    "cal_id": "wcjgewCwAAqeJcPI1d8Pwbjt7nttzAAA",
    "summary": "技术部项目日历（更新）",
    "color": "#FF5733",
    "description": "更新后的描述",
    "admins": ["zhangsan", "lisi", "wangwu"],
    "shares": [
      {"userid": "zhaoliu", "permission": 1}
    ],
    "skip_public_range": 1
  }
}
```

**注意事项**:
- 更新操作是**覆盖式**，不是增量式
- `is_public`、`is_corp_calendar` 属性不可更新
- `skip_public_range=0`（默认）会更新可订阅范围，`=1` 则不更新

---

### 1.3 获取日历详情

```json
{
  "name": "wecom_calendar",
  "action": "calendar_get",
  "description": "获取应用在企业内创建的日历信息",
  "parameters": {
    "cal_id_list": "必填：string[]，日历 ID 列表，调用创建日历接口后获得，一次最多 1000 条"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "calendar_list": "object[]，日历列表",
    "calendar_list[].cal_id": "string，日历 ID",
    "calendar_list[].admins": "string[]，日历的管理员 userid 列表",
    "calendar_list[].summary": "string，日历标题（1-128 字符）",
    "calendar_list[].color": "string，日历颜色（RGB 16 进制）",
    "calendar_list[].description": "string，日历描述（0-512 字符）",
    "calendar_list[].shares": "object[]，日历通知范围成员列表",
    "calendar_list[].shares[].userid": "string，成员 id",
    "calendar_list[].shares[].permission": "integer，权限（1-可查看，3-仅查看闲忙状态）",
    "calendar_list[].is_public": "integer，是否公共日历（0-否，1-是）",
    "calendar_list[].public_range": "object，公开范围",
    "calendar_list[].public_range.userids": "string[]，公开的成员列表",
    "calendar_list[].public_range.partyids": "integer[]，公开的部门列表",
    "calendar_list[].is_corp_calendar": "integer，是否全员日历（0-否，1-是）"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "calendar_get",
  "parameters": {
    "cal_id_list": [
      "wcjgewCwAAqeJcPI1d8Pwbjt7nttzAAA",
      "wcjgewCwAAqeJcPI1d8Pwbjt7nttzBBB"
    ]
  }
}
```

---

### 1.4 删除日历

```json
{
  "name": "wecom_calendar",
  "action": "calendar_delete",
  "description": "删除指定日历",
  "parameters": {
    "cal_id": "必填：string，日历 ID"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "calendar_delete",
  "parameters": {
    "cal_id": "wcjgewCwAAqeJcPI1d8Pwbjt7nttzAAA"
  }
}
```

---

## 二、日程管理 (Schedule Management)

### 2.1 创建日程

```json
{
  "name": "wecom_calendar",
  "action": "schedule_create",
  "description": "在日历中创建一个日程",
  "parameters": {
    "start_time": "必填：integer，日程开始时间，Unix 时间戳（秒）",
    "end_time": "必填：integer，日程结束时间，Unix 时间戳（秒）",
    "is_whole_day": "可选：integer(0|1)，是否全天日程，0-否（默认），1-是",
    "summary": "可选：string，日程标题，0-128 字符（不填默认显示为\"新建事件\"）",
    "description": "可选：string，日程描述，不多于 1000 字符",
    "location": "可选：string，日程地址，不多于 128 字符",
    "attendees": "可选：object[]，日程参与者列表，最多 1000 人",
    "attendees[].userid": "必填：string，日程参与者 ID，不多于 64 字节",
    "admins": "可选：string[]，日程管理员 userid 列表，最多 3 人（管理员必须在共享成员列表中）",
    "reminders": "可选：object，提醒相关信息",
    "reminders.is_remind": "可选：integer(0|1)，是否需要提醒，0-否（默认），1-是",
    "reminders.is_repeat": "可选：integer(0|1)，是否重复日程，0-否（默认），1-是",
    "reminders.remind_before_event_secs": "可选：integer，日程开始前多少秒提醒（当 is_remind=1 时有效），仅支持：0(事件开始时),300(5 分钟),900(15 分钟),3600(1 小时),86400(1 天)",
    "reminders.remind_time_diffs": "可选：integer[]，提醒时间与日程开始时间的差值数组（当 is_remind=1 时有效），优先于 remind_before_event_secs，仅支持：0,-300,-900,-3600,-86400,32400(全天日程当天 09:00),-172800(全天日程前 2 天),-604800(全天日程前 1 周)",
    "reminders.repeat_type": "可选：integer，重复类型（当 is_repeat=1 时有效），0-每日，1-每周，2-每月，5-每年，7-工作日",
    "reminders.repeat_until": "可选：integer，重复结束时刻，Unix 时间戳（当 is_repeat=1 时有效，不填或 0 表示一直重复）",
    "reminders.is_custom_repeat": "可选：integer(0|1)，是否自定义重复（当 is_repeat=1 时有效），0-否（默认，系统自动计算），1-是（配合 repeat_day_of_week/repeat_day_of_month 使用）",
    "reminders.repeat_interval": "可选：integer，重复间隔（仅当 is_custom_repeat=1 时有效），随 repeat_type 不同含义不同（如 repeat_type=1 每周时，3 表示每 3 周）",
    "reminders.repeat_day_of_week": "可选：integer[]，每周周几重复（仅当 is_custom_repeat=1 且 repeat_type=1 时有效），取值 1-7（周一至周日）",
    "reminders.repeat_day_of_month": "可选：integer[]，每月哪几天重复（仅当 is_custom_repeat=1 且 repeat_type=2 时有效），取值 1-31",
    "reminders.timezone": "可选：integer，时区，UTC 偏移量（-12 到 +12），默认 +8（北京时间东八区）",
    "cal_id": "可选：string，日程所属日历 ID（第三方应用必须指定），不多于 64 字节"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "schedule_id": "string，日程 ID"
  }
}
```

**使用示例** - 创建单次日程:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_create",
  "parameters": {
    "start_time": 1710835200,
    "end_time": 1710838800,
    "summary": "项目评审会议",
    "description": "Q1 项目进度评审",
    "location": "10 楼 1005 会议室",
    "attendees": [
      {"userid": "zhangsan"},
      {"userid": "lisi"}
    ],
    "cal_id": "wcjgewCwAAqeJcPI1d8Pwbjt7nttzAAA",
    "reminders": {
      "is_remind": 1,
      "remind_time_diffs": [-3600, -300],
      "timezone": 8
    }
  }
}
```

**使用示例** - 创建重复日程（每周三例会）:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_create",
  "parameters": {
    "start_time": 1710835200,
    "end_time": 1710838800,
    "summary": "每周三例会",
    "reminders": {
      "is_remind": 1,
      "remind_before_event_secs": 3600,
      "is_repeat": 1,
      "is_custom_repeat": 1,
      "repeat_type": 1,
      "repeat_interval": 1,
      "repeat_day_of_week": [3],
      "repeat_until": 1735689600,
      "timezone": 8
    }
  }
}
```

**注意事项**:
- `end_time` 必须大于 `start_time`
- `remind_time_diffs` 与 `remind_before_event_secs` 仅一个字段会生效，当 `remind_time_diffs` 有传值且列表不为空时，优先以 `remind_time_diffs` 为准
- 第三方应用必须指定 `cal_id`
- 管理员必须在共享成员（attendees）的列表中

---

### 2.2 更新日程

```json
{
  "name": "wecom_calendar",
  "action": "schedule_update",
  "description": "在日历中更新指定的日程（覆盖式更新，不是增量式）",
  "parameters": {
    "schedule_id": "必填：string，日程 ID（创建日程时返回的 ID）",
    "start_time": "必填：integer，日程开始时间，Unix 时间戳",
    "end_time": "必填：integer，日程结束时间，Unix 时间戳",
    "is_whole_day": "可选：integer(0|1)，是否全天日程，0-否，1-是",
    "summary": "可选：string，日程标题，0-128 字符",
    "description": "可选：string，日程描述，不多于 1000 字符",
    "location": "可选：string，日程地址，不多于 128 字符",
    "attendees": "可选：object[]，日程参与者列表，最多 1000 人",
    "attendees[].userid": "必填：string，参与者 ID",
    "admins": "可选：string[]，日程管理员，最多 3 人",
    "reminders": "可选：object，提醒相关信息（参数同 schedule_create）",
    "skip_attendees": "可选：integer(0|1)，是否不更新参与人，0-否（默认），1-是",
    "op_mode": "可选：integer，操作模式（是重复日程时有效），0-默认全部修改，1-仅修改此日程，2-修改将来的所有日程",
    "op_start_time": "可选：integer，操作起始时间，Unix 时间戳（仅当 op_mode=1 或 2 时有效，必须是重复日程的某一次开始时间）"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "schedule_id": "string，日程 ID（修改重复日程时，如果不是修改全部周期，会返回新日程的 ID）"
  }
}
```

**使用示例** - 修改全部周期:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_update",
  "parameters": {
    "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA",
    "start_time": 1710842400,
    "end_time": 1710846000,
    "summary": "项目评审会议（时间变更）",
    "location": "10 楼 1006 会议室",
    "op_mode": 0
  }
}
```

**使用示例** - 仅修改单次（临时调整）:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_update",
  "parameters": {
    "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA",
    "op_mode": 1,
    "op_start_time": 1710835200,
    "start_time": 1710842400,
    "end_time": 1710846000,
    "summary": "项目评审会议（临时调整）",
    "location": "10 楼 1006 会议室"
  }
}
```

**注意事项**:
- 更新操作是**覆盖式**，不是增量式
- 不可更新创建者和日程所属日历 ID
- 已预约会议室的日程无法通过此接口更新（跟会议室关联的字段包括：start_time, end_time, is_whole_day, is_repeat, repeat_type, repeat_until, is_custom_repeat, repeat_interval, repeat_day_of_week, repeat_day_of_month, timezone）
- `op_mode=1` 时，分裂出的新日程只能是单次日程，不支持指定为重复日程（`is_repeat` 不能为 1）
- 如果 `op_mode` 是 1 或 2，`start_time` 和 `end_time` 必须是 `op_start_time` 当天或之后的时间

---

### 2.3 新增日程参与者

```json
{
  "name": "wecom_calendar",
  "action": "schedule_add_attendees",
  "description": "在日历中增量式添加日程参与者",
  "parameters": {
    "schedule_id": "必填：string，日程 ID",
    "attendees": "必填：object[]，日程参与者列表，累计最多 1000 人",
    "attendees[].userid": "必填：string，日程参与者 ID，不多于 64 字节"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_add_attendees",
  "parameters": {
    "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA",
    "attendees": [
      {"userid": "wangwu"},
      {"userid": "zhaoliu"}
    ]
  }
}
```

---

### 2.4 删除日程参与者

```json
{
  "name": "wecom_calendar",
  "action": "schedule_del_attendees",
  "description": "在日历中增量式删除日程参与者",
  "parameters": {
    "schedule_id": "必填：string，日程 ID",
    "attendees": "必填：object[]，日程参与者列表，最多 1000 人",
    "attendees[].userid": "必填：string，日程参与者 ID"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_del_attendees",
  "parameters": {
    "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA",
    "attendees": [
      {"userid": "zhaoliu"}
    ]
  }
}
```

---

### 2.5 获取日历下的日程列表

```json
{
  "name": "wecom_calendar",
  "action": "schedule_get_by_calendar",
  "description": "获取指定日历下的日程列表（仅可获取应用自己创建的日历下的日程）",
  "parameters": {
    "cal_id": "必填：string，日历 ID",
    "offset": "可选：integer，分页偏移量，默认 0",
    "limit": "可选：integer，分页大小，默认 500，取值范围 1-1000"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "schedule_list": "object[]，日程列表",
    "schedule_list[].schedule_id": "string，日程 ID",
    "schedule_list[].sequence": "integer，日程编号（自增数字）",
    "schedule_list[].admins": "string[]，管理员 userid 列表",
    "schedule_list[].attendees": "object[]，参与者列表",
    "schedule_list[].attendees[].userid": "string，参与者 ID",
    "schedule_list[].attendees[].response_status": "integer，响应状态（0-未处理，1-待定，2-全部接受，3-仅接受一次，4-拒绝）",
    "schedule_list[].summary": "string，日程标题",
    "schedule_list[].description": "string，日程描述",
    "schedule_list[].reminders": "object，提醒信息",
    "schedule_list[].location": "string，日程地址",
    "schedule_list[].start_time": "integer，开始时间",
    "schedule_list[].end_time": "integer，结束时间",
    "schedule_list[].status": "integer，日程状态（0-正常，1-已取消）",
    "schedule_list[].cal_id": "string，所属日历 ID"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_get_by_calendar",
  "parameters": {
    "cal_id": "wcjgewCwAAqeJcPI1d8Pwbjt7nttzAAA",
    "offset": 0,
    "limit": 100
  }
}
```

**分页说明**:
- 当 `schedule_list` 为空时，表示 offset 过大，应终止获取
- 若有新增日程，可在此基础上继续增量获取

---

### 2.6 获取日程详情

```json
{
  "name": "wecom_calendar",
  "action": "schedule_get",
  "description": "获取指定日程的详细信息",
  "parameters": {
    "schedule_id_list": "必填：string[]，日程 ID 列表，一次最多 1000 条"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "schedule_list": "object[]，日程列表",
    "schedule_list[].schedule_id": "string，日程 ID",
    "schedule_list[].admins": "string[]，管理员 userid 列表",
    "schedule_list[].attendees": "object[]，参与者列表",
    "schedule_list[].attendees[].userid": "string，参与者 ID",
    "schedule_list[].attendees[].response_status": "integer，响应状态",
    "schedule_list[].summary": "string，日程标题",
    "schedule_list[].description": "string，日程描述",
    "schedule_list[].reminders": "object，提醒信息（含 exclude_time_list）",
    "schedule_list[].reminders.exclude_time_list": "可选：object[]，重复日程不包含的日期列表",
    "schedule_list[].reminders.exclude_time_list[].start_time": "integer，不包含的日期时间戳",
    "schedule_list[].location": "string，日程地址",
    "schedule_list[].start_time": "integer，开始时间",
    "schedule_list[].end_time": "integer，结束时间",
    "schedule_list[].status": "integer，日程状态（0-正常，1-已取消）",
    "schedule_list[].is_whole_day": "integer，是否全天日程",
    "schedule_list[].cal_id": "string，所属日历 ID",
    "meeting_code": "可选：string，会议码",
    "meeting_link": "可选：string，会议链接"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_get",
  "parameters": {
    "schedule_id_list": [
      "17c7d2bd9f20d652840f72f59e796AAA",
      "17c7d2bd9f20d652840f72f59e796BBB"
    ]
  }
}
```

**注意事项**:
- 被取消的日程（`status=1`）也可以拉取详情，调用者需要检查 `status`

---

### 2.7 取消日程

```json
{
  "name": "wecom_calendar",
  "action": "schedule_delete",
  "description": "取消指定的日程",
  "parameters": {
    "schedule_id": "必填：string，日程 ID",
    "op_mode": "可选：integer，操作模式（是重复日程时有效），0-默认删除所有日程，1-仅删除此日程，2-删除本次及后续日程",
    "op_start_time": "可选：integer，操作起始时间，Unix 时间戳（仅当 op_mode=1 或 2 时有效，必须是重复日程的某一次开始时间）"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述"
  }
}
```

**使用示例** - 删除所有周期:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_delete",
  "parameters": {
    "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA",
    "op_mode": 0
  }
}
```

**使用示例** - 仅删除单次:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_delete",
  "parameters": {
    "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA",
    "op_mode": 1,
    "op_start_time": 1710835200
  }
}
```

---

### 2.8 日程回执

```json
{
  "name": "wecom_calendar",
  "action": "schedule_respond",
  "description": "更新日程参与人的回执状态",
  "parameters": {
    "schedule_id": "必填：string，日程 ID",
    "op_mode": "可选：integer，操作模式（是重复日程时有效），0-默认全部修改，1-仅修改此日程，2-修改将来的所有日程",
    "op_start_time": "可选：integer，操作起始时间，Unix 时间戳（仅当 op_mode=1 或 2 时有效）",
    "attendee": "必填：string，日程参与者 userid",
    "response_status": "必填：integer，日程参与者的接受状态，1-待定，2-接受，4-拒绝"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_respond",
  "parameters": {
    "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA",
    "attendee": "zhangsan",
    "response_status": 2
  }
}
```

---

### 2.9 同步日程

```json
{
  "name": "wecom_calendar",
  "action": "schedule_sync",
  "description": "同步日历下的日程（支持增量同步）",
  "parameters": {
    "cal_id": "必填：string，日历 ID",
    "cursor": "可选：string，分页游标（首次不填）",
    "limit": "可选：integer，分页大小，取值范围 1-1000"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "schedule_list": "object[]，日程列表",
    "next_cursor": "string，下次同步的游标（为空表示无更多）"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_sync",
  "parameters": {
    "cal_id": "wcjgewCwAAqeJcPI1d8Pwbjt7nttzAAA",
    "limit": 100
  }
}
```

---

## 三、默认日历本管理 (System Calendar Management)

### 3.1 获取默认日历本 ID

```json
{
  "name": "wecom_calendar",
  "action": "schedule_get_system_calid",
  "description": "获取指定成员的默认日历本 ID（系统初始生成的\"xx 的日历\"）",
  "parameters": {
    "userid": "必填：string，指定成员的 userid"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "cal_id": "string，默认日历本 ID"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_get_system_calid",
  "parameters": {
    "userid": "zhangsan"
  }
}
```

**注意事项**:
- 此处「默认日历本」特指系统为用户初始生成的日历本"xx 的日历"
- 用户在客户端日程设置中修改「默认日历」不会影响此接口

---

### 3.2 在默认日历本创建日程

```json
{
  "name": "wecom_calendar",
  "action": "schedule_create_in_system",
  "description": "在用户默认日历本中创建日程（组织者显示为传入的 userid）",
  "parameters": {
    "organizer": "必填：string，日程的创建者 userid",
    "start_time": "必填：integer，日程开始时间，Unix 时间戳",
    "end_time": "必填：integer，日程结束时间，Unix 时间戳",
    "is_whole_day": "可选：integer(0|1)，是否全天日程，0-否，1-是",
    "summary": "可选：string，日程标题，0-128 字符",
    "description": "可选：string，日程描述，不多于 1000 字符",
    "location": "可选：string，日程地址，不多于 128 字符",
    "attendees": "可选：object[]，日程参与者列表，最多 1000 人",
    "attendees[].userid": "必填：string，参与者 ID",
    "reminders": "可选：object，提醒相关信息（参数同 schedule_create）"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "schedule_id": "string，日程 ID"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_calendar",
  "action": "schedule_create_in_system",
  "parameters": {
    "organizer": "zhangsan",
    "start_time": 1710835200,
    "end_time": 1710838800,
    "summary": "个人待办事项",
    "attendees": [
      {"userid": "lisi"}
    ],
    "reminders": {
      "is_remind": 1,
      "remind_time_diffs": [-3600]
    }
  }
}
```

**注意事项**:
- 此接口创建的日程，组织者将以接口传入的"创建者 userid"身份展示，而非应用身份
- 不可更新创建者

---

## 四、快速参考 (Quick Reference)

### 4.1 接口限制

| 限制项 | 限制值 |
|--------|--------|
| 日历管理员数量 | 最多 3 人 |
| 日历通知范围成员 | 最多 2000 人 |
| 公开成员列表 | 最多 1000 个 |
| 公开部门列表 | 最多 100 个 |
| 日程参与者 | 最多 1000 人 |
| 日程标题长度 | 0-128 字符 |
| 日程描述长度 | 0-1000 字符 |
| 日程地址长度 | 0-128 字符 |
| 日历标题长度 | 1-128 字符 |
| 日历描述长度 | 0-512 字符 |
| 一次获取日历数量 | 最多 1000 个 |
| 一次获取日程数量 | 最多 1000 个 |
| 每个企业公共日历 | 3 万个 |
| 每个应用日历本 | 1 万个 |
| 每人共享日历 | 100 个 |
| 每应用每天创建日程 | 2 万个 |
| 全员日历 | 20 个 |

### 4.2 枚举值对照表

#### 权限类型 (`permission`)
| 值 | 说明 |
|----|------|
| 1 | 可查看 |
| 3 | 仅查看闲忙状态 |

#### 提醒时间 (`remind_before_event_secs`)
| 值 | 说明 |
|----|------|
| 0 | 事件开始时 |
| 300 | 事件开始前 5 分钟 |
| 900 | 事件开始前 15 分钟 |
| 3600 | 事件开始前 1 小时 |
| 86400 | 事件开始前 1 天 |

#### 提醒时间差值 (`remind_time_diffs`)
| 值 | 说明 |
|----|------|
| 0 | 事件开始时 |
| -300 | 事件开始前 5 分钟 |
| -900 | 事件开始前 15 分钟 |
| -3600 | 事件开始前 1 小时 |
| -86400 | 事件开始前 1 天 |
| 32400 | 事件开始当天 09:00（仅全天日程） |
| -172800 | 事件开始前 2 天（仅全天日程） |
| -604800 | 事件开始前 1 周（仅全天日程） |

#### 重复类型 (`repeat_type`)
| 值 | 说明 |
|----|------|
| 0 | 每日 |
| 1 | 每周 |
| 2 | 每月 |
| 5 | 每年 |
| 7 | 工作日 |

#### 操作模式 (`op_mode`)
| 值 | 说明 |
|----|------|
| 0 | 全部修改/删除（默认） |
| 1 | 仅修改/删除此日程 |
| 2 | 修改/删除将来的所有日程 |

#### 响应状态 (`response_status`)
| 值 | 说明 |
|----|------|
| 0 | 未处理 |
| 1 | 待定 |
| 2 | 全部接受 |
| 3 | 仅接受一次 |
| 4 | 拒绝 |

#### 日程状态 (`status`)
| 值 | 说明 |
|----|------|
| 0 | 正常 |
| 1 | 已取消 |

---

## 五、错误处理 (Error Handling)

### 常见错误码

| errcode | 说明 | 处理方式 |
|---------|------|----------|
| 0 | 成功 | - |
| 40001 | 凭证无效/成员不存在 | 检查 access_token 或 userid |
| 40003 | 参数类型错误 | 检查参数格式 |
| 40066 | 参数不合法 | 检查参数值范围 |
| 41013 | 日程 ID 无效 | 检查 schedule_id |
| 41015 | 日历 ID 无效 | 检查 cal_id |
| 41020 | 参与者数量超限 | 减少 attendees |
| 41021 | 日程时间冲突 | 调整时间 |
| 90482 | op_start_time 无效 | 检查是否为重复日程的某次开始时间 |
| 90484 | 重复日程模式错误 | op_mode=1 时不能设置 is_repeat=1 |
| 90485 | 非重复日程不能指定 op_mode | 移除 op_mode 参数 |

---

## 六、回调事件 (Callback Events)

应用创建日历和日程后，以下事件会推送到配置的回调 URL：

| 事件类型 | 说明 | 回调数据 |
|----------|------|----------|
| `delete_calendar` | 删除日历 | CalId |
| `modify_calendar` | 修改日历 | CalId |
| `modify_schedule` | 修改日程 | CalId, ScheduleId |
| `delete_schedule` | 删除日程 | CalId, ScheduleId |
| `respond_schedule` | 日程回执 | CalId, ScheduleId, FromUserName |
| `add_schedule` | 添加日程 | CalId, ScheduleId |

---

**文档版本**: 2026-03-18  
**适用版本**: OpenClaw WeChat Plugin v2.3.16+  
**官方文档**: 企业微信开放平台 - 日历 API
