from pydantic import BaseModel, Field

class BaseGameValidator(BaseModel):
    GAME_TYPE: str

