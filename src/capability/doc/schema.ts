const accountIdProperty = {
  type: "string",
  minLength: 1,
  description: "可选：指定企业微信账号 ID；不填时按 agent 账号/默认账号自动选择",
};

const sheetIdProperty = {
  type: "string",
  minLength: 1,
  description: "子表 ID (sheet_id)",
};

const docIdProperty = {
  type: "string",
  minLength: 1,
  description: "文档 docid",
};

const formIdProperty = {
  type: "string",
  minLength: 1,
  description: "收集表 formid",
};

const shareUrlProperty = {
  type: "string",
  minLength: 1,
  description: "企业微信文档分享链接",
};

const genericObjectProperty = {
  type: "object",
  additionalProperties: true,
};

const nonEmptyObjectProperty = {
  ...genericObjectProperty,
  minProperties: 1,
};

// --- Form Statistics Schema ---

const formStatisticRequestSchema = {
  type: "object",
  required: ["req_type", "repeated_id"],
  properties: {
    req_type: {
      type: "integer",
      enum: [1, 2, 3],
      description:
        "统计类型：1-仅获取统计结果，2-获取已提交列表（需 start_time 和 end_time），3-获取未提交列表",
    },
    repeated_id: { type: "string", description: "收集表 repeated_id" },
    start_time: { type: "integer", description: "可选：开始时间戳（毫秒），req_type=2 时必填" },
    end_time: { type: "integer", description: "可选：结束时间戳（毫秒），req_type=2 时必填" },
    limit: { type: "integer", description: "可选：分页大小，最大 10000" },
    cursor: { type: "integer", description: "可选：分页游标" },
  },
};

const watermarkProperty = {
  type: "object",
  properties: {
    margin_type: {
      type: "integer",
      enum: [1, 2],
      description: "1:稀疏, 2:紧密",
    },
    show_visitor_name: { type: "boolean" },
    show_text: { type: "boolean" },
    text: { type: "string" },
  },
};

// --- Smartsheet Permission Schemas ---

const fieldRuleListSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["field_id", "can_edit", "can_insert", "can_view"],
    properties: {
      field_id: { type: "string" },
      field_type: { type: "string" },
      can_edit: { type: "boolean" },
      can_insert: { type: "boolean" },
      can_view: { type: "boolean" },
    },
  },
};

const fieldPrivSchema = {
  type: "object",
  required: ["field_range_type", "field_rule_list"],
  properties: {
    field_range_type: {
      type: "integer",
      enum: [1, 2],
      description: "1-所有字段；2-部分字段",
    },
    field_rule_list: fieldRuleListSchema,
    field_default_rule: {
      type: "object",
      properties: {
        can_edit: { type: "boolean" },
        can_insert: { type: "boolean" },
        can_view: { type: "boolean" },
      },
    },
  },
};

const recordRuleListSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["field_id", "oper_type"],
    properties: {
      field_id: { type: "string" },
      field_type: { type: "string" },
      oper_type: {
        type: "integer",
        description: "1-包含自己; 2-包含value; 3-不包含; 4-等于; 5-不等于; 6-为空; 7-非空",
      },
      value: { type: "array", items: { type: "string" } },
    },
  },
};

const recordPrivSchema = {
  type: "object",
  required: ["record_range_type"],
  properties: {
    record_range_type: {
      type: "integer",
      enum: [1, 2, 3],
      description: "1-全部; 2-任意条件; 3-全部条件",
    },
    record_rule_list: recordRuleListSchema,
    other_priv: {
      type: "integer",
      enum: [1, 2],
      description: "1-不可编辑; 2-不可查看",
    },
  },
};

const privListSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["sheet_id", "priv"],
    properties: {
      sheet_id: { type: "string" },
      priv: {
        oneOf: [{ type: "string" }, { type: "integer" }],
        description: "1-全部权限；2-可编辑；3-仅浏览；4-无权限",
      },
      can_insert_record: { type: "boolean" },
      can_delete_record: { type: "boolean" },
      can_create_modify_delete_view: { type: "boolean" },
      field_priv: fieldPrivSchema,
      record_priv: recordPrivSchema,
      clear: { type: "boolean" },
    },
  },
};

const memberRangeSchema = {
  type: "object",
  properties: {
    userid_list: { type: "array", items: { type: "string" } },
  },
};

