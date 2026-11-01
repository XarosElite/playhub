"""games.yaml loading, schema checks and environment validation (app/internal/config.py)."""
import textwrap

import pytest

from app.internal import config
from app.internal.config import (
    EnvironmentValidationError,
    GameConfigError,
    container_port_key,
    load_games,
    public_game,
    validate_environment,
)


@pytest.fixture
def write_yaml(tmp_path):
    def write(content: str):
        path = tmp_path / "games.yaml"
        path.write_text(textwrap.dedent(content))
        return path
    return write


@pytest.fixture
def load(write_yaml):
    def load(content: str):
        return load_games(write_yaml(content))
    return load


MINIMAL = """
    game:
      image: example/image
      internal_port: 1234
"""


# ---------------------------------------------------------------------------
# The real games.yaml
# ---------------------------------------------------------------------------
class TestShippedCatalog:
    def test_loads_minecraft_and_palworld(self):
        assert set(config.GAMES) == {"minecraft", "palworld"}

    def test_minecraft(self):
        mc = config.GAMES["minecraft"]
        assert mc["image"] == "itzg/minecraft-server"
        assert mc["internal_port"] == 25565
        assert mc["protocol"] == "tcp"
        assert mc["data_path"] == "/data"
        assert mc["status_query"] == "minecraft"
        assert container_port_key(mc) == "25565/tcp"
        assert mc["fields"]["EULA"]["required"] is True
        assert mc["fields"]["EULA"]["default"] is True
        assert mc["fields"]["MODE"]["enum"] == ["survival", "creative", "adventure", "spectator"]

    def test_palworld_uses_udp_and_maps_max_players_to_players(self):
        pal = config.GAMES["palworld"]
        assert container_port_key(pal) == "8211/udp"
        assert pal["data_path"] == "/palworld"
        assert pal["status_query"] == "none"
        max_players = pal["common_fields"]["MAX_PLAYERS"]
        assert max_players["env"] == "PLAYERS"
        assert max_players["default"] == 32
        # The shared definition's bounds and label still apply.
        assert (max_players["min"], max_players["max"], max_players["label"]) == (1, 100, "Max Players")

    def test_minecraft_defaults_produce_valid_env(self):
        settings, env = validate_environment(config.GAMES["minecraft"], {})
        assert settings["EULA"] is True
        assert env["EULA"] == "true"
        assert env["MAX_PLAYERS"] == "20"
        assert env["MODE"] == "survival"
        assert "SEED" not in env  # no default: left to the image

    def test_palworld_defaults_produce_valid_env(self):
        settings, env = validate_environment(config.GAMES["palworld"], {})
        assert env["PLAYERS"] == "32"
        assert "MAX_PLAYERS" not in env
        assert env["EXP_RATE"] == "1.0"
        assert env["COMMUNITY"] == "false"
        assert settings["MAX_PLAYERS"] == 32


