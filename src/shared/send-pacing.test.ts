import { describe, expect, it, vi } from "vitest";
import { MIN_CHUNK_SEND_SPACING_MS, createSendPacer } from "./send-pacing.js";

describe("createSendPacer", () => {
  it("does not delay the first send", async () => {
    vi.useFakeTimers();
    try {
      const pace = createSendPacer(1000);
      let done = false;
      void pace().then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces consecutive sends by the configured interval", async () => {
    vi.useFakeTimers();
    try {
      const pace = createSendPacer(1000);
      await pace();

      let secondDone = false;
      void pace().then(() => {
        secondDone = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(secondDone).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(secondDone).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not add delay when the previous send already took longer than the interval", async () => {
    vi.useFakeTimers();
    try {
      const pace = createSendPacer(1000);
      await pace();
      // 模拟一次耗时 1.5s 的 HTTP 往返：间隔已经够了，不该再等。
      await vi.advanceTimersByTimeAsync(1500);

      let secondDone = false;
      void pace().then(() => {
        secondDone = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(secondDone).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults to an interval that crosses a one-second boundary", () => {
    // 企微消息时间戳是秒级粒度，同秒到达的多条消息排序不稳定。
    expect(MIN_CHUNK_SEND_SPACING_MS).toBeGreaterThan(1000);
  });
});