export const wecomDocToolSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId"],
      properties: {
        action: { const: "copy" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        newName: {
          type: "string",
          minLength: 1,
          description: "可选：复制后的新文档名",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          description: "可选：目标空间 ID",
        },
        fatherId: {
          type: "string",
          minLength: 1,
          description: "可选：目标父目录 fileid",
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId"],
      properties: {
        action: { const: "share" },
        accountId: accountIdProperty,
        docId: docIdProperty,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId"],
      properties: {
        action: { const: "get_auth" },
        accountId: accountIdProperty,
        docId: docIdProperty,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "notified_scope_type"],
      properties: {
        action: { const: "mod_doc_member_notified_scope" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        notified_scope_type: {
          type: "integer",
          description: "通知范围类型：0-不通知，1-仅协作者，2-所有人",
        },
        notified_member_list: {
          type: "array",
          items: nonEmptyObjectProperty,
          description: "指定成员列表",
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId"],
      properties: {
        action: { const: "diagnose_auth" },
        accountId: accountIdProperty,
        docId: docIdProperty,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "shareUrl"],
      properties: {
        action: { const: "validate_share_link" },
        accountId: accountIdProperty,
        shareUrl: shareUrlProperty,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      anyOf: [{ required: ["docId"] }, { required: ["formId"] }],
      properties: {
        action: { const: "delete" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        formId: formIdProperty,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "request"],
      properties: {
        action: { const: "set_safety_setting" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        request: {
          type: "object",
          description: "mod_doc_safty_setting 请求体",
          additionalProperties: false,
          properties: {
            enable_readonly_copy: { type: "boolean", description: "是否允许只读成员复制、下载" },
            watermark: watermarkProperty,
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "formInfo"],
      properties: {
        action: { const: "create_form" },
        accountId: accountIdProperty,
        formInfo: {
          ...nonEmptyObjectProperty,
          description: "收集表 form_info 对象，至少应包含 form_title 等官方字段",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          description: "可选：文档空间 ID",
        },
        fatherId: {
          type: "string",
          minLength: 1,
          description: "可选：父目录 fileid",
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "oper", "formId", "formInfo"],
      properties: {
        action: { const: "modify_form" },
        accountId: accountIdProperty,
        oper: {
          type: "string",
          minLength: 1,
          description:
            "修改操作类型：1=全量修改问题，2=全量修改设置（按企业微信官方 modify_form 定义）",
        },
        formId: formIdProperty,
        formInfo: {
          ...nonEmptyObjectProperty,
          description: "收集表 form_info 对象",
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "formId"],
      properties: {
        action: { const: "get_form_info" },
        accountId: accountIdProperty,
        formId: formIdProperty,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "repeatedId"],
      properties: {
        action: { const: "get_form_answer" },
        accountId: accountIdProperty,
        repeatedId: {
          type: "string",
          minLength: 1,
          description: "收集表提交记录 repeated_id",
        },
        answerIds: {
          type: "array",
          description: "可选：答案 ID 列表",
          items: {
            type: "integer",
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "requests"],
      properties: {
        action: { const: "get_form_statistic" },
        accountId: accountIdProperty,
        requests: {
          type: "array",
          minItems: 1,
          description: "统计请求列表",
          items: formStatisticRequestSchema,
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "sheetId", "name"],
      properties: {
        action: { const: "smartsheet_add_group" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        sheetId: sheetIdProperty,
        name: { type: "string", description: "编组名称" },
        children: { type: "array", items: { type: "string" }, description: "字段 ID 列表" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "sheetId", "field_group_id"],
      properties: {
        action: { const: "smartsheet_del_group" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        sheetId: sheetIdProperty,
        field_group_id: { type: "string", description: "编组 ID" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "sheetId", "field_group_id"],
      properties: {
        action: { const: "smartsheet_update_group" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        sheetId: sheetIdProperty,
        field_group_id: { type: "string", description: "编组 ID" },
        name: { type: "string" },
        children: { type: "array", items: { type: "string" } },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "sheetId"],
      properties: {
        action: { const: "smartsheet_get_groups" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        sheetId: sheetIdProperty,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "sheetId", "records"],
      properties: {
        action: { const: "smartsheet_add_external_records" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        sheetId: sheetIdProperty,
        records: { type: "array", items: nonEmptyObjectProperty, description: "记录列表" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "sheetId", "records"],
      properties: {
        action: { const: "smartsheet_update_external_records" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        sheetId: sheetIdProperty,
        records: { type: "array", items: nonEmptyObjectProperty, description: "记录列表" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "type"],
      properties: {
        action: { const: "smartsheet_get_sheet_priv" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        type: { type: "integer", enum: [1, 2], description: "规则类型：1-全员权限，2-额外权限" },
        rule_id_list: { type: "array", items: { type: "integer" }, description: "规则 ID 列表" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "priv_list"],
      anyOf: [{ required: ["rule_id"] }, { required: ["name"] }],
      properties: {
        action: { const: "smartsheet_update_sheet_priv" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        type: {
          type: "integer",
          enum: [1, 2],
          description: "权限规则类型：1-全员权限，2-额外权限",
        },
        rule_id: { type: "integer", description: "当 type=2 时必填（额外权限规则 ID）" },
        name: { type: "string", description: "权限规则名称（仅 type=2 时有效）" },
        priv_list: privListSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "name"],
      properties: {
        action: { const: "smartsheet_create_rule" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        name: { type: "string", description: "权限规则名称" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "rule_id"],
      properties: {
        action: { const: "smartsheet_mod_rule_member" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        rule_id: { type: "integer" },
        add_member_range: memberRangeSchema,
        del_member_range: memberRangeSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "docId", "rule_id_list"],
      properties: {
        action: { const: "smartsheet_delete_rule" },
        accountId: accountIdProperty,
        docId: docIdProperty,
        rule_id_list: { type: "array", items: { type: "integer" }, description: "规则 ID 列表" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "userid_list"],
      properties: {
        action: { const: "doc_assign_advanced_account" },
        accountId: accountIdProperty,
        userid_list: { type: "array", items: { type: "string" }, description: "成员 ID 列表" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "userid_list"],
      properties: {
        action: { const: "doc_cancel_advanced_account" },
        accountId: accountIdProperty,
        userid_list: { type: "array", items: { type: "string" }, description: "成员 ID 列表" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { const: "doc_get_advanced_account_list" },
        accountId: accountIdProperty,
        cursor: { type: "integer", description: "分页游标（从 0 开始）" },
        limit: { type: "integer" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "file_path", "docId"],
      properties: {
        action: { const: "upload_doc_image" },
        accountId: accountIdProperty,
        docId: {
          ...docIdProperty,
          description: "文档 docid，上传图片需要关联文档",
        },
        file_path: { type: "string", description: "本地图片路径" },
      },
    },
  ],
} as const;
