import { describe, expect, it } from "vitest";

import { shouldProcessAgentInboundMessage } from "./handler.js";

describe("shouldProcessAgentInboundMessage", () => {
    it("skips event callbacks so they do not create sessions", () => {
        const enterAgent = shouldProcessAgentInboundMessage({
            msgType: "event",
            eventType: "enter_agent",
            fromUser: "zhangsan",
        });
        expect(enterAgent.shouldProcess).toBe(false);
        expect(enterAgent.reason).toBe("event:enter_agent");

        const subscribe = shouldProcessAgentInboundMessage({
            msgType: "event",
            eventType: "subscribe",
            fromUser: "lisi",
        });
        expect(subscribe.shouldProcess).toBe(false);
        expect(subscribe.reason).toBe("event:subscribe");
    });

    it("skips system sender callbacks", () => {
        const systemSender = shouldProcessAgentInboundMessage({
            msgType: "text",
            fromUser: "sys",
        });
        expect(systemSender.shouldProcess).toBe(false);
        expect(systemSender.reason).toBe("system_sender");
    });

    it("skips messages with missing sender id", () => {
        const missingSender = shouldProcessAgentInboundMessage({
            msgType: "text",
            fromUser: "   ",
        });
        expect(missingSender.shouldProcess).toBe(false);
        expect(missingSender.reason).toBe("missing_sender");
    });

    it("allows normal user text message processing", () => {
        const normalMessage = shouldProcessAgentInboundMessage({
            msgType: "text",
            fromUser: "wangwu",
        });
        expect(normalMessage.shouldProcess).toBe(true);
        expect(normalMessage.reason).toBe("user_message");
    });
});
