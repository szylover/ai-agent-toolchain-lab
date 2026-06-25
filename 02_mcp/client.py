# ──────────────────────────────────────────────────────────────────────────
# 第 2 课 · 客户端：MCP Client + LLM 桥接 —— 把「三层翻译」演出来
#
# 这是整个 repo 的高潮。运行后看 stderr 日志，你会【亲眼】看到三层：
#
#   ① MCP server   —— 唯一懂 MCP/JSON-RPC 的人（在 server.py，无 LLM）
#   ② runtime/client（本文件）—— 翻译官：tools/list 拿到工具 → 翻成模型格式 →
#                                  模型吐 tool_call → 它再 tools/call 去执行
#   ③ LLM          —— 只看到 tools 字段，【完全不知道 MCP 存在】
#
# 跑法：python 02_mcp/client.py   （配了 .env 用真模型，否则 mock）
# ──────────────────────────────────────────────────────────────────────────

import sys
import json
import asyncio
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")  # 日志走 stderr，否则 Windows 控制台会把中文转义成 \uXXXX
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.llm import chat, MODEL_LABEL  # noqa: E402
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402


def log(*a):
    print(*a, file=sys.stderr, flush=True)


async def run_agent(session, llm_tools, user_question):
    messages = [{"role": "user", "content": user_question}]
    log(f"🧑 用户: {user_question}")

    for _ in range(5):
        # ③ 模型这一层：它只看到 messages + llm_tools，不知道 MCP
        msg = chat(messages, llm_tools)
        messages.append(msg)

        if not msg.get("tool_calls"):
            log(f"🤖 最终答案: {msg['content']}\n")
            return msg["content"]

        for call in msg["tool_calls"]:
            name = call["function"]["name"]
            args = json.loads(call["function"]["arguments"])
            log(f"  ③ 模型吐出 tool_call: {name}({call['function']['arguments']})")
            log("  ② runtime 拦截 → 通过 MCP 的 tools/call 转发给 server…")

            # ★ 真正去执行的是 runtime，通过 MCP，不是模型自己
            result = await session.call_tool(name, arguments=args)
            text = result.content[0].text if result.content else "{}"
            log(f"  ② runtime 收到 server 返回: {text}")

            messages.append({"role": "tool", "tool_call_id": call["id"], "content": text})

    log("⚠️ 达到最大步数，停止（防失控）")


async def main():
    server_path = str(Path(__file__).resolve().parent / "server.py")
    params = StdioServerParameters(command=sys.executable, args=[server_path])

    # ── ① 连接 MCP server（把 server.py 当子进程拉起来，走 stdio）──────────────
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()  # MCP 的 initialize 握手
            log("\n[runtime] ② 已通过 MCP 连上 server（initialize 握手完成）")

            # ── ② tools/list：向 server 要工具清单（只有 runtime 和 server 懂 MCP）──
            resp = await session.list_tools()
            mcp_tools = resp.tools
            log(
                f"[runtime] ② tools/list 拿到 {len(mcp_tools)} 个工具: "
                + ", ".join(t.name for t in mcp_tools)
            )

            # ── ②→③ 翻译：把 MCP 工具 schema 翻成「模型的 function calling 格式」──
            #    模型只认这个格式。MCP 这个词从这里开始就【消失】了。
            llm_tools = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.inputSchema,  # MCP 的 inputSchema 本身就是 JSON Schema
                    },
                }
                for t in mcp_tools
            ]
            log("[runtime] ② 已把工具翻译成模型格式，注意：发给模型的内容里没有 'MCP' 字样\n")

            log("=== 第 2 课：MCP 三层翻译 Demo ===")
            log(f"③ 模型: {MODEL_LABEL}")

            await run_agent(session, llm_tools, "北京今天天气咋样?")
            await run_agent(session, llm_tools, "帮我找无线耳机")

    log("[runtime] 已关闭 MCP 连接。")
    log(
        "\n👉 复盘：① server 全程没碰 LLM，只收结构化参数；"
        "③ 模型全程没见过 'MCP'，只见 tools 字段；② runtime 是中间的翻译官+执行者。"
    )


if __name__ == "__main__":
    asyncio.run(main())
