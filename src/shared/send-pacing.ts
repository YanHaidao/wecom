/**
 * 多分片消息的发送节流。
 *
 * 企微对同一收件人的连续多条消息不保证投递顺序，实测两条落在同一秒内时
 * 客户端的先后是任意的。所以相邻两片之间必须留出足够间隔。
 *
 * 按「距上一片开始发送的时刻」计时，而不是固定 sleep：单次 message/send
 * 的 HTTP 往返实测 200~500ms 且波动大，固定 sleep 在慢往返时是白等、
 * 在快往返时又不够。
 */

/** 相邻两片之间的最小间隔，需要跨过一秒才能保证客户端排序稳定。 */
export const MIN_CHUNK_SEND_SPACING_MS = 1_100;

export type SendPacer = () => Promise<void>;

/**
 * 返回一个在每次发送前调用的节流函数。第一次调用不等待。
 *
 * ```ts
 * const pace = createSendPacer();
 * for (const chunk of chunks) {
 *   await pace();
 *   await send(chunk);
 * }
 * ```
 */
export function createSendPacer(spacingMs: number = MIN_CHUNK_SEND_SPACING_MS): SendPacer {
  let previousSendAt: number | undefined;

  return async function pace(): Promise<void> {
    if (previousSendAt !== undefined) {
      const waitMs = previousSendAt + spacingMs - Date.now();
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    previousSendAt = Date.now();
  };
}
