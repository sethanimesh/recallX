from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import database
from routers import extract, grade, words, tags, stats, providers, tutor, story


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield


app = FastAPI(title="RecallX API", version="0.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract.router)
app.include_router(grade.router)
app.include_router(words.router)
app.include_router(tags.router)
app.include_router(stats.router)
app.include_router(providers.router)
app.include_router(tutor.router)
app.include_router(story.router)
