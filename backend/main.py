from fastapi import FastAPI
from routers import extract

app = FastAPI(title="RecallX API", version="0.0.1")
app.include_router(extract.router)
