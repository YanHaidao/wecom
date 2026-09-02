import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  getAgentScopedMediaLocalRoots,
  readResponseWithLimit,
} from "openclaw/plugin-sdk/media-runtime";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { resolveAddonAgentAccount } from "../../addon/agent-account.js";
import { wecomEnterpriseDocToolSchema } from "../../addon/capability-matrix.js";
import { isWecomAddonToolContext, resolveBoundWecomAccountId } from "../../addon/tool-context.js";
import { resolveMediaFile } from "../../media-uploader.js";
import { WecomDocClient } from "./client.js";

function readString(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function summarizeDocAuth(result: any = {}) {
  return `权限信息已获取：通知成员 ${result.docMembers?.length ?? 0}，协作者 ${result.coAuthList?.length ?? 0}`;
}

function readBooleanFlag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function formatDocMemberRef(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const userid = readString(value.userid ?? value.userId);
  if (userid) return `userid:${userid}`;
  const partyid = readString(value.partyid);
  if (partyid) return `partyid:${partyid}`;
  const tagid = readString(value.tagid);
  if (tagid) return `tagid:${tagid}`;
  return "";
}

function mapDocMemberList(values: any) {
  return Array.isArray(values)
    ? values.map((item) => formatDocMemberRef(item)).filter(Boolean)
    : [];
}

function describeFlagState(
  value: boolean | null,
  enabledLabel: string,
  disabledLabel: string,
  unknownLabel = "未知",
) {
  if (value === true) return enabledLabel;
  if (value === false) return disabledLabel;
  return unknownLabel;
}

function buildDocAuthDiagnosis(result: any = {}, requesterSenderId = "") {
  const accessRule =
    result.accessRule && typeof result.accessRule === "object" ? result.accessRule : {};
  const viewers = mapDocMemberList(result.docMembers);
  const collaborators = mapDocMemberList(result.coAuthList);
  const requester = readString(requesterSenderId);
  const requesterViewerRef = requester ? `userid:${requester}` : "";
  const requesterIsViewer = requesterViewerRef ? viewers.includes(requesterViewerRef) : false;
  const requesterIsCollaborator = requesterViewerRef
    ? collaborators.includes(requesterViewerRef)
    : false;
  const internalAccessEnabled = readBooleanFlag(accessRule.enable_corp_internal);
  const externalAccessEnabled = readBooleanFlag(accessRule.enable_corp_external);
  const externalShareAllowed =
    typeof accessRule.ban_share_external === "boolean" ? !accessRule.ban_share_external : null;
  const likelyAnonymousLinkFailure =
    internalAccessEnabled === true && externalAccessEnabled === false;
  const findings = [
    `企业内访问：${describeFlagState(internalAccessEnabled, "开启", "关闭")}`,
    `企业外访问：${describeFlagState(externalAccessEnabled, "开启", "关闭")}`,
    `外部分享：${describeFlagState(externalShareAllowed, "允许", "禁止")}`,
    `查看成员：${viewers.length}`,
    `协作者：${collaborators.length}`,
  ];
  const recommendations: string[] = [];
  if (likelyAnonymousLinkFailure) {
    recommendations.push(
      '当前更像是仅企业内可访问；匿名浏览器或未登录企业微信环境通常会显示"文档不存在"。',
    );
  }
  if (requester) {
    if (requesterIsCollaborator) {
      recommendations.push(`当前请求人 ${requester} 已在协作者列表中。`);
    } else if (requesterIsViewer) {
      recommendations.push(`当前请求人 ${requester} 已在查看成员列表中，但还不是协作者。`);
    } else {
      recommendations.push(`当前请求人 ${requester} 不在查看成员或协作者列表中。`);
    }
  }
  return {
    internalAccessEnabled,
    externalAccessEnabled,
    externalShareAllowed,
    viewerCount: viewers.length,
    collaboratorCount: collaborators.length,
    viewers,
    collaborators,
    requesterSenderId: requester || undefined,
    requesterRole: requesterIsCollaborator
      ? "collaborator"
      : requesterIsViewer
        ? "viewer"
        : requester
          ? "none"
          : "unknown",
    likelyAnonymousLinkFailure,
    findings,
    recommendations,
  };
}

function summarizeDocAuthDiagnosis(diagnosis: any = {}) {
  const parts = Array.isArray(diagnosis.findings) ? diagnosis.findings : [];
  return parts.length > 0 ? `文档权限诊断：${parts.join("，")}` : "文档权限诊断已完成";
}

function buildDocIdUsageHint(docId?: string) {
  const normalizedDocId = readString(docId);
  if (!normalizedDocId) return "";
  return `后续权限、分享和诊断操作请使用真实 docId：${normalizedDocId}；不要直接使用分享链接路径中的片段。`;
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractEmbeddedJson(html: string, variableName: string) {
  const source = String(html ?? "");
  if (!source) return null;
  const marker = `window.${variableName}=`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const valueStart = start + marker.length;
  const end = source.indexOf(";</script>", valueStart);
  if (end < 0) return null;
  return safeParseJson(source.slice(valueStart, end));
}

function buildShareLinkDiagnosis(params: {
  shareUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  basicClientVars: any;
}) {
  const { shareUrl, finalUrl, status, contentType, basicClientVars } = params;
  const parsedUrl = new URL(finalUrl || shareUrl);
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const pathResourceType = readString(pathSegments[0]);
  const pathResourceId = readString(pathSegments[1]);
  const shareCode = readString(parsedUrl.searchParams.get("scode"));
  const userInfo =
    basicClientVars?.userInfo && typeof basicClientVars.userInfo === "object"
      ? basicClientVars.userInfo
      : {};
  const docInfo =
    basicClientVars?.docInfo && typeof basicClientVars.docInfo === "object"
      ? basicClientVars.docInfo
      : {};
  const padInfo = docInfo?.padInfo && typeof docInfo.padInfo === "object" ? docInfo.padInfo : {};
  const ownerInfo =
    docInfo?.ownerInfo && typeof docInfo.ownerInfo === "object" ? docInfo.ownerInfo : {};
  const shareInfo =
    docInfo?.shareInfo && typeof docInfo.shareInfo === "object" ? docInfo.shareInfo : {};
  const aclInfo = docInfo?.aclInfo && typeof docInfo.aclInfo === "object" ? docInfo.aclInfo : {};
  const userType = readString(userInfo.userType);
  const padType = readString(padInfo.padType);
  const padId = readString(padInfo.padId);
  const padTitle = readString(padInfo.padTitle);
  const isGuest = userType === "guest" || Number(userInfo.loginType) === 0;
  const isBlankPage = padType === "blankpage";
  const likelyUnavailableToGuest = isGuest && isBlankPage && !padTitle;
  const findings = [
    `HTTP ${String(status || "")}`.trim(),
    `内容类型：${readString(contentType) || "未知"}`,
    `访问身份：${userType || "未知"}`,
    `页面类型：${padType || "未知"}`,
    `路径资源：${pathResourceType || "未知"} / ${pathResourceId || "未知"}`,
  ];
  const recommendations: string[] = [];
  if (likelyUnavailableToGuest) {
    recommendations.push(
      '当前链接对 guest/未登录企业微信环境返回 blankpage，外部访问会表现为打不开或像"文档不存在"。',
    );
  }
  if (shareCode) {
    recommendations.push(
      `当前链接带有分享码 scode=${shareCode}。如分享码过期或未生效，外部访问会失败。`,
    );
  }
  if (pathResourceId && padId && pathResourceId !== padId) {
    recommendations.push(
      `链接路径中的资源标识与页面 padId 不一致：path=${pathResourceId}，padId=${padId}。`,
    );
  }
  if (pathResourceId && padId && pathResourceId === padId) {
    recommendations.push(
      "链接路径资源标识与页面 padId 一致，但这仍不等同于 Wedoc API 可用的真实 docId。",
    );
  }
  return {
    shareUrl,
    finalUrl,
    httpStatus: status,
    contentType: readString(contentType) || undefined,
    pathResourceType: pathResourceType || undefined,
    pathResourceId: pathResourceId || undefined,
    shareCode: shareCode || undefined,
    userType: userType || undefined,
    isGuest,
    padId: padId || undefined,
    padType: padType || undefined,
    padTitle: padTitle || undefined,
    ownerId: readString(ownerInfo.ownerId) || undefined,
    hasShareInfo: Object.keys(shareInfo).length > 0,
    hasAclInfo: Object.keys(aclInfo).length > 0,
    likelyUnavailableToGuest,
    findings,
    recommendations,
  };
}

async function inspectWecomShareLink(params: { shareUrl: string }) {
  const { shareUrl } = params;
  const normalizedUrl = readString(shareUrl);
  if (!normalizedUrl) throw new Error("shareUrl required");
  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error("shareUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("shareUrl must use HTTPS");
  }

  const guarded = await fetchWithSsrFGuard({
    url: parsed.toString(),
    init: {
      headers: {
        "user-agent": "OpenClaw-Wechat/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    },
    maxRedirects: 5,
    timeoutMs: 15_000,
    requireHttps: true,
    auditContext: "wecom_doc.validate_share_link",
  });
  try {
    const response = guarded.response;
    const finalUrl = guarded.finalUrl || response.url || parsed.toString();
    const contentType = response.headers?.get("content-type") || "";
    const html = (await readResponseWithLimit(response, 2 * 1024 * 1024, {
      timeoutMs: 15_000,
    })).toString("utf8");
    const basicClientVars = extractEmbeddedJson(html, "basicClientVars");
    const diagnosis = buildShareLinkDiagnosis({
      shareUrl: normalizedUrl,
      finalUrl,
      status: response.status,
      contentType,
      basicClientVars,
    });
    return {
      raw: {
        httpStatus: response.status,
        finalUrl: `\u00A0${finalUrl}\u00A0`.trim(),
        contentType,
        basicClientVars,
      },
      diagnosis,
    };
  } finally {
    await guarded.release();
  }
}

function summarizeShareLinkDiagnosis(diagnosis: any = {}) {
  const parts = Array.isArray(diagnosis.findings) ? diagnosis.findings : [];
  return parts.length > 0 ? `分享链接校验：${parts.join("，")}` : "分享链接校验已完成";
}

function summarizeFormInfo(result: any = {}) {
  const title = readString(result.formInfo?.form_title) || "未命名收集表";
  return `收集表"${title}"信息已获取`;
}

function summarizeFormAnswer(result: any = {}) {
  return `收集表答案已获取：字段 ${result.answerList?.length ?? 0}`;
}

function summarizeFormStatistic(result: any = {}) {
  return `收集表统计已获取：请求 ${result.items?.length ?? 0}，成功 ${result.successCount ?? 0}`;
}

function summarizeAdvancedAccount(result: any = {}, action: string) {
  if (action === "assign") return `高级功能账号分配任务已提交，jobid: ${result.jobid || "未知"}`;
  if (action === "cancel") return `高级功能账号取消任务已提交，jobid: ${result.jobid || "未知"}`;
  return `高级功能账号列表已获取：${result.userList?.length ?? 0} 个`;
}

function buildToolResult(payload: any) {
  // To avoid formatting issues with URLs having underscores rendering as markdown Italics
  if (payload.url) payload.url = `<${payload.url}>`;
  if (payload.diagnosis?.finalUrl) payload.diagnosis.finalUrl = `<${payload.diagnosis.finalUrl}>`;
  if (payload.diagnosis?.shareUrl) payload.diagnosis.shareUrl = `<${payload.diagnosis.shareUrl}>`;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export function registerWecomDocTool(api: OpenClawPluginApi) {
  if (typeof api?.registerTool !== "function") return;
  const docClient = new WecomDocClient();

  api.registerTool(
    (toolContext: any) => {
      if (!isWecomAddonToolContext(toolContext)) {
        return null;
      }

      return {
        name: "wecom_doc",
        label: "WeCom Advanced Doc",
        description:
          "企业微信文档增强操作：权限诊断、分享校验、收集表、智能表格高级权限/外部记录及高级账号。常规文档操作使用 wecom-cli。",
        parameters: wecomEnterpriseDocToolSchema,
        async execute(_toolCallId, params: any) {
          try {
            const accountId = resolveBoundWecomAccountId({
              cfg: api.config,
              requestedAccountId: params.accountId,
              toolContext,
            });
            const account = resolveAddonAgentAccount(api.config, accountId);
            if (!account || !account.configured) {
              throw new Error(`WeCom account ${accountId} not configured for Doc API requirements`);
            }

            const action = params.action;
            switch (action) {
              case "copy": {
                const result = await docClient.copyDoc({
                  agent: account,
                  docId: params.docId,
                  newName: params.newName,
                  spaceId: params.spaceId,
                  fatherId: params.fatherId,
                });
                return buildToolResult({
                  ok: true,
                  action: "copy",
                  accountId: account.accountId,
                  docId: result.docId,
                  summary: `文档已成功复制，新 docId: ${result.docId}`,
                  raw: result.raw,
                });
              }
              case "share": {
                const result = await docClient.shareDoc({
                  agent: account,
                  docId: params.docId,
                });
                return buildToolResult({
                  ok: true,
                  action: "share",
                  accountId: account.accountId,
                  canonicalDocId: params.docId,
                  docId: params.docId,
                  url: result.shareUrl || undefined,
                  summary: result.shareUrl
                    ? `文档分享链接已获取（docId: ${params.docId}）`
                    : `文档分享接口调用成功（docId: ${params.docId}）`,
                  usageHint: buildDocIdUsageHint(params.docId) || undefined,
                  raw: result.raw,
                });
              }
              case "get_auth": {
                const result = await docClient.getDocAuth({
                  agent: account,
                  docId: params.docId,
                });
                const diagnosis = buildDocAuthDiagnosis(result, toolContext?.requesterSenderId);
                return buildToolResult({
                  ok: true,
                  action: "get_auth",
                  accountId: account.accountId,
                  canonicalDocId: params.docId,
                  docId: params.docId,
                  summary: summarizeDocAuth(result),
                  diagnosis,
                  raw: result.raw,
                });
              }
              case "diagnose_auth": {
                const result = await docClient.getDocAuth({
                  agent: account,
                  docId: params.docId,
                });
                const diagnosis = buildDocAuthDiagnosis(result, toolContext?.requesterSenderId);
                return buildToolResult({
                  ok: true,
                  action: "diagnose_auth",
                  accountId: account.accountId,
                  canonicalDocId: params.docId,
                  docId: params.docId,
                  summary: summarizeDocAuthDiagnosis(diagnosis),
                  diagnosis,
                  raw: result.raw,
                });
              }
              case "validate_share_link": {
                const result = await inspectWecomShareLink({
                  shareUrl: params.shareUrl,
                });
                return buildToolResult({
                  ok: true,
                  action: "validate_share_link",
                  accountId: account.accountId,
                  url: result.diagnosis.finalUrl || params.shareUrl,
                  summary: summarizeShareLinkDiagnosis(result.diagnosis),
                  diagnosis: result.diagnosis,
                  raw: result.raw,
                });
              }
              case "delete": {
                const result = await docClient.deleteDoc({
                  agent: account,
                  docId: params.docId,
                  formId: params.formId,
                });
                return buildToolResult({
                  ok: true,
                  action: "delete",
                  accountId: account.accountId,
                  docId: result.docId || undefined,
                  formId: result.formId || undefined,
                  summary: result.formId ? "收集表已删除" : "文档已删除",
                  raw: result.raw,
                });
              }
              case "set_safety_setting": {
                const result = await docClient.setDocSafetySetting({
                  agent: account,
                  docId: params.docId,
                  request: params.request,
                });
                return buildToolResult({
                  ok: true,
                  action: "set_safety_setting",
                  accountId: account.accountId,
                  docId: result.docId,
                  summary: "文档安全设置已更新",
                  raw: result.raw,
                });
              }
              case "mod_doc_member_notified_scope": {
                const result = await docClient.modDocMemberNotifiedScope({
                  agent: account,
                  docId: params.docId,
                  notified_scope_type: params.notified_scope_type,
                  notified_member_list: params.notified_member_list,
                });
                return buildToolResult({
                  ok: true,
                  action: "mod_doc_member_notified_scope",
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "文档成员通知范围已更新",
                  raw: result,
                });
              }
              case "create_form": {
                // 创建收集表（表单）
                try {
                  const result = await docClient.createCollect({
                    agent: account,
                    formInfo: params.formInfo,
                    spaceId: params.spaceId,
                    fatherId: params.fatherId,
                  });
                  const title = readString(result.title);
                  return buildToolResult({
                    ok: true,
                    action: "create_form",
                    accountId: account.accountId,
                    formId: result.formId,
                    title: title || undefined,
                    summary: title
                      ? `已创建收集表"${title}"（formId: ${result.formId}）`
                      : `已创建收集表（formId: ${result.formId}）`,
                    raw: result.raw,
                  });
                } catch (err) {
                  const errorMsg = err instanceof Error ? err.message : String(err);
                  return buildToolResult({
                    ok: false,
                    action: "create_form",
                    accountId: account.accountId,
                    error: errorMsg,
                    summary: "创建收集表失败",
                    raw: {},
                  });
                }
              }
              case "modify_form": {
                const result = await docClient.modifyCollect({
                  agent: account,
                  oper: params.oper,
                  formId: params.formId,
                  formInfo: params.formInfo,
                });
                const title = readString(result.title);
                return buildToolResult({
                  ok: true,
                  action: "modify_form",
                  accountId: account.accountId,
                  formId: result.formId,
                  title: title || undefined,
                  summary: title
                    ? `收集表已更新（${result.oper}）："${title}"`
                    : `收集表已更新（${result.oper}）`,
                  raw: result.raw,
                });
              }
              case "get_form_info": {
                const result = await docClient.getFormInfo({
                  agent: account,
                  formId: params.formId,
                });
                return buildToolResult({
                  ok: true,
                  action: "get_form_info",
                  accountId: account.accountId,
                  formId: params.formId,
                  title: readString(result.formInfo?.form_title) || undefined,
                  summary: summarizeFormInfo(result),
                  raw: result.raw,
                });
              }
              case "get_form_answer": {
                const result = await docClient.getFormAnswer({
                  agent: account,
                  repeatedId: params.repeatedId,
                  answerIds: params.answerIds,
                });
                return buildToolResult({
                  ok: true,
                  action: "get_form_answer",
                  accountId: account.accountId,
                  repeatedId: params.repeatedId,
                  summary: summarizeFormAnswer(result),
                  raw: result.raw,
                });
              }
              case "get_form_statistic": {
                const result = await docClient.getFormStatistic({
                  agent: account,
                  requests: params.requests,
                });
                return buildToolResult({
                  ok: true,
                  action: "get_form_statistic",
                  accountId: account.accountId,
                  summary: summarizeFormStatistic(result),
                  raw: result.raw,
                });
              }
              case "smartsheet_add_group": {
                const result = await docClient.smartTableAddGroup({ agent: account, ...params });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格编组已添加",
                  raw: result.raw,
                });
              }
              case "smartsheet_del_group": {
                const result = await docClient.smartTableDelGroup({ agent: account, ...params });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格编组已删除",
                  raw: result.raw,
                });
              }
              case "smartsheet_update_group": {
                const result = await docClient.smartTableUpdateGroup({ agent: account, ...params });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格编组已更新",
                  raw: result.raw,
                });
              }
              case "smartsheet_get_groups": {
                const result = await docClient.smartTableGetGroups({ agent: account, ...params });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格编组列表已获取",
                  raw: result.raw,
                });
              }
              case "smartsheet_add_external_records": {
                const result = await docClient.smartTableAddExternalRecords({
                  agent: account,
                  ...params,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格外部记录已添加",
                  raw: result.raw,
                });
              }
              case "smartsheet_update_external_records": {
                const result = await docClient.smartTableUpdateExternalRecords({
                  agent: account,
                  ...params,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格外部记录已更新",
                  raw: result.raw,
                });
              }
              case "smartsheet_get_sheet_priv": {
                const result = await docClient.smartTableGetSheetPriv({
                  agent: account,
                  ...params,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格子表权限已获取",
                  raw: result.raw,
                });
              }
              case "smartsheet_update_sheet_priv": {
                const result = await docClient.smartTableUpdateSheetPriv({
                  agent: account,
                  ...params,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格子表权限已更新",
                  raw: result.raw,
                });
              }
              case "smartsheet_create_rule": {
                const result = await docClient.smartTableCreateRule({ agent: account, ...params });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: `智能表格成员额外权限规则已创建 (rule_id: ${result.rule_id})`,
                  raw: result.raw,
                });
              }
              case "smartsheet_mod_rule_member": {
                const result = await docClient.smartTableModRuleMember({
                  agent: account,
                  ...params,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格成员额外权限成员已更新",
                  raw: result.raw,
                });
              }
              case "smartsheet_delete_rule": {
                const result = await docClient.smartTableDeleteRule({ agent: account, ...params });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  docId: params.docId,
                  summary: "智能表格成员额外权限规则已删除",
                  raw: result.raw,
                });
              }
              case "doc_assign_advanced_account": {
                const result = await docClient.assignDocAdvancedAccount({
                  agent: account,
                  userid_list: params.userid_list,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  summary: summarizeAdvancedAccount(result.raw, "assign"),
                  raw: result.raw,
                });
              }
              case "doc_cancel_advanced_account": {
                const result = await docClient.cancelDocAdvancedAccount({
                  agent: account,
                  userid_list: params.userid_list,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  summary: summarizeAdvancedAccount(result.raw, "cancel"),
                  raw: result.raw,
                });
              }
              case "doc_get_advanced_account_list": {
                const result = await docClient.getDocAdvancedAccountList({
                  agent: account,
                  ...params,
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  summary: summarizeAdvancedAccount(result, "list"),
                  raw: result.raw,
                });
              }
              case "upload_doc_image": {
                const media = await resolveMediaFile(
                  params.file_path,
                  getAgentScopedMediaLocalRoots(api.config, toolContext?.agentId),
                );
                if (!media.contentType.startsWith("image/")) {
                  throw new Error("file_path must point to a supported image inside an allowed media root");
                }

                const result = await docClient.uploadDocImage({
                  agent: account,
                  docId: params.docId,
                  base64_content: media.buffer.toString("base64"),
                });
                return buildToolResult({
                  ok: true,
                  action,
                  accountId: account.accountId,
                  summary: "图片上传成功",
                  details: {
                    url: result.url,
                    width: result.width,
                    height: result.height,
                    size: result.size,
                  },
                  raw: result.raw,
                });
              }
              default:
                throw new Error(`Unsupported action: ${String(action)}`);
            }
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      ok: false,
                      action: params?.action,
                      error: err instanceof Error ? err.message : String(err),
                    },
                    null,
                    2,
                  ),
                },
              ],
              details: {},
              isError: true,
            };
          }
        },
      };
    },
    { name: "wecom_doc" },
  );
}
