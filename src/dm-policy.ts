/**
 * 企业微信 DM（私聊）访问控制模块
 *
 * 负责私聊策略检查、配对流程
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { WSClient, WsFrame } from "@wecom/aibot-node-sdk";
import { getWeComRuntime } from "./runtime.js";
import { CHANNEL_ID } from "./const.js";
import type { ResolvedWeComAccount } from "./utils.js";
import { sendWeComReply } from "./message-sender.js";
import { isSenderAllowed } from "./group-policy.js";
import { diagnosticFingerprint, formatDiagnosticError, wecomFlowId } from "./diagnostics.js";

// ============================================================================
// 检查结果类型
// ============================================================================

/**
 * DM Policy 检查结果
 */
export interface DmPolicyCheckResult {
  /** 是否允许继续处理消息 */
  allowed: boolean;
  /** 是否已发送配对消息（仅在 pairing 模式下） */
  pairingSent?: boolean;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 检查 DM Policy 访问控制
 * @returns 检查结果，包含是否允许继续处理
 */
export async function checkDmPolicy(params: {
  senderId: string;
  isGroup: boolean;
  account: ResolvedWeComAccount;
  wsClient: WSClient;
  frame: WsFrame;
  runtime: RuntimeEnv;
}): Promise<DmPolicyCheckResult> {
  const { senderId, isGroup, account, wsClient, frame, runtime } = params;
  const core = getWeComRuntime();
  const sender = diagnosticFingerprint(senderId);
  const traceId = wecomFlowId({
    accountId: account.accountId,
    reqId: frame.headers.req_id,
    messageId: (frame.body as { msgid?: string } | undefined)?.msgid,
  });

  // 群聊消息不检查 DM Policy
  if (isGroup) {
    return { allowed: true };
  }

  const dmPolicy = account.config.dmPolicy ?? "open";
  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));

  // 如果 dmPolicy 是 disabled，直接拒绝
  if (dmPolicy === "disabled") {
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=dm_policy account=${account.accountId} outcome=blocked policy=disabled sender=${sender}`,
    );
    return { allowed: false };
  }

  // 如果是 open 模式，允许所有人
  if (dmPolicy === "open") {
    return { allowed: true };
  }

  const storeAllowFrom = await core.channel.pairing
    .readAllowFromStore({ channel: CHANNEL_ID, accountId: account.accountId })
    .catch(() => []);

  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const senderAllowedResult = isSenderAllowed(senderId, effectiveAllowFrom);

  if (senderAllowedResult) {
    return { allowed: true };
  }

  // 处理未授权用户
  if (dmPolicy === "pairing") {
    const { code, created } = await core.channel.pairing.upsertPairingRequest({
      channel: CHANNEL_ID,
      id: senderId,
      accountId: account.accountId,
      meta: { name: senderId },
    });

    if (created) {
      runtime.log?.(
        `[wecom][flow] trace=${traceId} stage=pairing_request account=${account.accountId} outcome=created sender=${sender}`,
      );
      try {
        await sendWeComReply({
          wsClient,
          frame,
          text: core.channel.pairing.buildPairingReply({
            channel: CHANNEL_ID,
            idLine: `您的企业微信用户ID: ${senderId}`,
            code,
          }),
          runtime,
          finish: true,
          accountId: account.accountId,
          traceId,
        });
      } catch (err) {
        runtime.error?.(
          `[wecom][flow] trace=${traceId} stage=pairing_reply_failed account=${account.accountId} sender=${sender} ${formatDiagnosticError(err)}`,
        );
      }
    } else {
      runtime.log?.(
        `[wecom][flow] trace=${traceId} stage=pairing_request account=${account.accountId} outcome=existing sender=${sender}`,
      );
    }
    return { allowed: false, pairingSent: created };
  }

  // allowlist 模式：直接拒绝未授权用户
  runtime.log?.(
    `[wecom][flow] trace=${traceId} stage=dm_policy account=${account.accountId} outcome=blocked policy=${dmPolicy} sender=${sender}`,
  );
  return { allowed: false };
}
