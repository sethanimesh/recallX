import asyncio
import fcntl
import json
import os
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import local_runtime
from providers.base import ExtractionRequest
from providers.chain import ProviderChain
from providers.ollama_provider import OllamaProvider


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(local_runtime, "DATA_DIR", tmp_path)
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    monkeypatch.delenv("OLLAMA_API_KEY", raising=False)


@pytest.mark.asyncio
@pytest.mark.parametrize("input_type", ["text", "word", "image"])
async def test_native_ollama_requests_hold_shared_lease_and_unload(input_type):
    calls = []
    def handler(request):
        with (local_runtime.DATA_DIR / "inference.lock").open("a") as competing:
            with pytest.raises(BlockingIOError):
                fcntl.flock(competing.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        payload = json.loads(request.content)
        calls.append((request.url.path, payload))
        assert payload["keep_alive"] == 0
        return httpx.Response(200, json={"message": {"content": '[{"word":"brief","definition":"Short in duration.","example_sentence":"A brief pause."}]'}})
    provider = OllamaProvider()
    await provider._client.aclose()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider._client = client
        result = await provider.extract_words(ExtractionRequest(input_type=input_type, content="source", mime_type="image/png" if input_type == "image" else None))
    assert result[0].word == "brief"
    assert [c[0] for c in calls] == ["/api/chat", "/api/generate"]
    with local_runtime.inference_lease():
        pass


@pytest.mark.asyncio
async def test_timeout_unloads_before_releasing_lease():
    calls = []
    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/api/chat":
            raise httpx.ReadTimeout("fixture timeout")
        return httpx.Response(200, json={"done": True})
    provider = OllamaProvider()
    await provider._client.aclose()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider._client = client
        with pytest.raises(httpx.ReadTimeout):
            await provider.extract_words(ExtractionRequest(input_type="word", content="brief"))
    assert calls == ["/api/chat", "/api/generate"]
    async with local_runtime.async_inference_lease():
        pass


@pytest.mark.asyncio
async def test_waiting_for_memory_is_cancelable_without_leaking_lock():
    async def wait_for_lease():
        async with local_runtime.async_inference_lease():
            raise AssertionError("The other holder has not released memory")
    with local_runtime.inference_lease():
        waiting = asyncio.create_task(wait_for_lease())
        await asyncio.sleep(0.01)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
    async with local_runtime.async_inference_lease():
        pass


@pytest.mark.asyncio
async def test_local_generation_yields_to_waiting_live_grader():
    waiting = local_runtime.DATA_DIR / "grading-waiters"
    waiting.mkdir()
    marker = waiting / f"{os.getpid()}-fixture"
    marker.touch()
    entered = asyncio.Event()
    async def contender():
        async with local_runtime.async_inference_lease():
            entered.set()
    task = asyncio.create_task(contender())
    await asyncio.sleep(0.02)
    assert not entered.is_set()
    marker.unlink()
    await asyncio.wait_for(task, timeout=1)
    assert entered.is_set()


@pytest.mark.asyncio
async def test_mnemonic_and_story_use_ollama_native_memory_policy():
    provider = OllamaProvider()
    provider.generate_json = AsyncMock(side_effect=[{"mnemonic": "Brief breeze."}, {"title": "A moment", "content": "A brief pause."}])
    chain = ProviderChain.__new__(ProviderChain)
    chain._providers = [provider]
    with patch("providers.chain.database.get_system_prompt", return_value="Write clearly."), patch("providers.chain.database.record_llm_call"), patch("openai.AsyncOpenAI") as openai_client:
        assert await chain.generate_mnemonic("brief", "Short in duration.") == "Brief breeze."
        assert (await chain.generate_story([{"word": "brief", "definition": "Short in duration."}], "")).title == "A moment"
        openai_client.assert_not_called()
    assert provider.generate_json.await_count == 2
    await provider._client.aclose()
