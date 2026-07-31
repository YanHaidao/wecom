import type { ResolvedAgentAccount } from "../../types/index.js";
import { getAccessToken } from "../../transport/agent-api/core.js";
import { wecomFetch } from "../../http.js";
import { resolveWecomEgressProxyUrlFromNetwork } from "../../config/index.js";
import { API_BASE, LIMITS } from "../../types/constants.js";
import {
    BatchUpdateDocResponse,
    GetDocContentResponse,
    Node,
    UpdateRequest
} from "./types.js";

function readString(value: unknown): string {
    const trimmed = String(value ?? "").trim();
    return trimmed || "";
}

function normalizeDocType(docType: unknown): 3 | 4 | 10 {
    if (docType === 3 || docType === "3") return 3;
    if (docType === 4 || docType === "4") return 4;
    if (docType === 10 || docType === "10" || docType === 5 || docType === "5") return 10;
    const normalized = readString(docType).toLowerCase();
    if (!normalized || normalized === "doc") return 3;
    if (normalized === "spreadsheet" || normalized === "sheet" || normalized === "table") return 4;
    if (normalized === "smart_table" || normalized === "smarttable") return 10;
    throw new Error(`Unsupported WeCom docType: ${String(docType)}`);
}

function mapDocTypeLabel(docType: 3 | 4 | 10): string {
    if (docType === 10) return "smart_table";
    if (docType === 4) return "spreadsheet";
    return "doc";
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

export interface DocMemberEntry {
    userid?: string;
    partyid?: string;
    tagid?: string;
    /**
     * 权限位：1-查看，2-编辑，7-管理
     * 只有“智能表格”才支持读写权限（auth=2）？
     * 实际上企微文档现在也支持设置协作者权限了。
     */
    auth?: number;
}

function normalizeDocMemberEntry(value: unknown): DocMemberEntry | null {
    if (typeof value === "string" || typeof value === "number") {
        const userid = readString(value);
        return userid ? { userid } : null;
    }
    if (!isRecord(value)) return null;
    const entry: DocMemberEntry = { ...value } as DocMemberEntry;
    if (!readString(entry.userid) && readString(value.userId)) {
        entry.userid = readString(value.userId);
    }
    if (!readString(entry.userid) && !readString(entry.partyid) && !readString(entry.tagid)) {
        return null;
    }
    if (readString(entry.userid)) entry.userid = readString(entry.userid);
    if (readString(entry.partyid)) entry.partyid = readString(entry.partyid);
    if (readString(entry.tagid)) entry.tagid = readString(entry.tagid);
    if (entry.auth !== undefined) entry.auth = Number(entry.auth);
    return entry;
}

function normalizeDocMemberEntryList(values: unknown): DocMemberEntry[] {
    return readArray(values).map(normalizeDocMemberEntry).filter((v): v is DocMemberEntry => v !== null);
}

function buildDocMemberAuthRequest(params: {
    docId: string;
    viewers?: unknown;
    collaborators?: unknown;
    removeViewers?: unknown;
    removeCollaborators?: unknown;
    authLevel?: number; // Default auth level for new members if not specified in entry
}): Record<string, unknown> {
    const { docId, viewers, collaborators, removeViewers, removeCollaborators, authLevel } = params;
    const payload: Record<string, unknown> = {
        docid: readString(docId),
    };
    if (!payload.docid) throw new Error("docId required");

    const normalizedViewers = normalizeDocMemberEntryList(viewers).map(v => ({ ...v, auth: v.auth ?? authLevel ?? 1 }));
    const normalizedCollaborators = normalizeDocMemberEntryList(collaborators).map(v => ({ ...v, auth: v.auth ?? authLevel ?? 2 }));
    const normalizedRemovedViewers = normalizeDocMemberEntryList(removeViewers);
    const normalizedRemovedCollaborators = normalizeDocMemberEntryList(removeCollaborators);

    if (normalizedViewers.length > 0) payload.update_file_member_list = normalizedViewers;
    if (normalizedCollaborators.length > 0) payload.update_co_auth_list = normalizedCollaborators;
    if (normalizedRemovedViewers.length > 0) payload.del_file_member_list = normalizedRemovedViewers;
    if (normalizedRemovedCollaborators.length > 0) payload.del_co_auth_list = normalizedRemovedCollaborators;

    if (
        !payload.update_doc_member_list &&
        !payload.update_co_auth_list &&
        !payload.del_doc_member_list &&
        !payload.del_co_auth_list
    ) {
        throw new Error("at least one viewer/collaborator change is required");
    }

    return payload;
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

        const token = await getAccessToken(agent);
        const url = `${API_BASE}${path}?access_token=${encodeURIComponent(token)}`;
        const proxyUrl = resolveWecomEgressProxyUrlFromNetwork(agent.network);

        let lastErr: any;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await wecomFetch(url, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    body: JSON.stringify(body ?? {}),
                }, { proxyUrl, timeoutMs: LIMITS.REQUEST_TIMEOUT_MS });

                return await parseJsonResponse(res, actionLabel);
            } catch (err) {
                lastErr = err;
                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        throw lastErr;
    }

    async createDoc(params: { agent: ResolvedAgentAccount; docName: string; docType?: unknown; spaceId?: string; fatherId?: string; adminUsers?: string[] }) {
        const { agent, docName, docType, spaceId, fatherId, adminUsers } = params;
        const normalizedDocType = normalizeDocType(docType);
        const payload: Record<string, unknown> = {
            doc_type: normalizedDocType,
            doc_name: readString(docName),
        };
        if (!payload.doc_name) throw new Error("docName required");
        const normalizedSpaceId = readString(spaceId);
        const normalizedFatherId = readString(fatherId);
        if (normalizedSpaceId) payload.spaceid = normalizedSpaceId;
        if (normalizedFatherId) payload.fatherid = normalizedFatherId;
        
        // admin_users is required for smart_table to ensure proper permissions
        const normalizedAdminUsers = Array.isArray(adminUsers)
            ? adminUsers.map((item) => readString(item)).filter(Boolean)
            : [];
        if (normalizedAdminUsers.length > 0) {
            payload.admin_users = normalizedAdminUsers;
        }
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/create_doc",
            actionLabel: "create_doc",
            agent,
            body: payload,
        });
        
        const result = {
            raw: json,
            docId: readString(json.docid),
            url: readString(json.url),
            docType: normalizedDocType,
            docTypeLabel: mapDocTypeLabel(normalizedDocType),
        };
        
        // Auto-initialize smart_table: clean up default fields and records
        if (normalizedDocType === 10) {
            await this.initializeSmartTable({ agent, docId: result.docId });
        }
        
        return result;
    }

    /**
     * Initialize smart_table after creation:
     * 1. Get default sheet (smartsheet type)
     * 2. Get default fields (usually 5 fields)
     * 3. Delete 4 default fields, keep 1 as primary key
     * 4. Get default records (usually 5 empty records)
     * 5. Delete all default records
     */
    private async initializeSmartTable(params: { agent: ResolvedAgentAccount; docId: string }) {
        const { agent, docId } = params;
        
        try {
            // Step 1: Get sheet list to find the default smartsheet
            const sheetsResult = await this.smartTableGetSheets({ agent, docId });
            const defaultSheet = sheetsResult.sheets.find((s: any) => s.type === "smartsheet");
            if (!defaultSheet) return; // No smartsheet found, skip initialization
            
            const sheetId = (defaultSheet as any).sheet_id;
            
            // Step 2: Get default fields
            const fieldsResult = await this.smartTableGetFields({ agent, docId, sheetId });
            const fields = fieldsResult.fields || [];
            
            if (fields.length > 1) {
                // Keep the last field as primary key, delete the rest
                // Primary key capable types: TEXT, NUMBER, DATE_TIME, URL, PROGRESS, EMAIL, PHONE_NUMBER, FORMULA, LOCATION, CURRENCY, AUTONUMBER, TITLE, WWGROUP
                const primaryKeyCapableTypes = [
                    'FIELD_TYPE_TEXT', 'FIELD_TYPE_NUMBER', 'FIELD_TYPE_DATE_TIME',
                    'FIELD_TYPE_URL', 'FIELD_TYPE_PROGRESS', 'FIELD_TYPE_EMAIL',
                    'FIELD_TYPE_PHONE_NUMBER', 'FIELD_TYPE_LOCATION', 'FIELD_TYPE_CURRENCY',
                    'FIELD_TYPE_AUTONUMBER', 'FIELD_TYPE_WWGROUP'
                ];
                
                // Find a field that can be primary key (prefer the last one)
                let fieldToDelete: string[] = [];
                let fieldToKeep: string | null = null;
                
                for (let i = fields.length - 1; i >= 0; i--) {
                    const field = fields[i] as any;
                    if (!fieldToKeep && primaryKeyCapableTypes.includes(field.field_type)) {
                        fieldToKeep = field.field_id;
                    } else if (field.field_id) {
                        fieldToDelete.push(field.field_id);
                    }
                }
                
                // If no primary key capable field found, keep the last one anyway
                if (!fieldToKeep && fields.length > 0) {
                    const lastField = fields[fields.length - 1] as any;
                    fieldToKeep = lastField.field_id;
                    fieldToDelete = fields.slice(0, -1).map((f: any) => f.field_id);
                }
                
                // Delete the fields
                if (fieldToDelete.length > 0) {
                    await this.smartTableDelFields({ agent, docId, sheetId, field_ids: fieldToDelete });
                }
            }
            
            // Step 3: Get default records
            const recordsResult = await this.smartTableGetRecords({ agent, docId, sheetId, limit: 100 });
            const records = recordsResult.records || [];
            
            if (records.length > 0) {
                // Delete all default empty records
                const recordIds = records.map((r: any) => r.record_id).filter(Boolean);
                if (recordIds.length > 0) {
                    await this.smartTableDelRecords({ agent, docId, sheetId, record_ids: recordIds });
                }
            }
        } catch (err) {
            // Non-fatal: smart_table created, just default cleanup failed
            console.error(`[WecomDocClient] initializeSmartTable failed:`, err);
        }
    }

    async renameDoc(params: { agent: ResolvedAgentAccount; docId: string; newName: string }) {
        const { agent, docId, newName } = params;
        const payload = {
            docid: readString(docId),
            new_name: readString(newName),
        };
        if (!payload.docid) throw new Error("docId required");
        if (!payload.new_name) throw new Error("newName required");
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/rename_doc",
            actionLabel: "rename_doc",
            agent,
            body: payload,
        });
        return {
            raw: json,
            docId: payload.docid,
            newName: payload.new_name,
        };
    }

    async copyDoc(params: { agent: ResolvedAgentAccount; docId: string; newName?: string; spaceId?: string; fatherId?: string }) {
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

    async getDocBaseInfo(params: { agent: ResolvedAgentAccount; docId: string }) {
        const { agent, docId } = params;
        const normalizedDocId = readString(docId);
        if (!normalizedDocId) throw new Error("docId required");
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/get_doc_base_info",
            actionLabel: "get_doc_base_info",
            agent,
            body: { docid: normalizedDocId },
        });
        return {
            raw: json,
            info: json.doc_base_info && typeof json.doc_base_info === "object" ? json.doc_base_info : {},
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
            secureSetting: json.secure_setting && typeof json.secure_setting === "object" ? json.secure_setting : {},
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

    async setDocJoinRule(params: { agent: ResolvedAgentAccount; docId: string; request: any }) {
        const { agent, docId, request } = params;
        const payload = {
            ...readObject(request),
        };
        payload.docid = readString(docId || payload.docid);
        if (!payload.docid) throw new Error("docId required");
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/mod_doc_join_rule",
            actionLabel: "mod_doc_join_rule",
            agent,
            body: payload,
        });
        return {
            raw: json,
            docId: payload.docid as string,
        };
    }

    async setDocMemberAuth(params: { agent: ResolvedAgentAccount; docId: string; request: any }) {
        const { agent, docId, request } = params;
        const payload = {
            ...readObject(request),
        };
        payload.docid = readString(docId || payload.docid);
        if (!payload.docid) throw new Error("docId required");
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/mod_doc_member",
            actionLabel: "mod_doc_member",
            agent,
            body: payload,
        });
        return {
            raw: json,
            docId: payload.docid as string,
        };
    }

    async grantDocAccess(params: {
        agent: ResolvedAgentAccount;
        docId: string;
        viewers?: unknown;
        collaborators?: unknown;
        removeViewers?: unknown;
        removeCollaborators?: unknown;
        authLevel?: number;
    }) {
        const { agent, docId, viewers, collaborators, removeViewers, removeCollaborators, authLevel } = params;
        
        // Auto-detect: if adding collaborators, check if they are already viewers and need to be removed
        // This prevents the "user is viewer but not collaborator" issue
        let finalRemoveViewers = removeViewers;
        if (collaborators && !removeViewers) {
            // Need to check current auth status
            try {
                const currentAuth = await this.getDocAuth({ agent, docId });
                // Build a map of viewer entries with their full structure (preserving type and other fields)
                const viewerMap = new Map<string, any>();
                (currentAuth.docMembers || [])
                    .filter((m: any) => m.userid)
                    .forEach((m: any) => viewerMap.set(m.userid, m));
                
                // Normalize new collaborators to get their userids
                const newCollaboratorEntries = normalizeDocMemberEntryList(collaborators);
                
                // Auto-add viewers who are being promoted to collaborators, preserving their original structure
                const autoRemoveViewers = newCollaboratorEntries
                    .filter(entry => entry.userid && viewerMap.has(entry.userid))
                    .map(entry => {
                        // Preserve the original viewer's full structure (type, userid, etc.)
                        const originalViewer = viewerMap.get(entry.userid!);
                        return { ...originalViewer };
                    });
                
                if (autoRemoveViewers.length > 0) {
                    finalRemoveViewers = autoRemoveViewers;
                }
            } catch (err) {
                // If we can't check auth, proceed without auto-removal
                // The caller can explicitly pass removeViewers if needed
            }
        }
        
        const payload = buildDocMemberAuthRequest({
            docId,
            viewers,
            collaborators,
            removeViewers: finalRemoveViewers,
            removeCollaborators,
            authLevel,
        });
        const result = await this.setDocMemberAuth({
            agent,
            docId: payload.docid as string,
            request: payload,
        });
        return {
            ...result,
            addedViewerCount: (payload.update_file_member_list as any[])?.length ?? 0,
            addedCollaboratorCount: (payload.update_co_auth_list as any[])?.length ?? 0,
            removedViewerCount: (payload.del_file_member_list as any[])?.length ?? 0,
            removedCollaboratorCount: (payload.del_co_auth_list as any[])?.length ?? 0,
        };
    }

    async addDocCollaborators(params: { agent: ResolvedAgentAccount; docId: string; collaborators: unknown; auth?: number }) {
        const { agent, docId, collaborators, auth } = params;
        return this.grantDocAccess({
            agent,
            docId,
            collaborators,
            authLevel: auth ?? 2, // Default to edit/read-write for collaborators
        });
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

    async createCollect(params: { agent: ResolvedAgentAccount; formInfo: any; spaceId?: string; fatherId?: string }) {
        const { agent, formInfo, spaceId, fatherId } = params;
        
        // Validate form_info structure per API spec
        if (!formInfo || typeof formInfo !== 'object') {
            throw new Error("formInfo 必须是非空对象");
        }
        
        // Validate required fields
        if (!formInfo.form_title || readString(formInfo.form_title).length === 0) {
            throw new Error("form_title 必填");
        }
        
        if (!formInfo.form_question || !formInfo.form_question.items || !Array.isArray(formInfo.form_question.items)) {
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
            if (q.must_reply === undefined || typeof q.must_reply !== 'boolean') {
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
                        throw new Error(`第${index + 1}个问题的第${optIndex + 1}个选项：status 必须为 1(正常) 或 2(删除)`);
                    }
                });
            }
            
            // Validate image/file upload limits
            if ([9, 10].includes(q.reply_type)) { // 图片/文件
                const setting = q.question_extend_setting;
                if (setting) {
                    const limit = setting.image_setting?.upload_image_limit || setting.file_setting?.upload_file_limit;
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
            if (!formSetting.fill_in_range || (!formSetting.fill_in_range.userids?.length && !formSetting.fill_in_range.departmentids?.length)) {
                throw new Error("timed_repeat_info 开启时，fill_in_range 必填（需指定 userids 或 departmentids）");
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

    async modifyCollect(params: { agent: ResolvedAgentAccount; oper: string; formId: string; formInfo: any }) {
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
                throw new Error("oper=1 时，必须提供 form_question.items 数组（包含所有问题，缺失的问题将被删除）");
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
                if (q.must_reply === undefined || typeof q.must_reply !== 'boolean') {
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
            if (!formInfo || !formInfo.form_setting || typeof formInfo.form_setting !== 'object') {
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

    async getFormAnswer(params: { agent: ResolvedAgentAccount; repeatedId: string; answerIds?: unknown[] }) {
        const { agent, repeatedId, answerIds } = params;
        const normalizedRepeatedId = readString(repeatedId);
        if (!normalizedRepeatedId) throw new Error("repeatedId required");
        const normalizedAnswerIds = Array.isArray(answerIds)
            ? answerIds
                .map((item) => Number(item))
                .filter((item) => Number.isFinite(item))
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
                    throw new Error(`第${index + 1}个请求：req_type=2 时必须提供 start_time 和 end_time（当天时间戳）`);
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

    // --- Content Operations (New) ---

    async getDocContent(params: { agent: ResolvedAgentAccount; docId: string }) {
        const { agent, docId } = params;
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/document/get",
            actionLabel: "get_doc_content",
            agent,
            body: { docid: readString(docId) },
        }) as GetDocContentResponse;
        
        // Ensure structure strictly matches official API: { version: number, document: Node }
        return {
            raw: json,
            version: json.version,
            document: json.document
        };
    }

    async updateDocContent(params: { agent: ResolvedAgentAccount; docId: string; requests: UpdateRequest[]; version?: number; batchMode?: boolean }) {
        const { agent, docId, requests, version } = params;
        
        // Validate requests structure basic check
        const requestList = readArray(requests);
        if (requestList.length === 0) {
             throw new Error("requests list cannot be empty");
        }
        
        // Validate version difference (≤100 per official API)
        if (version !== undefined && version !== null) {
            const currentContent = await this.getDocContent({ agent, docId });
            const versionDiff = Math.abs(currentContent.version - version);
            if (versionDiff > 100) {
                throw new Error(`version 与最新版本差值不能超过 100（当前版本：${currentContent.version}，传入版本：${version}，差值：${versionDiff}）`);
            }
        }
        
        // Validate each request's ranges count (≤10 per official API)
        requestList.forEach((req: any, index: number) => {
            if (req.replace_text?.ranges && req.replace_text.ranges.length > 10) {
                throw new Error(`第${index + 1}个操作：replace_text.ranges 不能超过 10 个`);
            }
            if (req.update_text_property?.ranges && req.update_text_property.ranges.length > 10) {
                throw new Error(`第${index + 1}个操作：update_text_property.ranges 不能超过 10 个`);
            }
            // Validate insert_table limits
            if (req.insert_table) {
                const { rows, cols } = req.insert_table;
                if (rows > 100) throw new Error(`第${index + 1}个操作：insert_table 行数不能超过 100`);
                if (cols > 60) throw new Error(`第${index + 1}个操作：insert_table 列数不能超过 60`);
                if (rows * cols > 1000) throw new Error(`第${index + 1}个操作：insert_table 单元格总数不能超过 1000`);
            }
        });

        // Official API limit: ≤30 operations per batch
        const MAX_OPERATIONS = 30;
        if (requestList.length <= MAX_OPERATIONS) {
            // Single batch
            const body: Record<string, unknown> = {
                docid: readString(docId),
                requests: requestList,
            };
            if (version !== undefined && version !== null) {
                body.version = Number(version);
            }
            
            const json = await this.postWecomDocApi({
                path: "/cgi-bin/wedoc/document/batch_update",
                actionLabel: "update_doc_content",
                agent,
                body,
            }) as BatchUpdateDocResponse;
            return { raw: json, batches: 1 };
        }
        
        // Auto-batch: split into multiple requests
        // Note: Each batch updates the version, so we need to get latest version for each batch
        const batches: BatchUpdateDocResponse[] = [];
        for (let i = 0; i < requestList.length; i += MAX_OPERATIONS) {
            const batchRequests = requestList.slice(i, i + MAX_OPERATIONS);
            
            // Get latest version before each batch (except first if version provided)
            let currentVersion = version;
            if (i > 0 || currentVersion === undefined || currentVersion === null) {
                const content = await this.getDocContent({ agent, docId });
                currentVersion = content.version;
            }
            
            const body: Record<string, unknown> = {
                docid: readString(docId),
                requests: batchRequests,
                version: currentVersion,
            };
            
            const json = await this.postWecomDocApi({
                path: "/cgi-bin/wedoc/document/batch_update",
                actionLabel: `update_doc_content_batch_${Math.floor(i / MAX_OPERATIONS) + 1}`,
                agent,
                body,
            }) as BatchUpdateDocResponse;
            batches.push(json);
        }
        
        return { raw: batches[batches.length - 1], batches: batches.length, allBatches: batches };
    }

    // --- Spreadsheet Operations ---

    async getSheetProperties(params: { agent: ResolvedAgentAccount; docId: string }) {
        const { agent, docId } = params;
        const normalizedDocId = readString(docId);
        if (!normalizedDocId) throw new Error("docId required");
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/spreadsheet/get_sheet_properties",
            actionLabel: "get_sheet_properties",
            agent,
            body: { docid: normalizedDocId },
        });
        return {
            raw: json,
            properties:
                (Array.isArray(json.properties) && json.properties) ||
                (Array.isArray(json.sheet_properties) && json.sheet_properties) ||
                (Array.isArray(json.sheet_list) && json.sheet_list) ||
                [],
        };
    }

    async modDocMemberNotifiedScope(params: { agent: ResolvedAgentAccount; docId: string; notified_scope_type: number; notified_member_list?: any[] }) {
        const { agent, docId, notified_scope_type, notified_member_list } = params;
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/mod_doc_member_notified_scope",
            actionLabel: "mod_doc_member_notified_scope",
            agent,
            body: { docid: readString(docId), notified_scope_type, notified_member_list },
        });
        return json;
    }

    async editSheetData(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string;
        startRow?: number;
        startColumn?: number;
        gridData?: any;
        requests?: any[];  // For direct batch_update with multiple operations
    }) {
        const { agent, docId, sheetId, startRow = 0, startColumn = 0, gridData, requests } = params;
        
        // Validate required docId
        const normalizedDocId = readString(docId);
        if (!normalizedDocId) {
            throw new Error('docId is required');
        }
        
        // Validate required sheetId
        const normalizedSheetId = readString(sheetId);
        if (!normalizedSheetId) {
            throw new Error('sheetId is required');
        }
        
        // Handle direct requests (for multiple operations)
        if (requests && requests.length > 0) {
            // Official API limit: ≤5 operations per batch
            const MAX_OPERATIONS = 5;
            
            // Validate each request
            requests.forEach((req: any, index: number) => {
                if (req.update_range_request?.grid_data?.rows) {
                    const rows = req.update_range_request.grid_data.rows;
                    const rowCount = rows.length;
                    const rowWidths = rows.map((row: any) => row.values?.length || 0);
                    const columnCount = rowWidths.length > 0 ? Math.max(...rowWidths) : 0;
                    const totalCells = rowWidths.reduce((sum: number, width: number) => sum + width, 0);
                    
                    if (rowCount > 1000) throw new Error(`第${index + 1}个操作：行数不能超过 1000`);
                    if (columnCount > 200) throw new Error(`第${index + 1}个操作：列数不能超过 200`);
                    if (totalCells > 10000) throw new Error(`第${index + 1}个操作：单元格总数不能超过 10000`);
                }
            });
            
            if (requests.length > MAX_OPERATIONS) {
                throw new Error(`单次批量更新最多${MAX_OPERATIONS}个操作，当前：${requests.length}`);
            }
            
            const body = {
                docid: normalizedDocId,
                requests: requests
            };
            
            const json = await this.postWecomDocApi({
                path: "/cgi-bin/wedoc/spreadsheet/batch_update",
                actionLabel: "spreadsheet_batch_update",
                agent, body,
            });
            return { 
                raw: json, 
                docId: normalizedDocId,
                operations: requests.length
            };
        }
        
        // Handle single gridData update
        if (!gridData) {
            throw new Error('gridData or requests is required');
        }
        
        // Build GridData per official API
        // gridData.rows[i].values[j] must be: {cell_value: {text} | {link: {text, url}}, cell_format?: {...}}
        const rows = (gridData.rows || []).map((row: any) => ({
            values: (row.values || []).map((cell: any) => {
                // If already CellData format, use as-is
                if (cell && typeof cell === 'object' && cell.cell_value) {
                    return cell;
                }
                // Support link simplified format: { url: '...', text: '...' }
                if (cell && typeof cell === 'object' && cell.url) {
                    return { 
                        cell_value: { 
                            link: { 
                                url: String(cell.url), 
                                text: String(cell.text ?? cell.url) 
                            } 
                        } 
                    };
                }
                // Otherwise wrap primitive as CellValue with text
                return { cell_value: { text: String(cell ?? '') } };
            })
        }));
        
        // Validate range limits per API spec
        const rowCount = rows.length;
        const rowWidths = rows.map((row: any) => row.values?.length || 0);
        const columnCount = rowWidths.length > 0 ? Math.max(...rowWidths) : 0;
        const totalCells = rowWidths.reduce((sum: number, width: number) => sum + width, 0);
        
        if (rowCount > 1000) {
            throw new Error(`行数不能超过 1000，当前：${rowCount}`);
        }
        if (columnCount > 200) {
            throw new Error(`列数不能超过 200，当前：${columnCount}`);
        }
        if (totalCells > 10000) {
            throw new Error(`单元格总数不能超过 10000，当前：${totalCells}`);
        }
        
        const finalGridData = {
            start_row: startRow,
            start_column: startColumn,
            rows: rows
        };
        
        // Build batch_update request per official API (single operation)
        const body = {
            docid: normalizedDocId,
            requests: [{
                update_range_request: {
                    sheet_id: normalizedSheetId,
                    grid_data: finalGridData
                }
            }]
        };
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/spreadsheet/batch_update",
            actionLabel: "spreadsheet_batch_update",
            agent, body,
        });
        return { 
            raw: json, 
            docId: normalizedDocId,
            updatedCells: json.data?.responses?.[0]?.update_range_response?.updated_cells || 0
        };
    }
    
    /**
     * Build CellFormat object per official API
     */
    private buildCellFormat(formatData: any): any {
        const textFormat: any = {};
        
        // Font properties
        if (formatData.font != null) {
            textFormat.font = String(formatData.font);
        }
        if (formatData.font_size != null) {
            textFormat.font_size = Math.min(72, Math.max(1, Number(formatData.font_size)));
        }
        if (formatData.bold != null) {
            textFormat.bold = Boolean(formatData.bold);
        }
        if (formatData.italic != null) {
            textFormat.italic = Boolean(formatData.italic);
        }
        if (formatData.strikethrough != null) {
            textFormat.strikethrough = Boolean(formatData.strikethrough);
        }
        if (formatData.underline != null) {
            textFormat.underline = Boolean(formatData.underline);
        }
        
        // Color (RGBA)
        if (formatData.color != null && typeof formatData.color === "object") {
            const color = formatData.color;
            textFormat.color = {
                red: Math.min(255, Math.max(0, Number(color.red ?? 0))),
                green: Math.min(255, Math.max(0, Number(color.green ?? 0))),
                blue: Math.min(255, Math.max(0, Number(color.blue ?? 0))),
                alpha: Math.min(255, Math.max(0, Number(color.alpha ?? 255)))
            };
        }
        
        // Return empty object if no format properties
        if (Object.keys(textFormat).length === 0) {
            return null;
        }
        
        return { text_format: textFormat };
    }

    async getSheetData(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; range: string }) {
        const { agent, docId, sheetId, range } = params;
        const body = { docid: readString(docId), sheet_id: readString(sheetId), range: readString(range) };
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/spreadsheet/get_sheet_range_data",
            actionLabel: "get_sheet_range_data",
            agent, body,
        });
        return { raw: json, data: json };
    }

    async modifySheetProperties(params: { agent: ResolvedAgentAccount; docId: string; requests: unknown[] }) {
        const { agent, docId, requests } = params;
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/spreadsheet/batch_update",
            actionLabel: "spreadsheet_batch_update",
            agent, body: { docid: readString(docId), requests: readArray(requests) },
        });
        return { raw: json, docId: docId };
    }

    // --- Smart Table Operations ---

    async smartTableOperate(params: { agent: ResolvedAgentAccount; docId: string; operation: string; bodyData: any }) {
        const { agent, docId, operation, bodyData } = params;
        const body = { docid: readString(docId), ...readObject(bodyData) };
        const path = `/cgi-bin/wedoc/smartsheet/${operation}`;
        const json = await this.postWecomDocApi({
            path,
            actionLabel: `smartsheet_${operation}`,
            agent, body,
        });
        return { raw: json, docId };
    }

    async smartTableGetSheets(params: { agent: ResolvedAgentAccount; docId: string; sheet_id?: string; need_all_type_sheet?: boolean }) {
        const { agent, docId, sheet_id, need_all_type_sheet } = params;
        const payload: Record<string, unknown> = {
            docid: readString(docId),
        };
        if (sheet_id) payload.sheet_id = sheet_id;
        if (need_all_type_sheet !== undefined) payload.need_all_type_sheet = need_all_type_sheet;
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/get_sheet",
            actionLabel: "smartsheet_get_sheet",
            agent,
            body: payload,
        });
        return {
            raw: json,
            sheets: readArray(json.sheet_list),
        };
    }

    async smartTableAddSheet(params: { agent: ResolvedAgentAccount; docId: string; title: string; index?: number }) {
        const { agent, docId, title, index } = params;
        return this.smartTableOperate({ agent, docId, operation: "add_sheet", bodyData: { properties: { title, index } } });
    }

    async smartTableDelSheet(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string }) {
        const { agent, docId, sheetId } = params;
        return this.smartTableOperate({ agent, docId, operation: "delete_sheet", bodyData: { sheet_id: sheetId } });
    }

    async smartTableUpdateSheet(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; title: string }) {
        const { agent, docId, sheetId, title } = params;
        return this.smartTableOperate({ agent, docId, operation: "update_sheet", bodyData: { properties: { sheet_id: sheetId, title } } });
    }
    async smartTableAddView(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        view_title: string; 
        view_type: string;
        property?: any;  // ViewProperty: sort_spec, filter_spec, group_spec, etc.
        property_gantt?: any;  // Deprecated, use property instead
        property_calendar?: any;  // Deprecated, use property instead
    }) {
        const { agent, docId, sheetId, view_title, view_type, property, property_gantt, property_calendar } = params;
        const payload: Record<string, unknown> = {
            docid: readString(docId),
            sheet_id: readString(sheetId),
            view_title: readString(view_title),
            view_type: readString(view_type),
        };
        if (property && typeof property === 'object') {
            payload.property = property;
        }
        // Support deprecated property_gantt/property_calendar for backward compatibility
        if (property_gantt) payload.property_gantt = property_gantt;
        if (property_calendar) payload.property_calendar = property_calendar;
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/add_view",
            actionLabel: "smartsheet_add_view",
            agent,
            body: payload,
        });
        return {
            raw: json,
            view: json.view,
        };
    }

    async smartTableUpdateView(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        view_id: string; 
        view_title?: string;
        property?: any;  // ViewProperty: sort_spec, filter_spec, group_spec, etc.
        property_gantt?: any;  // Deprecated, use property instead
        property_calendar?: any;  // Deprecated, use property instead
    }) {
        const { agent, docId, sheetId, view_id, view_title, property, property_gantt, property_calendar } = params;
        const payload: Record<string, unknown> = {
            docid: readString(docId),
            sheet_id: readString(sheetId),
            view_id: readString(view_id),
        };
        if (view_title) payload.view_title = readString(view_title);
        if (property && typeof property === 'object') {
            payload.property = property;
        }
        // Support deprecated property_gantt/property_calendar for backward compatibility
        if (property_gantt) payload.property_gantt = property_gantt;
        if (property_calendar) payload.property_calendar = property_calendar;
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/update_view",
            actionLabel: "smartsheet_update_view",
            agent,
            body: payload,
        });
        return {
            raw: json,
            view: json.view,
        };
    }

    async smartTableDelView(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; view_ids: string[] }) {
        const { agent, docId, sheetId, view_ids } = params;
        
        if (!Array.isArray(view_ids) || view_ids.length === 0) {
            throw new Error("view_ids 必须是非空数组");
        }
        
        return this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/delete_views",
            actionLabel: "smartsheet_del_view",
            agent,
            body: {
                docid: readString(docId),
                sheet_id: readString(sheetId),
                view_ids: view_ids,
            },
        });
    }

    async smartTableGetViews(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        view_ids?: string[];
        offset?: number;
        limit?: number;
    }) {
        const { agent, docId, sheetId, view_ids, offset, limit } = params;
        const payload: Record<string, unknown> = {
            docid: readString(docId),
            sheet_id: readString(sheetId),
        };
        if (view_ids && Array.isArray(view_ids)) payload.view_ids = view_ids;
        if (offset !== undefined) payload.offset = offset;
        if (limit !== undefined) payload.limit = limit;
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/get_views",
            actionLabel: "smartsheet_get_views",
            agent,
            body: payload,
        });
        return {
            raw: json,
            views: readArray(json.views),
            total: json.total,
            has_more: json.has_more,
            next: json.next,
        };
    }

    async smartTableAddFields(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        fields: any[];
        autoCleanupDefaultField?: boolean; // Auto-delete leftover default field after adding new fields
    }) {
        const { agent, docId, sheetId, fields, autoCleanupDefaultField = true } = params;
        
        // Validate fields per official API spec
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error("fields 必须是非空数组");
        }
        
        // Validate each field has required field_title and field_type
        fields.forEach((field: any, index: number) => {
            if (!field.field_title) {
                throw new Error(`第${index + 1}个字段：field_title 必填`);
            }
            if (!field.field_type) {
                throw new Error(`第${index + 1}个字段：field_type 必填`);
            }
            // Validate field_type is valid enum value
            const validFieldTypes = [
                'FIELD_TYPE_TEXT', 'FIELD_TYPE_NUMBER', 'FIELD_TYPE_CHECKBOX',
                'FIELD_TYPE_DATE_TIME', 'FIELD_TYPE_IMAGE', 'FIELD_TYPE_ATTACHMENT',
                'FIELD_TYPE_USER', 'FIELD_TYPE_URL', 'FIELD_TYPE_SELECT',
                'FIELD_TYPE_CREATED_USER', 'FIELD_TYPE_MODIFIED_USER', 'FIELD_TYPE_CREATED_TIME',
                'FIELD_TYPE_MODIFIED_TIME', 'FIELD_TYPE_PROGRESS', 'FIELD_TYPE_PHONE_NUMBER',
                'FIELD_TYPE_EMAIL', 'FIELD_TYPE_SINGLE_SELECT', 'FIELD_TYPE_REFERENCE',
                'FIELD_TYPE_LOCATION', 'FIELD_TYPE_CURRENCY', 'FIELD_TYPE_WWGROUP',
                'FIELD_TYPE_AUTONUMBER', 'FIELD_TYPE_PERCENTAGE', 'FIELD_TYPE_BARCODE'
            ];
            if (!validFieldTypes.includes(field.field_type)) {
                throw new Error(`第${index + 1}个字段：field_type 必须是有效的字段类型（见 FieldType 枚举）`);
            }
        });
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/add_fields",
            actionLabel: "smartsheet_add_fields",
            agent,
            body: {
                docid: readString(docId),
                sheet_id: readString(sheetId),
                fields: fields,
            },
        });
        
        const result = {
            raw: json,
            fields: readArray(json.fields),
        };
        
        // Auto-cleanup: delete leftover default field after successfully adding new fields
        // This handles the case where initializeSmartTable kept 1 default field
        if (autoCleanupDefaultField) {
            await this.cleanupLeftoverDefaultField({ agent, docId, sheetId, newlyAddedFieldCount: result.fields.length });
        }
        
        return result;
    }

    /**
     * Cleanup leftover default field after adding new fields
     * When user adds new fields, we can safely delete the leftover default field from initialization
     */
    private async cleanupLeftoverDefaultField(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string;
        newlyAddedFieldCount: number;
    }) {
        const { agent, docId, sheetId, newlyAddedFieldCount } = params;
        
        try {
            // Get all fields to find the leftover default field
            const fieldsResult = await this.smartTableGetFields({ agent, docId, sheetId, limit: 100 });
            const allFields = fieldsResult.fields || [];
            
            // After adding N new fields to a table with 1 default field, we should have N+1 fields
            // If total = newlyAdded + 1, then there's 1 leftover default field to delete
            if (allFields.length === newlyAddedFieldCount + 1 && newlyAddedFieldCount > 0) {
                // Find the field that looks like a leftover default
                // Default fields typically have generic titles like "文本", "数字", "日期", "单选", "人员"
                const defaultFieldTitles = ['文本', '数字', '日期', '单选', '人员', '文本 1', '数字 1', '日期 1', '单选 1', '人员 1'];
                const defaultFieldTypes = ['FIELD_TYPE_TEXT', 'FIELD_TYPE_NUMBER', 'FIELD_TYPE_DATE_TIME', 'FIELD_TYPE_SINGLE_SELECT', 'FIELD_TYPE_USER'];
                
                const leftoverField = allFields.find((field: any) => {
                    const isDefaultTitle = defaultFieldTitles.includes(field.field_title);
                    const isDefaultType = defaultFieldTypes.includes(field.field_type);
                    return isDefaultTitle && isDefaultType;
                }) as any;
                
                if (leftoverField && leftoverField.field_id) {
                    await this.smartTableDelFields({ agent, docId, sheetId, field_ids: [leftoverField.field_id] });
                }
            }
        } catch (err) {
            // Non-fatal: new fields added, just cleanup failed
            console.error(`[WecomDocClient] cleanupLeftoverDefaultField failed:`, err);
        }
    }

    async smartTableUpdateFields(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        fields: any[];
    }) {
        const { agent, docId, sheetId, fields } = params;
        
        // Validate fields per official API spec
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error("fields 必须是非空数组");
        }
        
        // Validate each field has required field_id and field_type
        fields.forEach((field: any, index: number) => {
            if (!field.field_id) {
                throw new Error(`第${index + 1}个字段：field_id 必填`);
            }
            if (!field.field_type) {
                throw new Error(`第${index + 1}个字段：field_type 必填`);
            }
            // field_title is optional for update, but at least one of field_title or property_* must be provided
            if (!field.field_title && !Object.keys(field).some(key => key.startsWith('property_'))) {
                throw new Error(`第${index + 1}个字段：field_title 或 property_* 属性至少提供一个`);
            }
        });
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/update_fields",
            actionLabel: "smartsheet_update_fields",
            agent,
            body: {
                docid: readString(docId),
                sheet_id: readString(sheetId),
                fields: fields,
            },
        });
        return {
            raw: json,
            fields: readArray(json.fields),
        };
    }

    async smartTableDelFields(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; field_ids: string[] }) {
        const { agent, docId, sheetId, field_ids } = params;
        
        if (!Array.isArray(field_ids) || field_ids.length === 0) {
            throw new Error("field_ids 必须是非空数组");
        }
        
        return this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/delete_fields",
            actionLabel: "smartsheet_del_fields",
            agent,
            body: {
                docid: readString(docId),
                sheet_id: readString(sheetId),
                field_ids: field_ids,
            },
        });
    }

    async smartTableGetFields(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        view_id?: string;
        field_ids?: string[];
        field_titles?: string[];
        offset?: number;
        limit?: number;
    }) {
        const { agent, docId, sheetId, view_id, field_ids, field_titles, offset, limit } = params;
        const payload: Record<string, unknown> = {
            docid: readString(docId),
            sheet_id: readString(sheetId),
        };
        if (view_id) payload.view_id = view_id;
        if (field_ids && Array.isArray(field_ids)) payload.field_ids = field_ids;
        if (field_titles && Array.isArray(field_titles)) payload.field_titles = field_titles;
        if (offset !== undefined) payload.offset = offset;
        if (limit !== undefined) payload.limit = limit;
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/get_fields",
            actionLabel: "smartsheet_get_fields",
            agent,
            body: payload,
        });
        return {
            raw: json,
            fields: readArray(json.fields),
            total: json.total,
            has_more: json.has_more,
            next: json.next,
        };
    }

    async smartTableAddGroup(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; name: string; children?: string[] }) {
        const { agent, docId, sheetId, name, children } = params;
        return this.smartTableOperate({ agent, docId, operation: "add_field_group", bodyData: { sheet_id: sheetId, name, children } });
    }

    async smartTableDelGroup(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; field_group_id: string }) {
        const { agent, docId, sheetId, field_group_id } = params;
        return this.smartTableOperate({ agent, docId, operation: "delete_field_group", bodyData: { sheet_id: sheetId, field_group_id } });
    }

    async smartTableUpdateGroup(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; field_group_id: string; name?: string; children?: string[] }) {
        const { agent, docId, sheetId, field_group_id, name, children } = params;
        return this.smartTableOperate({ agent, docId, operation: "update_field_group", bodyData: { sheet_id: sheetId, field_group_id, name, children } });
    }

    async smartTableGetGroups(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string }) {
        const { agent, docId, sheetId } = params;
        return this.smartTableOperate({ agent, docId, operation: "get_field_groups", bodyData: { sheet_id: sheetId } });
    }

    async smartTableAddExternalRecords(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; records: any[] }) {
        const { agent, docId, sheetId, records } = params;
        return this.smartTableOperate({ agent, docId, operation: "add_external_records", bodyData: { sheet_id: sheetId, records } });
    }

    async smartTableUpdateExternalRecords(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; records: any[] }) {
        const { agent, docId, sheetId, records } = params;
        return this.smartTableOperate({ agent, docId, operation: "update_external_records", bodyData: { sheet_id: sheetId, records } });
    }

    async smartTableAddRecords(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        records: any[];
        key_type?: string;
    }) {
        const { agent, docId, sheetId, records, key_type } = params;
        
        // Validate records format per official API spec (doc2.txt line 1594-1601)
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error("records 必须是非空数组");
        }
        
        // Strict validation: require correct format based on field type
        // Do NOT auto-convert ambiguous values to avoid corrupting user intent
        const validatedRecords = records.map((record: any, recordIndex: number) => {
            if (!record.values || typeof record.values !== 'object' || Array.isArray(record.values)) {
                throw new Error(`第${recordIndex + 1}条记录：values 必须是非空对象`);
            }
            
            const validatedValues: Record<string, any> = {};
            for (const [key, value] of Object.entries(record.values)) {
                // Accept both array and non-array formats based on field type
                // Array types: TEXT, USER, SELECT, SINGLE_SELECT, CHECKBOX, PHONE_NUMBER, EMAIL, URL, LOCATION, BARCODE, ATTACHMENT, IMAGE
                // Non-array types: NUMBER, DATE_TIME, PROGRESS, CURRENCY, PERCENTAGE
                
                if (Array.isArray(value)) {
                    // Array format - validate structure
                    if (value.length === 0) {
                        throw new Error(`第${recordIndex + 1}条记录字段 "${key}": 数组不能为空`);
                    }
                    validatedValues[key] = value;
                } else if (typeof value === 'number') {
                    // Non-array number - valid for NUMBER, PROGRESS, CURRENCY, PERCENTAGE
                    validatedValues[key] = value;
                } else if (typeof value === 'string' && /^\d{13}$/.test(value)) {
                    // Non-array 13-digit string - valid for DATE_TIME (millisecond timestamp)
                    validatedValues[key] = value;
                } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    // Object format - wrap in array for types like USER, TEXT object
                    // This allows {user_id: "..."} to become [{user_id: "..."}]
                    validatedValues[key] = [value];
                } else {
                    // Reject ambiguous primitives (plain strings, booleans)
                    // Users should explicitly use array format: [{type: "text", text: "..."}]
                    throw new Error(
                        `第${recordIndex + 1}条记录字段 "${key}": 值格式不明确。` +
                        `数字/日期类型直接写值 (25, "1704067200000")，` +
                        `文本/成员/选项类型用数组 ([{"type": "text", "text": "..."}], [{"user_id": "..."}])`
                    );
                }
            }
            
            return {
                ...record,
                values: validatedValues,
            };
        });
        
        const bodyData: Record<string, unknown> = {
            sheet_id: readString(sheetId),
            records: validatedRecords,
        };
        
        if (key_type) {
            bodyData.key_type = key_type;
        }
        
        return this.smartTableOperate({ agent, docId, operation: "add_records", bodyData });
    }

    async smartTableUpdateRecords(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; records: any[] }) {
        const { agent, docId, sheetId, records } = params;
        
        // Strict validation: same as addRecords
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error("records 必须是非空数组");
        }
        
        const validatedRecords = records.map((record: any, recordIndex: number) => {
            if (!record.record_id) {
                throw new Error(`第${recordIndex + 1}条记录缺少 record_id`);
            }
            if (!record.values || typeof record.values !== 'object' || Array.isArray(record.values)) {
                throw new Error(`第${recordIndex + 1}条记录：values 必须是非空对象`);
            }
            
            const validatedValues: Record<string, any> = {};
            for (const [key, value] of Object.entries(record.values)) {
                if (Array.isArray(value)) {
                    if (value.length === 0) {
                        throw new Error(`第${recordIndex + 1}条记录字段 "${key}": 数组不能为空`);
                    }
                    validatedValues[key] = value;
                } else if (typeof value === 'number') {
                    validatedValues[key] = value;
                } else if (typeof value === 'string' && /^\d{13}$/.test(value)) {
                    validatedValues[key] = value;
                } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    validatedValues[key] = [value];
                } else {
                    throw new Error(
                        `第${recordIndex + 1}条记录字段 "${key}": 值格式不明确。` +
                        `数字/日期类型直接写值 (25, "1704067200000")，` +
                        `文本/成员/选项类型用数组 ([{"type": "text", "text": "..."}], [{"user_id": "..."}])`
                    );
                }
            }
            
            return {
                ...record,
                values: validatedValues,
            };
        });
        
        return this.smartTableOperate({ agent, docId, operation: "update_records", bodyData: { sheet_id: sheetId, records: validatedRecords } });
    }

    async smartTableDelRecords(params: { agent: ResolvedAgentAccount; docId: string; sheetId: string; record_ids: string[] }) {
        const { agent, docId, sheetId, record_ids } = params;
        return this.smartTableOperate({ agent, docId, operation: "delete_records", bodyData: { sheet_id: sheetId, record_ids } });
    }

    async smartTableGetRecords(params: { 
        agent: ResolvedAgentAccount; 
        docId: string; 
        sheetId: string; 
        view_id?: string;
        record_ids?: string[];
        key_type?: string;
        field_titles?: string[];
        field_ids?: string[];
        sort?: any[];
        offset?: number;
        limit?: number;
        ver?: number;
        filter_spec?: any;
    }) {
        const { agent, docId, sheetId, view_id, record_ids, key_type, field_titles, field_ids, sort, offset, limit, ver, filter_spec } = params;
        const payload: Record<string, unknown> = {
            docid: readString(docId),
            sheet_id: readString(sheetId),
        };
        if (view_id) payload.view_id = view_id;
        if (record_ids && Array.isArray(record_ids)) payload.record_ids = record_ids;
        if (key_type) payload.key_type = key_type;
        if (field_titles && Array.isArray(field_titles)) payload.field_titles = field_titles;
        if (field_ids && Array.isArray(field_ids)) payload.field_ids = field_ids;
        if (sort && Array.isArray(sort)) payload.sort = sort;
        if (offset !== undefined) payload.offset = offset;
        if (limit !== undefined) payload.limit = limit;
        if (ver !== undefined) payload.ver = ver;
        if (filter_spec && typeof filter_spec === 'object') payload.filter_spec = filter_spec;
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/get_records",
            actionLabel: "smartsheet_get_records",
            agent,
            body: payload,
        });
        return {
            raw: json,
            records: readArray(json.records),
            total: json.total,
            has_more: json.has_more,
            next: json.next,
            ver: json.ver,
        };
    }

    // --- Smartsheet Content Permissions ---

    async smartTableGetSheetPriv(params: { agent: ResolvedAgentAccount; docId: string; type: number; rule_id_list?: number[] }) {
        const { agent, docId, type, rule_id_list } = params;
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/smartsheet/content_priv/get_sheet_priv",
            actionLabel: "smartsheet_get_sheet_priv",
            agent,
            body: { docid: readString(docId), type, rule_id_list },
        });
        return { raw: json };
    }

    async smartTableUpdateSheetPriv(params: { agent: ResolvedAgentAccount; docId: string; type: number; rule_id?: number; name?: string; priv_list: any[] }) {
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

    async smartTableModRuleMember(params: { agent: ResolvedAgentAccount; docId: string; rule_id: number; add_member_range?: any; del_member_range?: any }) {
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

    async smartTableDeleteRule(params: { agent: ResolvedAgentAccount; docId: string; rule_id_list: number[] }) {
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

    async getDocAdvancedAccountList(params: { agent: ResolvedAgentAccount; cursor?: number; limit?: number }) {
        const { agent, cursor, limit } = params;
        return this.postWecomDocApi({
            path: "/cgi-bin/meeting/vip/get_vip_user_list",
            actionLabel: "get_advanced_account_list",
            agent,
            body: { cursor: cursor !== undefined ? String(cursor) : undefined, limit: limit ?? 100 },
        });
    }

    // --- Material Management ---

    async uploadDocImage(params: { agent: ResolvedAgentAccount; docId: string; base64_content: string }) {
        const { agent, docId, base64_content } = params;
        const normalizedDocId = readString(docId);
        if (!normalizedDocId) throw new Error("docId required");
        
        const json = await this.postWecomDocApi({
            path: "/cgi-bin/wedoc/image_upload",
            actionLabel: "upload_doc_image",
            agent,
            body: {
                docid: normalizedDocId,
                base64_content: base64_content
            }
        });
        
        return {
            raw: json,
            url: readString(json.url),
            height: json.height,
            width: json.width,
            size: json.size
        };
    }
}
