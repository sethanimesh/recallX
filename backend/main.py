from contextlib import asynccontextmanager

from fastapi import FastAPI

import database
from routers import extract, grade, words, tags


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield


app = FastAPI(title="RecallX API", version="0.0.1", lifespan=lifespan)
app.include_router(extract.router)
app.include_router(grade.router)
app.include_router(words.router)
app.include_router(tags.router)
