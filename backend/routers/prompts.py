from fastapi import APIRouter
from pydantic import BaseModel
import database
from prompts import DEFAULT_PROMPTS

router = APIRouter()

class PromptRecord(BaseModel):
    id: str
    prompt_text: str
    default_text: str

class PromptUpdateRequest(BaseModel):
    prompt_text: str

@router.get("/prompts", response_model=list[PromptRecord])
def get_prompts():
    records = []
    for prompt_id, default_text in DEFAULT_PROMPTS.items():
        current_text = database.get_system_prompt(prompt_id)
        records.append(
            PromptRecord(
                id=prompt_id,
                prompt_text=current_text,
                default_text=default_text
            )
        )
    return records

@router.put("/prompts/{prompt_id}", response_model=PromptRecord)
def update_prompt(prompt_id: str, req: PromptUpdateRequest):
    if prompt_id not in DEFAULT_PROMPTS:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    database.set_system_prompt(prompt_id, req.prompt_text)
    
    return PromptRecord(
        id=prompt_id,
        prompt_text=req.prompt_text,
        default_text=DEFAULT_PROMPTS[prompt_id]
    )

@router.post("/prompts/{prompt_id}/reset", response_model=PromptRecord)
def reset_prompt(prompt_id: str):
    if prompt_id not in DEFAULT_PROMPTS:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    database.reset_system_prompt(prompt_id)
    
    return PromptRecord(
        id=prompt_id,
        prompt_text=DEFAULT_PROMPTS[prompt_id],
        default_text=DEFAULT_PROMPTS[prompt_id]
    )
