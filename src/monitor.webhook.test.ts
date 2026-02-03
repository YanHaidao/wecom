import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { ResolvedWecomAccount } from "./types.js";
import { computeWecomMsgSignature, decryptWecomEncrypted, encryptWecomPlaintext } from "./crypto.js";
import { handleWecomWebhookRequest, registerWecomWebhookTarget } from "./monitor.js";

function createMockRequest(params: {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = params.method;
  req.url = params.url;
  if (params.method === "POST") {
    req.push(JSON.stringify(params.body ?? {}));
  }
  req.push(null);
  return req;
}

function createMockResponse(): ServerResponse & {
  _getData: () => string;
  _getStatusCode: () => number;
} {
  const req = new IncomingMessage(new Socket());
  const res = new ServerResponse(req);
  let data = "";
  res.write = (chunk: any) => {
    data += String(chunk);
    return true;
  };
  res.end = (chunk: any) => {
    if (chunk) data += String(chunk);
    return res;
  };
  (res as any)._getData = () => data;
  (res as any)._getStatusCode = () => res.statusCode;
  return res as any;
}

describe("handleWecomWebhookRequest", () => {
  const token = "test-token";
  const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

  it("handles GET url verification", async () => {
    const account: ResolvedWecomAccount = {
      accountId: "default",
      name: "Test",
      enabled: true,
      configured: true,
      token,
      encodingAESKey,
      receiveId: "",
      config: { webhookPath: "/hook", token, encodingAESKey },
    };

    const unregister = registerWecomWebhookTarget({
      account,
      config: {} as OpenClawConfig,
      runtime: {},
      core: {} as any,
      path: "/hook",
    });

    try {
      const timestamp = "13500001234";
      const nonce = "123412323";
      const echostr = encryptWecomPlaintext({
        encodingAESKey,
        receiveId: "",
        plaintext: "ping",
      });
      const msg_signature = computeWecomMsgSignature({ token, timestamp, nonce, encrypt: echostr });
      const req = createMockRequest({
        method: "GET",
        url: `/hook?msg_signature=${encodeURIComponent(msg_signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}&echostr=${encodeURIComponent(echostr)}`,
      });
      const res = createMockResponse();
      const handled = await handleWecomWebhookRequest(req, res);
      expect(handled).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toBe("ping");
    } finally {
      unregister();
    }
  });

  it("handles POST callback and returns encrypted stream placeholder", async () => {
    const account: ResolvedWecomAccount = {
      accountId: "default",
      name: "Test",
      enabled: true,
      configured: true,
      token,
      encodingAESKey,
      receiveId: "",
      config: { webhookPath: "/hook", token, encodingAESKey },
    };

    const unregister = registerWecomWebhookTarget({
      account,
      config: {} as OpenClawConfig,
      runtime: {},
      core: {} as any,
      path: "/hook",
    });

    try {
      const timestamp = "1700000000";
      const nonce = "nonce";
      const plain = JSON.stringify({
        msgid: "MSGID",
        aibotid: "AIBOTID",
        chattype: "single",
        from: { userid: "USERID" },
        response_url: "RESPONSEURL",
        msgtype: "text",
        text: { content: "hello" },
      });
      const encrypt = encryptWecomPlaintext({ encodingAESKey, receiveId: "", plaintext: plain });
      const msg_signature = computeWecomMsgSignature({ token, timestamp, nonce, encrypt });

      const req = createMockRequest({
        method: "POST",
        url: `/hook?msg_signature=${encodeURIComponent(msg_signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
        body: { encrypt },
      });
      const res = createMockResponse();
      const handled = await handleWecomWebhookRequest(req, res);
      expect(handled).toBe(true);
      expect(res._getStatusCode()).toBe(200);

      const json = JSON.parse(res._getData()) as any;
      expect(typeof json.encrypt).toBe("string");
      expect(typeof json.msgsignature).toBe("string");
      expect(typeof json.timestamp).toBe("string");
      expect(typeof json.nonce).toBe("string");

      const replyPlain = decryptWecomEncrypted({
        encodingAESKey,
        receiveId: "",
        encrypt: json.encrypt,
      });
      const reply = JSON.parse(replyPlain) as any;
      expect(reply.msgtype).toBe("stream");
      expect(reply.stream?.content).toBe("1");
      expect(reply.stream?.finish).toBe(false);
      expect(typeof reply.stream?.id).toBe("string");
      expect(reply.stream?.id.length).toBeGreaterThan(0);

      const expectedSig = computeWecomMsgSignature({
        token,
        timestamp: String(json.timestamp),
        nonce: String(json.nonce),
        encrypt: String(json.encrypt),
      });
      expect(json.msgsignature).toBe(expectedSig);
    } finally {
      unregister();
    }
  });

  it("supports custom streamPlaceholderContent", async () => {
    const account: ResolvedWecomAccount = {
      accountId: "default",
      name: "Test",
      enabled: true,
      configured: true,
      token,
      encodingAESKey,
      receiveId: "",
      config: { webhookPath: "/hook", token, encodingAESKey, streamPlaceholderContent: "正在思考..." },
    };

    const unregister = registerWecomWebhookTarget({
      account,
      config: {} as OpenClawConfig,
      runtime: {},
      core: {} as any,
      path: "/hook",
    });

    try {
      const timestamp = "1700000001";
      const nonce = "nonce2";
      const plain = JSON.stringify({
        msgid: "MSGID2",
        aibotid: "AIBOTID",
        chattype: "single",
        from: { userid: "USERID" },
        response_url: "RESPONSEURL",
        msgtype: "text",
        text: { content: "hello" },
      });
      const encrypt = encryptWecomPlaintext({ encodingAESKey, receiveId: "", plaintext: plain });
      const msg_signature = computeWecomMsgSignature({ token, timestamp, nonce, encrypt });

      const req = createMockRequest({
        method: "POST",
        url: `/hook?msg_signature=${encodeURIComponent(msg_signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
        body: { encrypt },
      });
      const res = createMockResponse();
      const handled = await handleWecomWebhookRequest(req, res);
      expect(handled).toBe(true);
      expect(res._getStatusCode()).toBe(200);

      const json = JSON.parse(res._getData()) as any;
      const replyPlain = decryptWecomEncrypted({
        encodingAESKey,
        receiveId: "",
        encrypt: json.encrypt,
      });
      const reply = JSON.parse(replyPlain) as any;
      expect(reply.msgtype).toBe("stream");
      expect(reply.stream?.content).toBe("正在思考...");
      expect(reply.stream?.finish).toBe(false);
    } finally {
      unregister();
    }
  });
});
