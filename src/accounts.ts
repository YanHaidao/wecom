import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { ResolvedWecomAccount } from "./types/index.js";
import {
  listWecomAccountIds as listWecomAccountIdsFromConfig,
  resolveDefaultWecomAccountId as resolveDefaultWecomAccountIdFromConfig,
  resolveWecomAccount as resolveWecomAccountFromConfig,
} from "./config/accounts.js";

/**
 * Backward-compatible re-export layer.
 * Keep this file as a thin wrapper so older imports continue to work,
 * while all account logic stays single-sourced in `src/config/accounts.ts`.
 */
export function listWecomAccountIds(cfg: OpenClawConfig): string[] {
  return listWecomAccountIdsFromConfig(cfg);
}

export function resolveDefaultWecomAccountId(cfg: OpenClawConfig): string {
  return resolveDefaultWecomAccountIdFromConfig(cfg);
}

export function resolveWecomAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedWecomAccount {
  return resolveWecomAccountFromConfig(params);
}

export function listEnabledWecomAccounts(cfg: OpenClawConfig): ResolvedWecomAccount[] {
  return listWecomAccountIdsFromConfig(cfg)
    .map((accountId) => resolveWecomAccountFromConfig({ cfg, accountId }))
    .filter((account) => account.enabled);
}
