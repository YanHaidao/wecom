import { getAddonAccessToken } from "../../addon/access-token.js";
import {
  resolveAddonEgressProxyUrl,
  type WecomAddonAgentAccount,
} from "../../addon/agent-account.js";
import { WECOM_ADDON_LIMITS, WECOM_API_BASE } from "../../addon/api-constants.js";
import { wecomFetch } from "../../http.js";

type ResolvedAgentAccount = WecomAddonAgentAccount;

function readString(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function parseJsonResponse(res: Response, actionLabel: string): Promise<any> {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`WeCom ${actionLabel} failed: HTTP ${res.status}`);
    }
    throw new Error(`WeCom ${actionLabel} failed: invalid JSON response`);
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(`WeCom ${actionLabel} failed: empty response`);
  }
  if (!res.ok) {
    throw new Error(`WeCom ${actionLabel} failed: HTTP ${res.status} ${JSON.stringify(payload)}`);
  }
  if (Array.isArray(payload)) {
    const failedItem = payload.find((item) => Number(item?.errcode ?? 0) !== 0);
    if (failedItem) {
      throw new Error(
        `WeCom ${actionLabel} failed: ${String(failedItem?.errmsg || "unknown error")} (errcode ${String(failedItem?.errcode)})`,
      );
    }
    return payload;
  }
  if (Number(payload.errcode ?? 0) !== 0) {
    throw new Error(
      `WeCom ${actionLabel} failed: ${String(payload.errmsg || "unknown error")} (errcode ${String(payload.errcode)})`,
    );
  }
  return payload;
}

export class WecomDocClient {
  private async postWecomDocApi(params: {
    path: string;
    actionLabel: string;
    agent: ResolvedAgentAccount;
    body: Record<string, unknown> | unknown[];
  }): Promise<any> {
    const { path, actionLabel, agent, body } = params;

    const token = await getAddonAccessToken(agent);
    const url = `${WECOM_API_BASE}${path}?access_token=${encodeURIComponent(token)}`;
    const proxyUrl = resolveAddonEgressProxyUrl(agent.network);

    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await wecomFetch(
          url,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(body ?? {}),
          },
          { proxyUrl, timeoutMs: WECOM_ADDON_LIMITS.requestTimeoutMs },
        );

