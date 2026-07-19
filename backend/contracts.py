from typing import Literal
from pydantic import BaseModel


class CardState(BaseModel):
    card_id:int
    state:int
    step:int|None=None
    stability:float|None=None
    difficulty:float|None=None
    due:str
    last_review:str|None=None


class MemoryState(BaseModel):
    learner_id:str='personal'
    item_id:str
    mode:Literal['recall','flashcard']
    state_version:int
    progress_generation:int
    parameter_version:str
    updated_at:str
    card:CardState
    due:str
    retrievability:float|None=None


class ReviewEventSummary(BaseModel):
    id:str
    item_id:str
    mode:Literal['recall','flashcard']
    rating:int|None
    answered_at:str
    status:Literal['acknowledged','practice']
    reason:str|None=None
    assessment_id:str|None=None
    experimental:bool=False
    progress_generation:int
    device_id:str
