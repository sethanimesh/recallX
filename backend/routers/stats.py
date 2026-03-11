import sqlite3
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

import database

router = APIRouter()

Period = Literal["today", "week", "month", "all"]


def get_db_path() -> str:
    return database._DEFAULT_DB_PATH


class ProviderCount(BaseModel):
    provider: str
    model: str
    count: int


class LlmCall(BaseModel):
    provider: str
    model: str
    task: str
    called_at: int


class LlmStatsResponse(BaseModel):
    period: str
    total_calls: int
    by_provider: list[ProviderCount]
    calls: list[LlmCall]


def _period_cutoff(period: Period) -> int | None:
    now = int(time.time())
    if period == "today":
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        return int(today.timestamp())
    if period == "week":
        return now - 7 * 86400
    if period == "month":
        return now - 30 * 86400
    return None  # "all"


@router.get("/stats/llm", response_model=LlmStatsResponse)
def get_llm_stats(period: Period = "all") -> LlmStatsResponse:
    db_path = get_db_path()
    cutoff = _period_cutoff(period)

    where = "WHERE called_at >= ?" if cutoff is not None else ""
    params: tuple = (cutoff,) if cutoff is not None else ()

    with sqlite3.connect(db_path) as conn:
        agg_rows = conn.execute(
            f"SELECT provider, model, COUNT(*) as cnt FROM llm_calls {where} "
            "GROUP BY provider, model ORDER BY cnt DESC",
            params,
        ).fetchall()

        call_rows = conn.execute(
            f"SELECT provider, model, task, called_at FROM llm_calls {where} "
            "ORDER BY called_at DESC LIMIT 200",
            params,
        ).fetchall()

    total = sum(r[2] for r in agg_rows)
    by_provider = [ProviderCount(provider=r[0], model=r[1], count=r[2]) for r in agg_rows]
    calls = [LlmCall(provider=r[0], model=r[1], task=r[2], called_at=r[3]) for r in call_rows]

    return LlmStatsResponse(
        period=period,
        total_calls=total,
        by_provider=by_provider,
        calls=calls,
    )
