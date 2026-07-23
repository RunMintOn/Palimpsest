#!/usr/bin/env python3
"""Small standard-library verifier for Ollama's /api/embed endpoint.

It exercises Chinese single/batch embeddings, vector checks, cosine sanity checks,
error behavior, custom output dimensions, and a short cold/warm latency baseline.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import time
import urllib.error
import urllib.request
from typing import Any

TEXTS = [
    "Obsidian 可以用于管理本地 Markdown 知识库。",
    "知识管理软件能够组织本地笔记。",
    "烤箱烘焙面包时需要控制温度。",
    "中文短文本的语义向量检索。",
]
# 50 CJK characters (plus the product name and Markdown) for the light latency baseline.
BASELINE_TEXT = "Obsidian 本地语义检索插件需要快速处理中文 Markdown 笔记内容，自动生成检索向量并返回最相关的知识片段，帮助用户定位历史笔记记录。"


def post(url: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any], float]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw), (time.perf_counter() - started) * 1000
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            body: dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw": raw}
        return error.code, body, (time.perf_counter() - started) * 1000


def get(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def vector_summary(vector: list[float]) -> dict[str, Any]:
    finite = all(isinstance(value, (int, float)) and math.isfinite(value) for value in vector)
    norm = math.sqrt(sum(float(value) * float(value) for value in vector)) if finite else math.nan
    return {"non_empty": bool(vector), "dimensions": len(vector), "all_finite": finite, "l2_norm": norm}


def embedding_response_summary(body: dict[str, Any]) -> dict[str, Any]:
    embeddings = body.get("embeddings")
    if not isinstance(embeddings, list):
        return {"embedding_count": None, "response": body}
    if not embeddings:
        return {"embedding_count": 0}
    return {"embedding_count": len(embeddings), "first_vector": vector_summary(embeddings[0])}


def cosine(left: list[float], right: list[float]) -> float:
    dot = sum(float(a) * float(b) for a, b in zip(left, right))
    left_norm = math.sqrt(sum(float(value) * float(value) for value in left))
    right_norm = math.sqrt(sum(float(value) * float(value) for value in right))
    return dot / (left_norm * right_norm)


def percentile_nearest_rank(values: list[float], percent: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(percent * len(ordered)) - 1)
    return ordered[index]


def embed(endpoint: str, model: str, input_value: str | list[str], **extra: Any) -> tuple[int, dict[str, Any], float]:
    return post(endpoint, {"model": model, "input": input_value, **extra})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="qwen3-embedding:0.6b")
    args = parser.parse_args()
    endpoint = args.host.rstrip("/") + "/api/embed"
    ps_endpoint = args.host.rstrip("/") + "/api/ps"

    result: dict[str, Any] = {
        "endpoint": endpoint,
        "model": args.model,
        "timing_scope": "Python perf_counter around the complete local HTTP POST and response body read; includes HTTP client overhead.",
    }

    # Requesting keep_alive=0 first gives the next baseline request a cold model state.
    unload_status, unload_body, unload_ms = embed(endpoint, args.model, "unload baseline", keep_alive="0")
    time.sleep(0.5)
    result["pre_cold_unload"] = {"http_status": unload_status, "elapsed_ms": unload_ms, "api_ps_after": get(ps_endpoint)}

    cold_status, cold_body, cold_ms = embed(endpoint, args.model, BASELINE_TEXT, keep_alive="5m")
    if cold_status != 200:
        raise RuntimeError(f"Cold embedding request failed: HTTP {cold_status}: {cold_body}")
    result["cold_request"] = {
        "input": BASELINE_TEXT,
        "http_status": cold_status,
        "http_elapsed_ms": cold_ms,
        "api_total_duration_ms": cold_body.get("total_duration", 0) / 1_000_000,
        "api_load_duration_ms": cold_body.get("load_duration", 0) / 1_000_000,
        "prompt_eval_count": cold_body.get("prompt_eval_count"),
    }

    single_status, single_body, single_ms = embed(endpoint, args.model, TEXTS[0], keep_alive="5m")
    batch_status, batch_body, batch_ms = embed(endpoint, args.model, TEXTS, keep_alive="5m")
    if single_status != 200 or batch_status != 200:
        raise RuntimeError(f"Required input failed: single={single_status}, batch={batch_status}")
    single_vector = single_body["embeddings"][0]
    vectors = batch_body["embeddings"]
    result["single_chinese"] = {"http_status": single_status, "http_elapsed_ms": single_ms, "vector": vector_summary(single_vector)}
    result["batch_chinese"] = {
        "http_status": batch_status,
        "http_elapsed_ms": batch_ms,
        "input_count": len(TEXTS),
        "vector_summaries": [vector_summary(vector) for vector in vectors],
        "api_total_duration_ms": batch_body.get("total_duration", 0) / 1_000_000,
    }
    result["cosine_sanity_check"] = {
        "obsidian_vs_knowledge_management": cosine(vectors[0], vectors[1]),
        "obsidian_vs_baking": cosine(vectors[0], vectors[2]),
        "related_is_higher": cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2]),
    }

    dimension_status, dimension_body, dimension_ms = embed(endpoint, args.model, TEXTS[3], dimensions=512, keep_alive="5m")
    result["custom_dimensions_512"] = {
        "http_status": dimension_status,
        "http_elapsed_ms": dimension_ms,
        "response": embedding_response_summary(dimension_body) if dimension_status == 200 else dimension_body,
    }

    empty_status, empty_body, empty_ms = embed(endpoint, args.model, "", keep_alive="5m")
    result["empty_input"] = {
        "http_status": empty_status,
        "http_elapsed_ms": empty_ms,
        "response": embedding_response_summary(empty_body) if empty_status == 200 else empty_body,
    }
    invalid_status, invalid_body, invalid_ms = post(endpoint, {"model": args.model})
    result["invalid_missing_input"] = {"http_status": invalid_status, "http_elapsed_ms": invalid_ms, "response": invalid_body}

    warm_ms: list[float] = []
    warm_api_total_ms: list[float] = []
    for _ in range(10):
        status, body, elapsed_ms = embed(endpoint, args.model, BASELINE_TEXT, keep_alive="5m")
        if status != 200:
            raise RuntimeError(f"Warm embedding request failed: HTTP {status}: {body}")
        warm_ms.append(elapsed_ms)
        warm_api_total_ms.append(body.get("total_duration", 0) / 1_000_000)
    result["warm_10_requests"] = {
        "http_elapsed_ms_each": warm_ms,
        "http_elapsed_ms_p50": percentile_nearest_rank(warm_ms, 0.50),
        "http_elapsed_ms_p95": percentile_nearest_rank(warm_ms, 0.95),
        "http_elapsed_ms_max": max(warm_ms),
        "api_total_duration_ms_each": warm_api_total_ms,
    }
    result["api_ps_while_kept_alive"] = get(ps_endpoint)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
