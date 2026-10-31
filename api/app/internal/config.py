import yaml
from pathlib import Path
from enum import Enum

class GameType(Enum):
    MINECRAFT = "minecraft"
    PALWORLD = "palworld"

GAMES_YAML_PATH = Path(__file__).resolve().parent.parent.parent / "games.yaml"
with open(GAMES_YAML_PATH) as f:
    GAME_CONFIGS = yaml.safe_load(f)