        return await parseJsonResponse(res, actionLabel);
      } catch (err) {
        lastErr = err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    throw lastErr;
  }

  async copyDoc(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    newName?: string;
    spaceId?: string;
    fatherId?: string;
  }) {
    const { agent, docId, newName, spaceId, fatherId } = params;
    const payload: Record<string, unknown> = {
      docid: readString(docId),
    };
    if (!payload.docid) throw new Error("docId required");
    if (newName) payload.new_name = readString(newName);
    if (spaceId) payload.spaceid = readString(spaceId);
    if (fatherId) payload.fatherid = readString(fatherId);

    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/smartsheet/copy",
      actionLabel: "copy_smartsheet",
      agent,
      body: payload,
    });
    return {
      raw: json,
      docId: readString(json.docid),
      url: readString(json.url),
    };
  }

  async shareDoc(params: { agent: ResolvedAgentAccount; docId: string }) {
    const { agent, docId } = params;
    const normalizedDocId = readString(docId);
    if (!normalizedDocId) throw new Error("docId required");
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/doc_share",
      actionLabel: "doc_share",
      agent,
      body: { docid: normalizedDocId },
    });
    return {
      raw: json,
      shareUrl: readString(json.share_url),
    };
  }

  async getDocAuth(params: { agent: ResolvedAgentAccount; docId: string }) {
    const { agent, docId } = params;
    const normalizedDocId = readString(docId);
    if (!normalizedDocId) throw new Error("docId required");
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/doc_get_auth",
      actionLabel: "doc_get_auth",
      agent,
      body: { docid: normalizedDocId },
    });
    return {
      raw: json,
      accessRule: json.access_rule && typeof json.access_rule === "object" ? json.access_rule : {},
      secureSetting:
        json.secure_setting && typeof json.secure_setting === "object" ? json.secure_setting : {},
      docMembers: Array.isArray(json.doc_member_list) ? json.doc_member_list : [],
      coAuthList: Array.isArray(json.co_auth_list) ? json.co_auth_list : [],
    };
  }

  async deleteDoc(params: { agent: ResolvedAgentAccount; docId?: string; formId?: string }) {
    const { agent, docId, formId } = params;
    const payload: Record<string, string> = {};
    const normalizedDocId = readString(docId);
    const normalizedFormId = readString(formId);
    if (normalizedDocId) payload.docid = normalizedDocId;
    if (normalizedFormId) payload.formid = normalizedFormId;
    if (!payload.docid && !payload.formid) {
      throw new Error("docId or formId required");
    }
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/del_doc",
      actionLabel: "del_doc",
      agent,
      body: payload,
    });
    return {
      raw: json,
      docId: payload.docid || "",
      formId: payload.formid || "",
    };
  }

  async setDocSafetySetting(params: { agent: ResolvedAgentAccount; docId: string; request: any }) {
    const { agent, docId, request } = params;
    const payload = {
      ...readObject(request),
    };
    payload.docid = readString(docId || payload.docid);
    if (!payload.docid) throw new Error("docId required");
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/mod_doc_safty_setting",
      actionLabel: "mod_doc_safty_setting",
      agent,
      body: payload,
    });
    return {
      raw: json,
      docId: payload.docid as string,
    };
  }

  async createCollect(params: {
    agent: ResolvedAgentAccount;
    formInfo: any;
    spaceId?: string;
    fatherId?: string;
  }) {
    const { agent, formInfo, spaceId, fatherId } = params;

    // Validate form_info structure per API spec
    if (!formInfo || typeof formInfo !== "object") {
      throw new Error("formInfo 必须是非空对象");
    }

    // Validate required fields
    if (!formInfo.form_title || readString(formInfo.form_title).length === 0) {
      throw new Error("form_title 必填");
    }

    if (
      !formInfo.form_question ||
      !formInfo.form_question.items ||
      !Array.isArray(formInfo.form_question.items)
    ) {
      throw new Error("form_question.items 必填且必须为数组");
    }

    // Validate questions count ≤ 200
    const questions = formInfo.form_question.items;
    if (questions.length > 200) {
      throw new Error("问题数量不能超过 200 个");
    }

    // Auto-fill status fields for questions and options
    questions.forEach((q: any) => {
      if (q.status === undefined) q.status = 1;
      if (Array.isArray(q.option_item)) {
        q.option_item.forEach((opt: any) => {
          if (opt.status === undefined) opt.status = 1;
        });
      }
    });

    // Validate each question
    questions.forEach((q: any, index: number) => {
      if (!q.question_id || !Number.isInteger(q.question_id) || q.question_id < 1) {
        throw new Error(`第${index + 1}个问题：question_id 必填且必须从 1 开始`);
      }
      if (!q.title || readString(q.title).length === 0) {
        throw new Error(`第${index + 1}个问题：title 必填`);
      }
      if (!q.pos || !Number.isInteger(q.pos) || q.pos < 1) {
        throw new Error(`第${index + 1}个问题：pos 必填且必须从 1 开始`);
      }
      if (q.reply_type === undefined || !Number.isInteger(q.reply_type)) {
        throw new Error(`第${index + 1}个问题：reply_type 必填`);
      }
      if (q.must_reply === undefined || typeof q.must_reply !== "boolean") {
        throw new Error(`第${index + 1}个问题：must_reply 必填且必须为布尔值`);
      }
      if (q.status !== undefined && ![1, 2].includes(q.status)) {
        throw new Error(`第${index + 1}个问题：status 必须为 1(正常) 或 2(删除)`);
      }

      // Validate option_item for single/multiple/dropdown questions
      const requiresOptions = [2, 3, 15].includes(q.reply_type); // 单选/多选/下拉列表
      if (requiresOptions) {
        if (!Array.isArray(q.option_item) || q.option_item.length === 0) {
          throw new Error(`第${index + 1}个问题：单选/多选/下拉列表必须提供 option_item 数组`);
        }
        // Validate option keys are sequential from 1
        q.option_item.forEach((opt: any, optIndex: number) => {
          if (!opt.key || !Number.isInteger(opt.key) || opt.key < 1) {
            throw new Error(`第${index + 1}个问题的第${optIndex + 1}个选项：key 必填且从 1 开始`);
          }
          if (!opt.value || readString(opt.value).length === 0) {
            throw new Error(`第${index + 1}个问题的第${optIndex + 1}个选项：value 必填`);
          }
          if (opt.status !== undefined && ![1, 2].includes(opt.status)) {
            throw new Error(
              `第${index + 1}个问题的第${optIndex + 1}个选项：status 必须为 1(正常) 或 2(删除)`,
            );
          }
        });
      }

      // Validate image/file upload limits
      if ([9, 10].includes(q.reply_type)) {
        // 图片/文件
        const setting = q.question_extend_setting;
        if (setting) {
          const limit =
            setting.image_setting?.upload_image_limit || setting.file_setting?.upload_file_limit;
          if (limit) {
            if (limit.count !== undefined && (limit.count < 1 || limit.count > 9)) {
              throw new Error(`第${index + 1}个问题：图片/文件上传数量限制必须在 1-9 之间`);
            }
            if (limit.max_size !== undefined && limit.max_size > 3000) {
              throw new Error(`第${index + 1}个问题：单个文件大小限制最大 3000MB`);
            }
          }
        }
      }
    });

    // Validate timed_repeat_info and timed_finish are mutually exclusive
    const formSetting = formInfo.form_setting || {};
    if (formSetting.timed_repeat_info?.enable && formSetting.timed_finish) {
      console.warn("警告：timed_finish 与 timed_repeat_info 互斥，若都填优先定时重复");
    }

    // Validate timed_repeat_info.enable=true requires fill_in_range
    if (formSetting.timed_repeat_info?.enable) {
      if (
        !formSetting.fill_in_range ||
        (!formSetting.fill_in_range.userids?.length &&
          !formSetting.fill_in_range.departmentids?.length)
      ) {
        throw new Error(
          "timed_repeat_info 开启时，fill_in_range 必填（需指定 userids 或 departmentids）",
        );
      }
    }

    // Build payload
    const payload: Record<string, unknown> = {
      form_info: {
        form_title: readString(formInfo.form_title),
        form_desc: formInfo.form_desc ? readString(formInfo.form_desc) : undefined,
        form_header: formInfo.form_header ? readString(formInfo.form_header) : undefined,
        form_question: formInfo.form_question,
        form_setting: formSetting,
      },
    };

    const normalizedSpaceId = readString(spaceId);
    const normalizedFatherId = readString(fatherId);
    if (normalizedSpaceId) payload.spaceid = normalizedSpaceId;
    if (normalizedFatherId) payload.fatherid = normalizedFatherId;

    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/create_form",
      actionLabel: "create_form",
      agent,
      body: payload,
    });
    return {
      raw: json,
      formId: readString(json.formid),
      title: readString((payload.form_info as any).form_title),
    };
  }

  async modifyCollect(params: {
    agent: ResolvedAgentAccount;
    oper: string;
    formId: string;
    formInfo: any;
  }) {
    const { agent, oper, formId, formInfo } = params;

    // Validate oper parameter
    const operNum = Number(oper);
    if (!operNum || ![1, 2].includes(operNum)) {
      throw new Error("oper 必填且必须为 1 或 2：1=全量修改问题，2=全量修改设置");
    }

    const normalizedFormId = readString(formId);
    if (!normalizedFormId) throw new Error("formId required");

    // Build payload based on oper type
    const payload: Record<string, unknown> = {
      oper: operNum,
      formid: normalizedFormId,
    };

    if (operNum === 1) {
      // 全量修改问题：必须提供完整的 form_question 数组
      if (!formInfo || !formInfo.form_question || !Array.isArray(formInfo.form_question.items)) {
        throw new Error(
          "oper=1 时，必须提供 form_question.items 数组（包含所有问题，缺失的问题将被删除）",
        );
      }

      // Validate questions count ≤ 200
      const questions = formInfo.form_question.items;
      if (questions.length > 200) {
        throw new Error("问题数量不能超过 200 个");
      }

      // Auto-fill status fields for questions and options
      questions.forEach((q: any) => {
        if (q.status === undefined) q.status = 1;
        if (Array.isArray(q.option_item)) {
          q.option_item.forEach((opt: any) => {
            if (opt.status === undefined) opt.status = 1;
          });
        }
      });

      // Validate each question (same as createCollect)
      questions.forEach((q: any, index: number) => {
        if (!q.question_id || !Number.isInteger(q.question_id) || q.question_id < 1) {
          throw new Error(`第${index + 1}个问题：question_id 必填且必须从 1 开始`);
        }
        if (!q.title || readString(q.title).length === 0) {
          throw new Error(`第${index + 1}个问题：title 必填`);
        }
        if (!q.pos || !Number.isInteger(q.pos) || q.pos < 1) {
          throw new Error(`第${index + 1}个问题：pos 必填且必须从 1 开始`);
        }
        if (q.reply_type === undefined || !Number.isInteger(q.reply_type)) {
          throw new Error(`第${index + 1}个问题：reply_type 必填`);
        }
        if (q.must_reply === undefined || typeof q.must_reply !== "boolean") {
          throw new Error(`第${index + 1}个问题：must_reply 必填且必须为布尔值`);
        }

        // Validate option_item for single/multiple/dropdown questions
        const requiresOptions = [2, 3, 15].includes(q.reply_type);
        if (requiresOptions) {
          if (!Array.isArray(q.option_item) || q.option_item.length === 0) {
            throw new Error(`第${index + 1}个问题：单选/多选/下拉列表必须提供 option_item 数组`);
          }
          q.option_item.forEach((opt: any, optIndex: number) => {
            if (!opt.key || !Number.isInteger(opt.key) || opt.key < 1) {
              throw new Error(`第${index + 1}个问题的第${optIndex + 1}个选项：key 必填且从 1 开始`);
            }
            if (!opt.value || readString(opt.value).length === 0) {
              throw new Error(`第${index + 1}个问题的第${optIndex + 1}个选项：value 必填`);
            }
          });
        }
      });

      payload.form_info = { form_question: formInfo.form_question };
    } else if (operNum === 2) {
      // 全量修改设置：必须提供完整的 form_setting 对象
      if (!formInfo || !formInfo.form_setting || typeof formInfo.form_setting !== "object") {
        throw new Error("oper=2 时，必须提供 form_setting 对象（缺失的设置项将被重置为默认值）");
      }

      // Validate timed_repeat_info and timed_finish are mutually exclusive
      const formSetting = formInfo.form_setting;
      if (formSetting.timed_repeat_info?.enable && formSetting.timed_finish) {
        console.warn("警告：timed_finish 与 timed_repeat_info 互斥，若都填优先定时重复");
      }

      payload.form_info = { form_setting: formSetting };
    }

    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/modify_form",
      actionLabel: "modify_form",
      agent,
      body: payload,
    });
    return {
      raw: json,
      formId: payload.formid as string,
      oper: payload.oper as string,
      title: formInfo?.form_title ? readString(formInfo.form_title) : undefined,
    };
  }

  async getFormInfo(params: { agent: ResolvedAgentAccount; formId: string }) {
    const { agent, formId } = params;
    const normalizedFormId = readString(formId);
    if (!normalizedFormId) throw new Error("formId required");
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/get_form_info",
      actionLabel: "get_form_info",
      agent,
      body: { formid: normalizedFormId },
    });
    return {
      raw: json,
      formInfo: readObject(json.form_info),
    };
  }

  async getFormAnswer(params: {
    agent: ResolvedAgentAccount;
    repeatedId: string;
    answerIds?: unknown[];
  }) {
    const { agent, repeatedId, answerIds } = params;
    const normalizedRepeatedId = readString(repeatedId);
    if (!normalizedRepeatedId) throw new Error("repeatedId required");
    const normalizedAnswerIds = Array.isArray(answerIds)
      ? answerIds.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];

    // Official API limit: ≤100 answer IDs
    if (normalizedAnswerIds.length > 100) {
      throw new Error(`answer_ids 不能超过 100 个，当前：${normalizedAnswerIds.length}`);
    }

    const payload: Record<string, unknown> = {
      repeated_id: normalizedRepeatedId,
    };
    if (normalizedAnswerIds.length > 0) {
      payload.answer_ids = normalizedAnswerIds;
    }
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/get_form_answer",
      actionLabel: "get_form_answer",
      agent,
      body: payload,
    });
    const answer = readObject(json.answer);
    return {
      raw: json,
      answer,
      answerList: readArray((answer as any).answer_list),
    };
  }

  async getFormStatistic(params: { agent: ResolvedAgentAccount; requests: unknown[] }) {
    const { agent, requests } = params;
    const payload = Array.isArray(requests)
      ? requests.map((item) => readObject(item)).filter((item) => Object.keys(item).length > 0)
      : [];
    if (payload.length === 0) {
      throw new Error("requests required");
    }

    // Validate each request per official API
    payload.forEach((req: any, index: number) => {
      const reqType = Number(req.req_type);

      // req_type=2: Get submitted list - requires start_time and end_time (same day timestamps)
      if (reqType === 2) {
        if (!req.start_time || !req.end_time) {
          throw new Error(
            `第${index + 1}个请求：req_type=2 时必须提供 start_time 和 end_time（当天时间戳）`,
          );
        }
        // Validate timestamps are numbers
        if (!Number.isFinite(Number(req.start_time)) || !Number.isFinite(Number(req.end_time))) {
          throw new Error(`第${index + 1}个请求：start_time 和 end_time 必须是有效时间戳`);
        }
        // Validate end_time >= start_time
        if (Number(req.end_time) < Number(req.start_time)) {
          throw new Error(`第${index + 1}个请求：end_time 必须大于等于 start_time`);
        }
      }

      // Validate repeated_id is present
      if (!req.repeated_id) {
        throw new Error(`第${index + 1}个请求：repeated_id 必填`);
      }
    });

    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/get_form_statistic",
      actionLabel: "get_form_statistic",
      agent,
      body: { requests: payload },
    });
    const statisticList = readArray(json.statistic_list);
    return {
      raw: json,
      items: statisticList,
      successCount: statisticList.filter((item: any) => Number(item?.errcode ?? 0) === 0).length,
    };
  }

  async modDocMemberNotifiedScope(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    notified_scope_type: number;
    notified_member_list?: any[];
  }) {
    const { agent, docId, notified_scope_type, notified_member_list } = params;
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/mod_doc_member_notified_scope",
      actionLabel: "mod_doc_member_notified_scope",
      agent,
      body: { docid: readString(docId), notified_scope_type, notified_member_list },
    });
    return json;
  }

  // --- Smart Table Operations ---

  async smartTableOperate(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    operation: string;
    bodyData: any;
  }) {
    const { agent, docId, operation, bodyData } = params;
    const body = { docid: readString(docId), ...readObject(bodyData) };
    const path = `/cgi-bin/wedoc/smartsheet/${operation}`;
    const json = await this.postWecomDocApi({
      path,
      actionLabel: `smartsheet_${operation}`,
      agent,
      body,
    });
    return { raw: json, docId };
  }

  async smartTableAddGroup(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    sheetId: string;
    name: string;
    children?: string[];
  }) {
    const { agent, docId, sheetId, name, children } = params;
    return this.smartTableOperate({
      agent,
      docId,
      operation: "add_field_group",
      bodyData: { sheet_id: sheetId, name, children },
    });
  }

  async smartTableDelGroup(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    sheetId: string;
    field_group_id: string;
  }) {
    const { agent, docId, sheetId, field_group_id } = params;
    return this.smartTableOperate({
      agent,
      docId,
      operation: "delete_field_group",
      bodyData: { sheet_id: sheetId, field_group_id },
    });
  }

  async smartTableUpdateGroup(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    sheetId: string;
    field_group_id: string;
    name?: string;
    children?: string[];
  }) {
    const { agent, docId, sheetId, field_group_id, name, children } = params;
    return this.smartTableOperate({
      agent,
      docId,
      operation: "update_field_group",
      bodyData: { sheet_id: sheetId, field_group_id, name, children },
    });
  }

  async smartTableGetGroups(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    sheetId: string;
  }) {
    const { agent, docId, sheetId } = params;
    return this.smartTableOperate({
      agent,
      docId,
      operation: "get_field_groups",
      bodyData: { sheet_id: sheetId },
    });
  }

  async smartTableAddExternalRecords(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    sheetId: string;
    records: any[];
  }) {
    const { agent, docId, sheetId, records } = params;
    return this.smartTableOperate({
      agent,
      docId,
      operation: "add_external_records",
      bodyData: { sheet_id: sheetId, records },
    });
  }

  async smartTableUpdateExternalRecords(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    sheetId: string;
    records: any[];
  }) {
    const { agent, docId, sheetId, records } = params;
    return this.smartTableOperate({
      agent,
      docId,
      operation: "update_external_records",
      bodyData: { sheet_id: sheetId, records },
    });
  }

  // --- Smartsheet Content Permissions ---

  async smartTableGetSheetPriv(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    type: number;
    rule_id_list?: number[];
  }) {
    const { agent, docId, type, rule_id_list } = params;
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/smartsheet/content_priv/get_sheet_priv",
      actionLabel: "smartsheet_get_sheet_priv",
      agent,
      body: { docid: readString(docId), type, rule_id_list },
    });
    return { raw: json };
  }

  async smartTableUpdateSheetPriv(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    type: number;
    rule_id?: number;
    name?: string;
    priv_list: any[];
  }) {
    const { agent, docId, type, rule_id, name, priv_list } = params;
    const body: any = { docid: readString(docId), type, priv_list };
    if (rule_id !== undefined) body.rule_id = rule_id;
    if (name !== undefined) body.name = name;

    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/smartsheet/content_priv/update_sheet_priv",
      actionLabel: "smartsheet_update_sheet_priv",
      agent,
      body,
    });
    return { raw: json };
  }

  async smartTableCreateRule(params: { agent: ResolvedAgentAccount; docId: string; name: string }) {
    const { agent, docId, name } = params;
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/smartsheet/content_priv/create_rule",
      actionLabel: "smartsheet_create_rule",
      agent,
      body: { docid: readString(docId), name },
    });
    return { raw: json, rule_id: json.rule_id };
  }

  async smartTableModRuleMember(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    rule_id: number;
    add_member_range?: any;
    del_member_range?: any;
  }) {
    const { agent, docId, rule_id, add_member_range, del_member_range } = params;
    const body: any = { docid: readString(docId), rule_id };
    if (add_member_range) body.add_member_range = add_member_range;
    if (del_member_range) body.del_member_range = del_member_range;

    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/smartsheet/content_priv/mod_rule_member",
      actionLabel: "smartsheet_mod_rule_member",
      agent,
      body,
    });
    return { raw: json };
  }

  async smartTableDeleteRule(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    rule_id_list: number[];
  }) {
    const { agent, docId, rule_id_list } = params;
    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/smartsheet/content_priv/delete_rule",
      actionLabel: "smartsheet_delete_rule",
      agent,
      body: { docid: readString(docId), rule_id_list },
    });
    return { raw: json };
  }

  // --- Advanced Account Management ---

  async assignDocAdvancedAccount(params: { agent: ResolvedAgentAccount; userid_list: string[] }) {
    const { agent, userid_list } = params;
    return this.postWecomDocApi({
      path: "/cgi-bin/meeting/vip/submit_batch_add_job",
      actionLabel: "assign_advanced_account",
      agent,
      body: { userid_list },
    });
  }

  async cancelDocAdvancedAccount(params: { agent: ResolvedAgentAccount; userid_list: string[] }) {
    const { agent, userid_list } = params;
    return this.postWecomDocApi({
      path: "/cgi-bin/meeting/vip/submit_batch_del_job",
      actionLabel: "cancel_advanced_account",
      agent,
      body: { userid_list },
    });
  }

  async getDocAdvancedAccountList(params: {
    agent: ResolvedAgentAccount;
    cursor?: number;
    limit?: number;
  }) {
    const { agent, cursor, limit } = params;
    return this.postWecomDocApi({
      path: "/cgi-bin/meeting/vip/get_vip_user_list",
      actionLabel: "get_advanced_account_list",
      agent,
      body: { cursor: cursor !== undefined ? String(cursor) : undefined, limit: limit ?? 100 },
    });
  }

  // --- Material Management ---

  async uploadDocImage(params: {
    agent: ResolvedAgentAccount;
    docId: string;
    base64_content: string;
  }) {
    const { agent, docId, base64_content } = params;
    const normalizedDocId = readString(docId);
    if (!normalizedDocId) throw new Error("docId required");

    const json = await this.postWecomDocApi({
      path: "/cgi-bin/wedoc/image_upload",
      actionLabel: "upload_doc_image",
      agent,
      body: {
        docid: normalizedDocId,
        base64_content: base64_content,
      },
    });

    return {
      raw: json,
      url: readString(json.url),
      height: json.height,
      width: json.width,
      size: json.size,
    };
  }
}
