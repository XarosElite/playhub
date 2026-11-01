"""
Game catalog loaded from games.yaml.

This module is the single place the YAML is read. It resolves each game's
common field references, checks the whole schema at import time (so a bad
games.yaml fails on startup instead of at request time), and validates
user-submitted environments against it.

Field schema keys (all optional except where noted):
    type         string | password | boolean | integer | number   (default: string)
    default      value used when the user leaves the field empty
    enum         list of allowed values (rendered as a dropdown)
    min / max    bounds for integer / number fields
    label        UI label (default: derived from the field name)
    description  help text shown under the input
    placeholder  input placeholder
    required     user must provide a value (default: false)
    env          container environment variable name (default: the field name)

A game's ``common_fields`` is a list whose entries are either the name of a
top-level common field, or a mapping ``{field: NAME, ...overrides}`` where the
overrides (e.g. ``env``, ``default``, ``max``) are merged over the shared
definition for that game only.
"""
import math
from pathlib import Path
from typing import Any

import yaml

GAMES_YAML_PATH = Path(__file__).resolve().parent.parent.parent / "games.yaml"

FIELD_TYPES = {"string", "password", "boolean", "integer", "number"}
FIELD_KEYS = {"type", "default", "enum", "min", "max", "label", "description",
              "placeholder", "required", "env"}
# Keys that are only meaningful to the backend and are not sent to clients.
PRIVATE_FIELD_KEYS = {"env"}

_TRUE_STRINGS = {"true", "1", "yes", "on"}
_FALSE_STRINGS = {"false", "0", "no", "off"}


class GameConfigError(Exception):
    """games.yaml is malformed."""


class EnvironmentValidationError(Exception):
    """A submitted environment does not match the game's schema."""

    def __init__(self, errors: dict[str, str]):
        super().__init__("Invalid server settings")
        self.errors = errors


# ---------------------------------------------------------------------------
# Value coercion
# ---------------------------------------------------------------------------
def _is_empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _coerce(field: dict, value: Any) -> Any:
    """Coerce a raw value to the field's type, or raise ValueError with a user-facing message."""
    ftype = field["type"]

    if ftype == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in _TRUE_STRINGS | _FALSE_STRINGS:
            return value.strip().lower() in _TRUE_STRINGS
        raise ValueError("Must be true or false")

    if ftype in ("integer", "number"):
        if isinstance(value, bool):
            raise ValueError("Must be a number")
        if isinstance(value, str):
            try:
                value = float(value.strip())
            except ValueError:
                raise ValueError("Must be a number") from None
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("Must be a number")
        if ftype == "integer":
            if isinstance(value, float) and not value.is_integer():
                raise ValueError("Must be a whole number")
            value = int(value)
        else:
            value = float(value)
        if field.get("min") is not None and value < field["min"]:
            raise ValueError(f"Must be at least {field['min']}")
        if field.get("max") is not None and value > field["max"]:
            raise ValueError(f"Must be at most {field['max']}")
        return value

    # string / password
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("Must be text")
    return str(value)


def _check_enum(field: dict, value: Any) -> Any:
    options = field.get("enum")
    if not options:
        return value
    for option in options:
        if str(option) == str(value):
            return option
    raise ValueError(f"Must be one of: {', '.join(str(o) for o in options)}")