# ---------------------------------------------------------------------------
# Schema loading
# ---------------------------------------------------------------------------
class TestLoadGames:
    def test_minimal_game_gets_defaults(self, load):
        game = load(MINIMAL)["game"]
        assert game == {
            "game_type": "game",
            "image": "example/image",
            "internal_port": 1234,
            "protocol": "tcp",
            "data_path": None,
            "status_query": "none",
            "common_fields": {},
            "fields": {},
            "docker_override": {},
        }

    def test_empty_file_has_no_games(self, load):
        assert load("") == {}

    def test_legacy_default_port_key(self, load):
        game = load("""
            game:
              image: img
              default_port: 4444
        """)["game"]
        assert game["internal_port"] == 4444

    def test_field_defaults_are_normalised(self, load):
        field = load("""
            game:
              image: img
              internal_port: 1
              fields:
                SERVER_MOTD:
        """)["game"]["fields"]["SERVER_MOTD"]
        assert field == {
            "type": "string", "label": "Server Motd", "required": False, "env": "SERVER_MOTD", "default": None,
        }

    def test_defaults_are_coerced_to_the_field_type(self, load):
        fields = load("""
            game:
              image: img
              internal_port: 1
              fields:
                A: {type: integer, default: "7"}
                B: {type: boolean, default: "yes"}
                C: {type: number, default: 2}
                D: {type: string, default: 5}
        """)["game"]["fields"]
        assert fields["A"]["default"] == 7
        assert fields["B"]["default"] is True
        assert fields["C"]["default"] == 2.0 and isinstance(fields["C"]["default"], float)
        assert fields["D"]["default"] == "5"

    def test_common_field_by_name_and_with_overrides(self, load):
        game = load("""
            common_fields:
              MAX_PLAYERS: {type: integer, default: 20, min: 1, max: 100, label: Max Players}
              PASSWORD: {type: password}
            game:
              image: img
              internal_port: 1
              common_fields:
                - PASSWORD
                - field: MAX_PLAYERS
                  env: PLAYERS
                  default: 8
        """)["game"]
        assert game["common_fields"]["PASSWORD"]["type"] == "password"
        assert game["common_fields"]["MAX_PLAYERS"]["env"] == "PLAYERS"
        assert game["common_fields"]["MAX_PLAYERS"]["default"] == 8
        assert game["common_fields"]["MAX_PLAYERS"]["label"] == "Max Players"

    def test_overrides_do_not_leak_into_other_games(self, load):
        games = load("""
            common_fields:
              MAX_PLAYERS: {type: integer, default: 20}
            a:
              image: img
              internal_port: 1
              common_fields: [{field: MAX_PLAYERS, default: 5}]
            b:
              image: img
              internal_port: 2
              common_fields: [MAX_PLAYERS]
        """)
        assert games["a"]["common_fields"]["MAX_PLAYERS"]["default"] == 5
        assert games["b"]["common_fields"]["MAX_PLAYERS"]["default"] == 20

    @pytest.mark.parametrize("content, message", [
        ("- not a mapping", "games.yaml must be a mapping"),
        ("common_fields: [A]", "top-level 'common_fields' must be a mapping"),
        ("game: 5", "game definition must be a mapping"),
        ("game: {internal_port: 1}", "'image' is required"),
        ("game: {image: img}", "'internal_port' must be an integer"),
        ("game: {image: img, internal_port: '25565'}", "'internal_port' must be an integer"),
        ("game: {image: img, internal_port: 1, protocol: sctp}", "'protocol' must be one of"),
        ("game: {image: img, internal_port: 1, data_path: data}", "'data_path' must be an absolute path"),
        ("game: {image: img, internal_port: 1, status_query: steam}", "'status_query' must be one of"),
        ("game: {image: img, internal_port: 1, fields: [A]}", "'fields' must be a mapping"),
        ("game: {image: img, internal_port: 1, fields: {A: 5}}", "field 'A' must be a mapping"),
        ("game: {image: img, internal_port: 1, fields: {A: {colour: red}}}", "unknown keys ['colour']"),
        ("game: {image: img, internal_port: 1, fields: {A: {type: date}}}", "invalid type 'date'"),
        ("game: {image: img, internal_port: 1, fields: {A: {enum: []}}}", "enum must be a non-empty list"),
        ("game: {image: img, internal_port: 1, fields: {A: {enum: x}}}", "enum must be a non-empty list"),
        ("game: {image: img, internal_port: 1, fields: {A: {type: string, min: 1}}}", "uses min/max but is not numeric"),
        ("game: {image: img, internal_port: 1, fields: {A: {type: integer, default: abc}}}", "invalid default: Must be a number"),
        ("game: {image: img, internal_port: 1, fields: {A: {type: integer, max: 5, default: 9}}}", "invalid default: Must be at most 5"),
        ("game: {image: img, internal_port: 1, fields: {A: {enum: [x, y], default: z}}}", "invalid default: Must be one of: x, y"),
        ("game: {image: img, internal_port: 1, common_fields: [NOPE]}", "unknown common field 'NOPE'"),
        ("game: {image: img, internal_port: 1, common_fields: [5]}", "common_fields entries must be a name or a mapping"),
        ("game: {image: img, internal_port: 1, common_fields: [{env: X}]}", "common_fields entries must be a name or a mapping"),
    ])
    def test_invalid_schemas_are_rejected(self, load, content, message):
        with pytest.raises(GameConfigError) as error:
            load(content)
        assert message in str(error.value)

    def test_common_field_listed_twice(self, load):
        with pytest.raises(GameConfigError, match="listed twice"):
            load("""
                common_fields: {A: {}}
                game: {image: img, internal_port: 1, common_fields: [A, A]}
            """)

    def test_field_defined_as_common_and_specific(self, load):
        with pytest.raises(GameConfigError, match="both as common and game-specific"):
            load("""
                common_fields: {A: {}}
                game: {image: img, internal_port: 1, common_fields: [A], fields: {A: {}}}
            """)

    def test_two_fields_cannot_set_the_same_env_var(self, load):
        with pytest.raises(GameConfigError, match="both set env var 'PLAYERS'"):
            load("""
                common_fields: {MAX_PLAYERS: {type: integer}}
                game:
                  image: img
                  internal_port: 1
                  common_fields: [{field: MAX_PLAYERS, env: PLAYERS}]
                  fields: {PLAYERS: {type: integer}}
            """)

    def test_error_names_the_game(self, load):
        with pytest.raises(GameConfigError, match=r"games.yaml \[broken\]"):
            load("broken: {image: img}")


