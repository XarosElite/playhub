import yaml
from enum import Enum

class GameType(Enum):
    MINECRAFT = "minecraft"
    PALWORLD = "palworld"

with open("games.yaml") as f:
    GAME_CONFIGS = yaml.safe_load(f)
