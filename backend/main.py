from contextlib import asynccontextmanager
import asyncio
import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import auth
import database
from routers import extract,grade,words,tags,stats,providers,tutor,story,prompts,reviews,sync,optimization,ingestion

log=logging.getLogger('recallx')


async def recover_work(stop):
    from ingestion.dispatch import tick
    from services.optimization_tasks import dispatch
    while not stop.is_set():
        try:
            await asyncio.to_thread(tick)
            await asyncio.to_thread(dispatch.run)
        except Exception:
            log.exception('Background dispatch failed; durable jobs remain recoverable')
        try: await asyncio.wait_for(stop.wait(),timeout=30)
        except asyncio.TimeoutError: pass


@asynccontextmanager
async def lifespan(app):
    database.init_db()
    auth.bootstrap_secret()
    log.info('Pair the first device using the secret stored in RECALLX_DATA_DIR/bootstrap.secret. See setup instructions.')
    stop=asyncio.Event()
    recovery=asyncio.create_task(recover_work(stop)) if os.getenv('RECALLX_DISABLE_DISPATCH')!='1' else None
    yield
    stop.set()
    if recovery:
        try:await asyncio.wait_for(recovery,timeout=5)
        except asyncio.TimeoutError:recovery.cancel()
    from assessment.service import models
    await models.close()


app=FastAPI(title='RecallX API',version='1.0.0',lifespan=lifespan)
app.middleware('http')(auth.authenticate)
app.add_middleware(CORSMiddleware,allow_origins=os.getenv('RECALLX_WEB_ORIGINS','http://localhost:8081,http://localhost:8082,http://localhost:8083,http://127.0.0.1:8081').split(','),allow_credentials=False,allow_methods=['*'],allow_headers=['*'])
for module in (auth,extract,grade,words,tags,stats,providers,tutor,story,prompts,reviews,sync,optimization,ingestion):
    app.include_router(module.router)


@app.get('/health')
def health():
    return {'status':'ok','version':'1.0.0','scheduler':'fsrs-6/6.3.2','grading':'discriminative','identity':'device-pairing'}
