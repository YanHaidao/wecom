/**
 * WeCom Target Resolver (企业微信目标解析器)
 *
 * 解析 OpenClaw 的 `to` 字段（原始目标字符串），将其转换为企业微信支持的具体接收对象。
 * 支持显式前缀 (party:, tag: 等)、多目标（竖线分隔）和基于规则的启发式推断。
 *
 * **关于"目标发送"与"消息记录"的对应关系 (Target vs Inbound):**
 * - **发送 (Outbound)**: 支持一对多广播 (Party/Tag)。
 *   例如发送给 `party:1`，消息会触达该部门下所有成员。
 * - **接收 (Inbound)**: 总是来自具体的 **用户 (User)** 或 **群聊 (Chat)**。
 *   当成员回复部门广播消息时，可以视为一个新的单聊会话或在该成员的现有单聊中回复。
 *   因此，Outbound Target (如 Party) 与 Inbound Source (User) 不需要也不可能 1:1 强匹配。
 *   广播是"发后即忘" (Fire-and-Forget) 的通知模式，而回复是具体的会话模式。
 */

export interface WecomTarget {
    touser?: string;
    toparty?: string;
    totag?: string;
    chatid?: string;
}

export interface ResolveResult {
    /** 是否成功解析 */
    success: boolean;
    /** 解析后的目标 */
    target?: WecomTarget;
    /** 错误信息（当 success 为 false 时） */
    error?: string;
    /** 原始输入 */
    raw: string;
}

/**
 * 规范化数字字符串，去除前导零用于长度判断
 * 例如: "01" -> "1", "001" -> "1", "123" -> "123"
 */
function normalizeNumericId(id: string): string {
    // 保留至少一位数字，去除前导零
    return id.replace(/^0+/, "") || "0";
}

/**
 * 解析单个目标字符串（不含竖线分隔符）
 * 支持显式前缀 (party:, tag:, user: 等) 和启发式推断
 *
 * @returns 解析成功返回 { target }，前缀值为空返回 { error }
 */
function resolveSingleTarget(segment: string): { target?: WecomTarget; error?: string } {
    const clean = segment.trim();
    if (!clean) return { target: {} };

    // 1. 显式类型前缀
    if (/^party:/i.test(clean)) {
        const value = clean.replace(/^party:/i, "").trim();
        if (!value) return { error: "party: 后缺少目标 ID" };
        return { target: { toparty: value } };
    }
    if (/^dept:/i.test(clean)) {
        const value = clean.replace(/^dept:/i, "").trim();
        if (!value) return { error: "dept: 后缺少目标 ID" };
        return { target: { toparty: value } };
    }
    if (/^tag:/i.test(clean)) {
        const value = clean.replace(/^tag:/i, "").trim();
        if (!value) return { error: "tag: 后缺少目标 ID" };
        return { target: { totag: value } };
    }
    if (/^group:/i.test(clean)) {
        const value = clean.replace(/^group:/i, "").trim();
        if (!value) return { error: "group: 后缺少目标 ID" };
        return { target: { chatid: value } };
    }
    if (/^chat:/i.test(clean)) {
        const value = clean.replace(/^chat:/i, "").trim();
        if (!value) return { error: "chat: 后缺少目标 ID" };
        return { target: { chatid: value } };
    }
    if (/^user:/i.test(clean)) {
        const value = clean.replace(/^user:/i, "").trim();
        if (!value) return { error: "user: 后缺少目标 ID" };
        return { target: { touser: value } };
    }

    // 2. 启发式推断（无前缀时）

    // 群聊 ID 通常以 'wr' (外部群) 或 'wc' 开头
    if (/^(wr|wc)/i.test(clean)) {
        return { target: { chatid: clean } };
    }

    // 纯数字：去除前导零后，1-2位视为部门，3位及以上视为用户
    if (/^\d+$/.test(clean)) {
        const normalized = normalizeNumericId(clean);
        if (normalized.length < 3) {
            return { target: { toparty: clean } };
        }
        return { target: { touser: clean } };
    }

    // 默认为用户
    return { target: { touser: clean } };
}

