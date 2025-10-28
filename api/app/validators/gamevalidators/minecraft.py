from pydantic import BaseModel, Field
from typing import Literal


class MinecraftEnviromentValidator(BaseModel):
    """
    A schema for validating required environment variables
    """
    EULA: bool
    MODE: Literal["survival", "creative", "adventure", "spectator"]
    SEED: str
    PVP: bool
    HARDCORE: bool
    ENABLE_COMMAND_BLOCK: bool
    MAX_PLAYERS: int = Field(
        ..., ge=1, le=100, description="Maximum number of players (1–100)"
    )

class MinecraftPortValidator(BaseModel):
    primary_port: int


class MinecraftGameValidator(BaseModel):
    '''
        A Schema for Validating the minecraft game type config
    '''
    name: str
    # game_type: str
    environment: MinecraftEnviromentValidator
    ports: MinecraftPortValidator
