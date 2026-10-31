import yaml
from pathlib import Path
from enum import Enum

class GameType(Enum):
    MINECRAFT = "minecraft"
    PALWORLD = "palworld"

GAMES_YAML_PATH = Path(__file__).resolve().parent.parent.parent / "games.yaml"
with open(GAMES_YAML_PATH) as f:
    _raw_config = yaml.safe_load(f)

GLOBAL_COMMON_FIELDS: dict[str, dict] = _raw_config.get("common_fields", {})
GAME_CONFIGS: dict[str, dict] = {k: v for k, v in _raw_config.items() if k != "common_fields"}
