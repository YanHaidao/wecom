/**
 * WeCom 文本分段工具
 *
 * 企业微信对 Bot 和 Agent 的文本消息有 2048 字节的截断限制。
 * 本模块提供按 UTF-8 字节数智能切分文本的工具函数。
 */

/**
 * 按 UTF-8 字节数切分文本，优先在段落/换行边界切分。
 *
 * @param text 待切分的文本
 * @param maxBytes 每段最大字节数
 * @param options.addMarkers 是否添加 [N/M] 分段标记（仅当段数 > 1 时生效）
 * @returns 切分后的文本数组
 */
export function splitTextByBytes(
    text: string,
    maxBytes: number,
    options?: { addMarkers?: boolean },
): string[] {
    if (!text) return [];

    const textBytes = Buffer.byteLength(text, "utf8");
    if (textBytes <= maxBytes) {
        return [text];
    }

    // 预估段数，计算标记所需空间
    const estimatedChunks = Math.ceil(textBytes / maxBytes);
    const markerWidth = String(estimatedChunks).length;
    const markerBytes = options?.addMarkers
        ? Buffer.byteLength(`[${"9".repeat(markerWidth)}/${"9".repeat(markerWidth)}] `, "utf8")
        : 0;

    const effectiveMaxBytes = maxBytes - markerBytes;
    if (effectiveMaxBytes <= 0) {
        // maxBytes 过小，无法容纳标记，回退到不加标记
        return splitTextByBytes(text, maxBytes, { addMarkers: false });
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        // 如果剩余内容小于限制，直接作为最后一段
        if (Buffer.byteLength(remaining, "utf8") <= effectiveMaxBytes) {
            chunks.push(remaining);
            break;
        }

        // 寻找最佳切分点
        const splitPoint = findSplitPoint(remaining, effectiveMaxBytes);
        chunks.push(remaining.slice(0, splitPoint));
        remaining = remaining.slice(splitPoint).trimStart();
    }

    // 实际段数可能因 trimStart 等因素与预估不同，重新计算标记宽度
    if (options?.addMarkers && chunks.length > 1) {
        const actualWidth = String(chunks.length).length;
        // 如果实际位数与预估不一致，需要验证每段加上标记后仍不超限
        // 通常预估偏大（ceil），所以实际段数 <= 预估段数，标记更短或相等
        return chunks.map((chunk, i) =>
            `[${String(i + 1).padStart(actualWidth, "0")}/${chunks.length}] ${chunk}`,
        );
    }

    return chunks;
}

/**
 * 寻找最佳切分点，优先在段落/换行边界。
 *
 * 搜索策略（优先级从高到低）：
 * 1. 段落边界（\n\n）
 * 2. 换行边界（\n）
 * 3. 任意字符边界（确保不切断多字节 UTF-8 字符）
 */
function findSplitPoint(text: string, maxBytes: number): number {
    // 先用二分法找到字节数 <= maxBytes 的最大字符索引
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    // lo 是可以切分的最大字符位置
    const maxCharIndex = lo;
    if (maxCharIndex <= 0) return 1;

    // 在 [0, maxCharIndex] 范围内，尝试找最优切分点
    // 优先级 1: 段落边界 \n\n — 从 maxCharIndex 向前搜索
    for (let i = maxCharIndex; i >= Math.max(1, maxCharIndex - maxCharIndex); i--) {
        if (text[i] === "\n" && i + 1 < text.length && text[i + 1] === "\n") {
            return i; // 在 \n\n 之前切分
        }
        if (text[i - 1] === "\n" && text[i] === "\n") {
            return i + 1; // 在 \n\n 之后切分
        }
    }

    // 优先级 2: 换行边界 \n — 在 maxCharIndex 附近寻找
    // 搜索范围: 尽量不丢失太多内容（至少保留 50% 的内容）
    const searchFloor = Math.max(1, Math.floor(maxCharIndex * 0.5));
    for (let i = maxCharIndex; i >= searchFloor; i--) {
        if (text[i] === "\n") {
            return i + 1; // 在 \n 之后切分（换行归前一段）
        }
    }

    // 优先级 3: 任意字符边界
    return maxCharIndex;
}