def _to_env_string(value: Any) -> str:
    """Render a typed value the way container images expect it in an env var."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return f"{value:.1f}"
    return str(value)


# ---------------------------------------------------------------------------
# Schema loading
# ---------------------------------------------------------------------------
def _default_label(name: str) -> str:
    return " ".join(word.capitalize() for word in name.split("_"))


def _normalise_field(name: str, raw: Any, where: str) -> dict:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise GameConfigError(f"{where}: field '{name}' must be a mapping")

    unknown = set(raw) - FIELD_KEYS
    if unknown:
        raise GameConfigError(f"{where}: field '{name}' has unknown keys {sorted(unknown)}")

    field = dict(raw)
    field.setdefault("type", "string")
    if field["type"] not in FIELD_TYPES:
        raise GameConfigError(f"{where}: field '{name}' has invalid type '{field['type']}'")
    field["label"] = field.get("label") or _default_label(name)
    field["required"] = bool(field.get("required", False))
    field["env"] = field.get("env") or name
    field.setdefault("default", None)

    if field.get("enum") is not None and not (isinstance(field["enum"], list) and field["enum"]):
        raise GameConfigError(f"{where}: field '{name}' enum must be a non-empty list")
    if field["type"] not in ("integer", "number") and (field.get("min") is not None or field.get("max") is not None):
        raise GameConfigError(f"{where}: field '{name}' uses min/max but is not numeric")

    if not _is_empty(field["default"]):
        try:
            field["default"] = _check_enum(field, _coerce(field, field["default"]))
        except ValueError as e:
            raise GameConfigError(f"{where}: field '{name}' has an invalid default: {e}") from None
    return field


def _resolve_game(game_type: str, raw: Any, common_defs: dict[str, Any]) -> dict:
    where = f"games.yaml [{game_type}]"
    if not isinstance(raw, dict):
        raise GameConfigError(f"{where}: game definition must be a mapping")
    if not raw.get("image"):
        raise GameConfigError(f"{where}: 'image' is required")
    internal_port = raw.get("internal_port") or raw.get("default_port")
    if not isinstance(internal_port, int):
        raise GameConfigError(f"{where}: 'internal_port' must be an integer")

    common_fields: dict[str, dict] = {}
    for entry in raw.get("common_fields") or []:
        if isinstance(entry, str):
            name, overrides = entry, {}
        elif isinstance(entry, dict) and isinstance(entry.get("field"), str):
            overrides = {k: v for k, v in entry.items() if k != "field"}
            name = entry["field"]
        else:
            raise GameConfigError(f"{where}: common_fields entries must be a name or a mapping with 'field'")
        if name not in common_defs:
            raise GameConfigError(f"{where}: unknown common field '{name}'")
        if name in common_fields:
            raise GameConfigError(f"{where}: common field '{name}' listed twice")
        merged = {**(common_defs[name] or {}), **overrides}
        common_fields[name] = _normalise_field(name, merged, where)

    raw_fields = raw.get("fields") or {}
    if not isinstance(raw_fields, dict):
        raise GameConfigError(f"{where}: 'fields' must be a mapping")
    fields: dict[str, dict] = {}
    for name, field_raw in raw_fields.items():
        if name in common_fields:
            raise GameConfigError(f"{where}: field '{name}' is defined both as common and game-specific")
        fields[name] = _normalise_field(name, field_raw, where)

    env_owner: dict[str, str] = {}
    for name, field in {**common_fields, **fields}.items():
        if field["env"] in env_owner:
            raise GameConfigError(
                f"{where}: fields '{env_owner[field['env']]}' and '{name}' both set env var '{field['env']}'"
            )
        env_owner[field["env"]] = name

    return {
        "game_type": game_type,
        "image": raw["image"],
        "internal_port": internal_port,
        "common_fields": common_fields,
        "fields": fields,
        "docker_override": raw.get("docker_override") or {},
    }


def load_games(path: Path = GAMES_YAML_PATH) -> dict[str, dict]:
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    if not isinstance(raw, dict):
        raise GameConfigError("games.yaml must be a mapping")
    common_defs = raw.get("common_fields") or {}
    if not isinstance(common_defs, dict):
        raise GameConfigError("games.yaml: top-level 'common_fields' must be a mapping")
    return {
        game_type: _resolve_game(game_type, game_def, common_defs)
        for game_type, game_def in raw.items()
        if game_type != "common_fields"
    }


GAMES: dict[str, dict] = load_games()


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------
def public_game(game: dict) -> dict:
    """The catalog entry sent to clients (backend-only keys removed)."""
    def strip(fields: dict[str, dict]) -> dict[str, dict]:
        return {
            name: {k: v for k, v in field.items() if k not in PRIVATE_FIELD_KEYS}
            for name, field in fields.items()
        }

    return {
        "game_type": game["game_type"],
        "image": game["image"],
        "internal_port": game["internal_port"],
        "common_fields": strip(game["common_fields"]),
        "fields": strip(game["fields"]),
    }


def validate_environment(game: dict, values: Any) -> tuple[dict[str, Any], dict[str, str]]:
    """
    Validate user-submitted settings against a game's schema.

    Empty values fall back to the field's default; if there is no default the
    variable is left unset so the image's own default applies (or, for a
    required field, it is an error).

    Returns ``(settings, container_env)``: the typed values keyed by field name
    (for storage) and the string env vars keyed by env var name (for Docker).
    Raises EnvironmentValidationError with per-field messages.
    """
    if values is None:
        values = {}
    if not isinstance(values, dict):
        raise EnvironmentValidationError({"environment": "Must be an object"})

    schema = {**game["common_fields"], **game["fields"]}
    errors: dict[str, str] = {
        key: "Unknown setting" for key in values if key not in schema
    }
    settings: dict[str, Any] = {}
    container_env: dict[str, str] = {}

    for name, field in schema.items():
        value = values.get(name)
        if _is_empty(value):
            value = field["default"]
        if _is_empty(value):
            if field["required"]:
                errors[name] = "Required"
            continue
        try:
            value = _check_enum(field, _coerce(field, value))
        except ValueError as e:
            errors[name] = str(e)
            continue
        settings[name] = value
        container_env[field["env"]] = _to_env_string(value)

    if errors:
        raise EnvironmentValidationError(errors)
    return settings, container_env
