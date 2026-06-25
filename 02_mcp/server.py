# ──────────────────────────────────────────────────────────────────────────
# 第 2 课 · 服务端：一个【真正的 MCP Server】（官方 mcp Python SDK）
#
# 重点（把你之前的疑问彻底坐实）：
#   ★ 这个文件里【没有任何 LLM】。它就是个「哑」的、确定性的执行器。
#     ——像一个 FastAPI 后端：收到结构化参数 → 干活 → 返回结构化结果。
#   ★ 它通过 MCP 协议（JSON-RPC 2.0 over stdio）对外暴露工具。
#   ★ 它【不知道】上游有没有模型、是 GPT 还是 Claude，它只认 tools/call 请求。
#
# 你不用单独启动它——client.py 会把它当子进程拉起来（stdio transport）。
# ──────────────────────────────────────────────────────────────────────────

import sys
import json

from mcp.server.fastmcp import FastMCP

sys.stderr.reconfigure(encoding="utf-8")  # 日志走 stderr，强制 UTF-8 才能打中文（stdout 被 JSON-RPC 占用）


# stderr 才能安全打日志：stdout 被 JSON-RPC 协议独占，往里写普通文字会污染协议。
def log(*a):
    print("  [MCP server]", *a, file=sys.stderr, flush=True)


mcp = FastMCP("weather-shop-server")


# 工具 1：查天气。注意这里收到的是【结构化参数】，不是一句自然语言。
# 函数签名的类型注解 + docstring 会被 SDK 自动转成 MCP 的 inputSchema/description。
@mcp.tool()
def getWeather(city: str) -> str:
    """查询某城市的实时天气。"""
    log(f"收到 tools/call getWeather(city={city}) ← 结构化参数，不是自然语言！")
    db = {
        "北京": {"temp": 18, "sky": "晴"},
        "上海": {"temp": 24, "sky": "多云"},
        "深圳": {"temp": 30, "sky": "雷阵雨"},
    }
    data = {"city": city, **db.get(city, {"temp": 20, "sky": "未知"})}
    return json.dumps(data, ensure_ascii=False)


# 工具 2：搜商品。
@mcp.tool()
def searchProduct(keyword: str) -> str:
    """按关键词搜索商品。"""
    log(f"收到 tools/call searchProduct(keyword={keyword})")
    data = {"keyword": keyword, "results": [f"{keyword} Pro", f"{keyword} Mini"], "count": 2}
    return json.dumps(data, ensure_ascii=False)


if __name__ == "__main__":
    log("已启动，等待 JSON-RPC 请求（initialize / tools/list / tools/call）…")
    mcp.run()  # 默认 stdio transport