/**
 * Parses a raw target string into a WecomTarget object.
 * 解析原始目标字符串为 WecomTarget 对象。
 *
 * 逻辑:
 * 1. 移除标准命名空间前缀 (wecom:, qywx: 等)。
 * 2. 按竖线 | 分割为多个段。
 * 3. 对每段独立解析 — 检查显式类型前缀 (party:, tag:, group:, user:)，
 *    或走启发式回退。
 * 4. 合并同类型目标为竖线分隔的多值字符串。
 * 5. 校验: chatid 不支持多值（企业微信 API 限制）。
 *
 * 启发式回退 (无前缀时):
 *    - 以 "wr" 或 "wc" 开头 -> Chat ID (群聊)
 *    - 纯数字（去前导零后 1-2 位）-> Party ID (部门)，如 "1", "2", "01"
 *    - 纯数字（去前导零后 3 位及以上）-> User ID (用户)，如 "123", "00123"
 *    - 其他 -> User ID (用户)
 *
 * 注意: 企业微信 user_id 可能是纯字母(zhangsan)、纯数字(10086)或混合(ZhangSan10086)。
 *       如需发送给3位以上的部门，请使用显式前缀 "party:123"。
 *
 * @param raw - The raw target string (e.g. "party:1", "zhangsan", "wecom:wr123", "10086", "user:zhangsan|party:1")
 * @returns ResolveResult 解析结果，包含成功/失败状态和错误信息
 */
export function resolveWecomTarget(raw: string | undefined): ResolveResult {
    if (!raw?.trim()) {
        return { success: false, error: "目标不能为空", raw: raw || "" };
    }

    // 1. 移除标准命名空间前缀
    const clean = raw.trim().replace(/^(wecom-agent|wecom|wechatwork|wework|qywx):/i, "");

    // 2. 统一按竖线分割，逐段解析
    const segments = clean.split(/\s*\|\s*/);
    const nonEmptySegments = segments.filter(s => s.length > 0);

    if (nonEmptySegments.length === 0) {
        return { success: true, target: {}, raw };
    }

    // 单目标快捷路径
    if (nonEmptySegments.length === 1) {
        const result = resolveSingleTarget(nonEmptySegments[0]);
        if (result.error) {
            return { success: false, error: result.error, raw };
        }
        return { success: true, target: result.target ?? {}, raw };
    }

    // 多目标：逐段解析并合并
    const tousers: string[] = [];
    const topartys: string[] = [];
    const totags: string[] = [];
    const chatids: string[] = [];

    for (const seg of nonEmptySegments) {
        const result = resolveSingleTarget(seg);
        if (result.error) {
            return { success: false, error: result.error, raw };
        }
        const t = result.target;
        if (!t) continue;
        if (t.touser) tousers.push(t.touser);
        if (t.toparty) topartys.push(t.toparty);
        if (t.totag) totags.push(t.totag);
        if (t.chatid) chatids.push(t.chatid);
    }

    // 校验: chatid 不支持多值（企业微信 appchat/send 接口限制）
    if (chatids.length > 1) {
        return { success: false, error: "chatid 不支持多目标，请逐个发送", raw };
    }

    const merged: WecomTarget = {};
    if (tousers.length) merged.touser = tousers.join("|");
    if (topartys.length) merged.toparty = topartys.join("|");
    if (totags.length) merged.totag = totags.join("|");
    if (chatids.length) merged.chatid = chatids[0];

    return { success: true, target: merged, raw };
}

/**
 * 向后兼容的简化接口
 * 解析失败时返回 undefined（不抛出错误）
 * @deprecated 建议使用 resolveWecomTarget 获取完整结果
 */
export function resolveWecomTargetSimple(raw: string | undefined): WecomTarget | undefined {
    const result = resolveWecomTarget(raw);
    return result.success ? result.target : undefined;
}