# ---------------------------------------------------------------------------
# public_game
# ---------------------------------------------------------------------------
class TestPublicGame:
    def test_strips_backend_only_keys(self):
        public = public_game(config.GAMES["palworld"])
        assert "env" not in public["common_fields"]["MAX_PLAYERS"]
        assert all("env" not in f for f in public["fields"].values())
        assert "data_path" not in public and "docker_override" not in public and "status_query" not in public

    def test_shape(self):
        public = public_game(config.GAMES["minecraft"])
        assert set(public) == {
            "game_type", "image", "internal_port", "protocol", "supports_players", "common_fields", "fields",
        }
        assert public["supports_players"] is True
        assert public_game(config.GAMES["palworld"])["supports_players"] is False

    def test_does_not_modify_the_catalog(self):
        public_game(config.GAMES["palworld"])
        assert config.GAMES["palworld"]["common_fields"]["MAX_PLAYERS"]["env"] == "PLAYERS"


# ---------------------------------------------------------------------------
# validate_environment
# ---------------------------------------------------------------------------
@pytest.fixture
def game(load):
    return load("""
        common_fields:
          MAX_PLAYERS: {type: integer, default: 10, min: 1, max: 100}
        game:
          image: img
          internal_port: 1
          common_fields: [{field: MAX_PLAYERS, env: PLAYERS}]
          fields:
            NAME: {type: string}
            PASSWORD: {type: password}
            TOKEN: {type: string, required: true}
            ACCEPT: {type: boolean, required: true, default: true}
            PVP: {type: boolean, default: false}
            RATE: {type: number, min: 0.1, max: 5}
            MODE: {enum: [survival, creative], default: survival}
            LEVEL: {type: integer, enum: [1, 2, 3]}
    """)["game"]


