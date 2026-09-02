# `upstreamCorps` 配置

`upstreamCorps` 是 `@yanhaidao/wecom` Agent 配置的一部分，用于一个主企业代开发或管理多个下游企业的
场景。实现已经融合进本插件的 Agent 回调、会话目标、token 交换和出站发送链路。

## 配置示例

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "primary": {
          "agent": {
            "corpId": "ww-primary",
            "corpSecret": "<PRIMARY_SECRET>",
            "agentId": 1000002,
            "token": "<CALLBACK_TOKEN>",
            "encodingAESKey": "<CALLBACK_AES_KEY>",
            "upstreamCorps": {
              "customer-a": {
                "corpId": "ww-customer-a",
                "agentId": 2000001
              }
            }
          }
        }
      }
    }
  }
}
```

对象键只是便于运维识别的标签。真正的入站身份匹配使用每项的 `corpId`，匹配时忽略大小写；
`agentId` 必须能解析为正整数。

## 路由语义

1. 回调的 `ToUserName` 等于主企业 `corpId` 时走主企业路径。
2. 等于某个 `upstreamCorps.*.corpId` 时，目标绑定当前 `accountId`、下游 `corpId` 和用户 ID。
3. 回复前先使用主企业凭据取得 token，再调用 `corpgroup/corp/gettoken` 换取下游 token。
4. 下游文本、媒体下载、媒体上传和发送都使用下游 token 与下游 `agentId`。

## 失败关闭

以下情况直接拒绝，不回退主企业或 Bot：

- `ToUserName` 缺失或没有匹配项。
- 多个映射包含相同的下游 `corpId`。
- `corpId` 为空或 `agentId` 不是正整数。
- 规范回复目标中的 `accountId` 与当前账号不同。
- 下游 token 交换失败。
- 下游群回调缺少可靠的群身份模型。

运行 `openclaw wecom diagnose --json` 可静态检查重复、无效和跨账号配置。真实 token 交换、回调与
媒体回环仍需按根目录 `OFFICIAL_CAPABILITY_ACCEPTANCE.md` 使用脱敏证据验收。
