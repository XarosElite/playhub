from pydantic import BaseModel, Field
from typing import Literal, Optional


class PalworldEnviromentValidator(BaseModel):
    """
    A schema for validating Palworld required environment variables
    """
    SERVER_NAME: Optional[str] = ""
    SERVER_DESCRIPTION: Optional[str] = ""
    SERVER_PASSWORD: Optional[str] = ""
    ADMIN_PASSWORD: Optional[str] = ""
    DIFFICULTY: Optional[Literal["Casual", "Normal", "Hard"]] = "Normal"
    EXP_RATE: Optional[float] = 1.0
    PAL_SPAWN: Optional[float] = 1.0
    COMMUNITY: Optional[bool] = False
    PLAYERS: Optional[int] = Field(
        default=32, ge=1, le=100, description="Maximum number of players (1–100)"
    )

class PalworldPortValidator(BaseModel):
    primary_port: int


class PalworldGameValidator(BaseModel):
    '''
    A Schema for Validating the palworld game type config
    '''
    name: str
    game_type: str
    environment: PalworldEnviromentValidator
    ports: PalworldPortValidator