class TestValidateEnvironment:
    def test_returns_typed_settings_and_string_env(self, game):
        settings, env = validate_environment(game, {
            "MAX_PLAYERS": "12", "NAME": "My server", "PASSWORD": "pw", "TOKEN": "t",
            "ACCEPT": "true", "PVP": True, "RATE": "1.5", "MODE": "creative", "LEVEL": "2",
        })
        assert settings == {
            "MAX_PLAYERS": 12, "NAME": "My server", "PASSWORD": "pw", "TOKEN": "t",
            "ACCEPT": True, "PVP": True, "RATE": 1.5, "MODE": "creative", "LEVEL": 2,
        }
        assert env == {
            "PLAYERS": "12", "NAME": "My server", "PASSWORD": "pw", "TOKEN": "t",
            "ACCEPT": "true", "PVP": "true", "RATE": "1.5", "MODE": "creative", "LEVEL": "2",
        }

    def test_empty_values_fall_back_to_defaults(self, game):
        settings, env = validate_environment(game, {"TOKEN": "t", "MAX_PLAYERS": "", "PVP": None, "MODE": "  "})
        assert settings["MAX_PLAYERS"] == 10 and env["PLAYERS"] == "10"
        assert settings["PVP"] is False and env["PVP"] == "false"
        assert settings["MODE"] == "survival"

    def test_empty_values_without_a_default_are_left_unset(self, game):
        settings, env = validate_environment(game, {"TOKEN": "t", "NAME": ""})
        assert "NAME" not in settings and "NAME" not in env
        assert "RATE" not in env

    def test_required_field_with_a_default_accepts_empty(self, game):
        settings, _ = validate_environment(game, {"TOKEN": "t", "ACCEPT": ""})
        assert settings["ACCEPT"] is True

    def test_required_field_without_a_default(self, game):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"TOKEN": "   "})
        assert error.value.errors == {"TOKEN": "Required"}
        assert str(error.value) == "Invalid server settings"

    def test_none_means_empty_environment(self, game):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, None)
        assert error.value.errors == {"TOKEN": "Required"}

    @pytest.mark.parametrize("values", [[], "MAX_PLAYERS=5", 5])
    def test_environment_must_be_an_object(self, game, values):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, values)
        assert error.value.errors == {"environment": "Must be an object"}

    def test_unknown_settings_are_rejected(self, game):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"TOKEN": "t", "LD_PRELOAD": "/evil.so"})
        assert error.value.errors == {"LD_PRELOAD": "Unknown setting"}

    def test_env_var_name_is_not_accepted_as_a_field_name(self, game):
        # PLAYERS is MAX_PLAYERS's env var, not a field users can set directly.
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"TOKEN": "t", "PLAYERS": 5})
        assert error.value.errors == {"PLAYERS": "Unknown setting"}

    def test_reports_every_invalid_field_at_once(self, game):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"MAX_PLAYERS": 0, "RATE": 9, "MODE": "hardcore", "PVP": "maybe"})
        assert error.value.errors == {
            "TOKEN": "Required",
            "MAX_PLAYERS": "Must be at least 1",
            "RATE": "Must be at most 5",
            "MODE": "Must be one of: survival, creative",
            "PVP": "Must be true or false",
        }

    @pytest.mark.parametrize("value, expected", [
        (True, True), (False, False),
        ("true", True), ("TRUE", True), (" yes ", True), ("1", True), ("on", True),
        ("false", False), ("No", False), ("0", False), ("off", False),
    ])
    def test_boolean_coercion(self, game, value, expected):
        settings, env = validate_environment(game, {"TOKEN": "t", "PVP": value})
        assert settings["PVP"] is expected
        assert env["PVP"] == ("true" if expected else "false")

    @pytest.mark.parametrize("value", ["maybe", 1, 0, 2.5, [], {}])
    def test_boolean_rejects_non_booleans(self, game, value):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"TOKEN": "t", "PVP": value})
        assert error.value.errors["PVP"] == "Must be true or false"

    @pytest.mark.parametrize("value, expected", [(5, 5), ("5", 5), (" 7 ", 7), (5.0, 5), ("5.0", 5), (100, 100), (1, 1)])
    def test_integer_coercion(self, game, value, expected):
        settings, env = validate_environment(game, {"TOKEN": "t", "MAX_PLAYERS": value})
        assert settings["MAX_PLAYERS"] == expected and isinstance(settings["MAX_PLAYERS"], int)
        assert env["PLAYERS"] == str(expected)

    @pytest.mark.parametrize("value, message", [
        (5.5, "Must be a whole number"),
        ("5.5", "Must be a whole number"),
        ("five", "Must be a number"),
        (True, "Must be a number"),
        (float("nan"), "Must be a number"),
        (float("inf"), "Must be a number"),
        ("inf", "Must be a number"),
        ([5], "Must be a number"),
        (0, "Must be at least 1"),
        (101, "Must be at most 100"),
    ])
    def test_integer_rejections(self, game, value, message):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"TOKEN": "t", "MAX_PLAYERS": value})
        assert error.value.errors["MAX_PLAYERS"] == message

    @pytest.mark.parametrize("value, setting, env", [
        (1.5, 1.5, "1.5"), ("2", 2.0, "2.0"), (3, 3.0, "3.0"), (0.1, 0.1, "0.1"), (5, 5.0, "5.0"),
    ])
    def test_number_coercion(self, game, value, setting, env):
        settings, container_env = validate_environment(game, {"TOKEN": "t", "RATE": value})
        assert settings["RATE"] == setting and isinstance(settings["RATE"], float)
        assert container_env["RATE"] == env

    @pytest.mark.parametrize("value", [True, {"a": 1}, ["x"]])
    def test_strings_reject_non_scalars(self, game, value):
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"TOKEN": value})
        assert error.value.errors["TOKEN"] == "Must be text"

    def test_strings_accept_numbers(self, game):
        settings, env = validate_environment(game, {"TOKEN": 1234})
        assert settings["TOKEN"] == "1234" and env["TOKEN"] == "1234"

    def test_strings_keep_surrounding_whitespace(self, game):
        settings, _ = validate_environment(game, {"TOKEN": "  spaced  "})
        assert settings["TOKEN"] == "  spaced  "

    def test_numeric_enum_matches_strings_and_returns_the_option(self, game):
        settings, env = validate_environment(game, {"TOKEN": "t", "LEVEL": 3})
        assert settings["LEVEL"] == 3 and env["LEVEL"] == "3"
        with pytest.raises(EnvironmentValidationError) as error:
            validate_environment(game, {"TOKEN": "t", "LEVEL": 4})
        assert error.value.errors["LEVEL"] == "Must be one of: 1, 2, 3"

    def test_enum_is_case_sensitive(self, game):
        with pytest.raises(EnvironmentValidationError):
            validate_environment(game, {"TOKEN": "t", "MODE": "Creative"})

    def test_does_not_mutate_the_input(self, game):
        values = {"TOKEN": "t", "MAX_PLAYERS": "12"}
        validate_environment(game, values)
        assert values == {"TOKEN": "t", "MAX_PLAYERS": "12"}
