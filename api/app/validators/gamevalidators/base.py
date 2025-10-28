from pydantic import BaseModel, ConfigDict

class BaseGameValidator(BaseModel):
    game_type: str

    # everything else may appear and won’t be validated
    model_config = ConfigDict(extra='allow')
