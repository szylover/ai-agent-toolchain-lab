# ──────────────────────────────────────────────────────────────────────────
# 共享的「模型调用层」：把 Azure OpenAI 包成一个简单的 chat() 函数。
#
# 关键点（面试常考）：
#   - LLM 是一个「纯函数」：输入 messages + tools，输出一条 assistant 消息。
#   - 它要么给 content（最终答案），要么给 tool_calls（请求你调工具）。
#   - 它自己【不执行】任何工具，也【不知道】MCP——它只认 tools 字段。
#
# 没有 key 也能跑：不设环境变量时自动退化成 mock 模型（见 _mock_chat）。
# 统一返回 dict 形状，mock 和真模型对调用方完全一致。
# ──────────────────────────────────────────────────────────────────────────

import os
import json
import random
import string
from pathlib import Path

# 无第三方依赖也能跑；装了 python-dotenv 就自动加载 .env
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

HAS_KEY = bool(os.environ.get("AZURE_OPENAI_API_KEY"))

USING_REAL_MODEL = HAS_KEY
MODEL_LABEL = (
    f"真模型 (Azure: {os.environ.get('AZURE_OPENAI_DEPLOYMENT')})"
    if HAS_KEY
    else "mock 模型（未配置 .env，零成本运行）"
)


def chat(messages, tools):
    """chat(messages, tools) -> assistant 消息(dict)。接口对 mock / 真模型完全一致。"""
    if HAS_KEY:
        return _real_chat(messages, tools)
    return _mock_chat(messages, tools)


# ── 真模型：Azure OpenAI ────────────────────────────────────────────────────
def _real_chat(messages, tools):
    from openai import AzureOpenAI

    client = AzureOpenAI(
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
    )
    res = client.chat.completions.create(
        model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )
    m = res.choices[0].message
    # 归一化成纯 dict：既能塞回 messages 再发，又能在 agent 循环里统一处理
    out = {"role": "assistant", "content": m.content}
    if m.tool_calls:
        out["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in m.tool_calls
        ]
    return out


# ── mock 模型：用规则模拟「模型的决策」，让你不花钱也能看懂整条链路 ──────────
_mock_turn = {"n": 0}


def _mock_chat(messages, tools):
    last_tool = next((m for m in reversed(messages) if m.get("role") == "tool"), None)
    user_text = next((m["content"] for m in messages if m.get("role") == "user"), "")

    if last_tool is None or _mock_turn["n"] == 0:
        _mock_turn["n"] += 1
        if "天气" in user_text or "weather" in user_text.lower():
            city = next((c for c in ("北京", "上海", "深圳") if c in user_text), "北京")
            return _tool_call("getWeather", {"city": city})
        if any(k in user_text for k in ("买", "找", "搜")) or "search" in user_text.lower():
            kw = user_text
            for k in ("买", "找", "搜索", "搜"):
                if k in kw:
                    kw = kw.split(k)[-1]
            kw = kw.strip() or "耳机"
            return _tool_call("searchProduct", {"keyword": kw})
        return {"role": "assistant", "content": "我可以帮你查天气或找商品，试试问“北京天气”？"}

    _mock_turn["n"] = 0
    data = json.loads(last_tool["content"])
    if "sky" in data:
        return {"role": "assistant", "content": f"{data['city']}今天{data['sky']}，气温约 {data['temp']}℃。"}
    if "results" in data:
        return {
            "role": "assistant",
            "content": f"找到 {data['count']} 个“{data['keyword']}”相关商品：{'、'.join(data['results'])}。",
        }
    return {"role": "assistant", "content": "我处理好了。"}


def _tool_call(name, args):
    cid = "call_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": cid,
                "type": "function",
                "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)},
            }
        ],
    }
