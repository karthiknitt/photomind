"""
Smoke tests — verify imports compile and config loads with defaults.

These tests must pass in CI without any config.yaml present.
All Phase 1+ tests will run against a temp SQLite DB and mocked rclone.
"""

from photomind.config import (
    PhotoMindConfig,
    get_config,
    load_config,
    reset_config,
)


class TestConfigDefaults:
    def setup_method(self):
        reset_config()

    def teardown_method(self):
        reset_config()

    def test_load_config_returns_defaults_when_no_file(self, tmp_path):
        """Config loads without error when config.yaml is absent."""
        config = load_config(str(tmp_path / "nonexistent.yaml"))
        assert isinstance(config, PhotoMindConfig)

    def test_default_database_path_is_set(self):
        """Default database path points to home/photomind/photomind.db."""
        config = load_config()
        assert "photomind" in config.database_path
        assert config.database_path.endswith(".db")

    def test_default_sources_is_empty_list(self):
        """No sources configured by default (must be set in config.yaml)."""
        config = load_config()
        assert config.sources == []

    def test_default_pipeline_batch_size(self):
        config = load_config()
        assert config.pipeline.batch_size == 10

    def test_default_meme_threshold(self):
        config = load_config()
        assert config.pipeline.meme_threshold == 0.7

    def test_default_clip_model(self):
        config = load_config()
        assert config.clip.model == "ViT-B/32"

    def test_default_insightface_model(self):
        config = load_config()
        assert config.insightface.model == "buffalo_sc"

    def test_get_config_singleton(self):
        """get_config() returns the same instance on repeated calls."""
        c1 = get_config()
        c2 = get_config()
        assert c1 is c2

    def test_reset_config_clears_singleton(self):
        """reset_config() allows get_config() to reload."""
        c1 = get_config()
        reset_config()
        c2 = get_config()
        # Different instances after reset
        assert c1 is not c2

    def test_database_path_from_env(self, monkeypatch, tmp_path):
        """DATABASE_PATH env var overrides default."""
        db_path = str(tmp_path / "test.db")
        monkeypatch.setenv("DATABASE_PATH", db_path)
        reset_config()
        config = load_config()
        assert config.database_path == db_path
