"""Tests for the geo reverse geocoding service."""

from unittest.mock import patch

import pytest

from photomind.services.geo import batch_reverse_geocode, reverse_geocode


class TestReverseGeocode:
    """Tests for the reverse_geocode() function."""

    def test_returns_dict_with_correct_keys(self) -> None:
        """Result must have exactly the keys: city, state, country."""
        result = reverse_geocode(13.0827, 80.2707)
        assert set(result.keys()) == {"city", "state", "country"}

    def test_all_values_are_strings(self) -> None:
        """All values in the returned dict must be strings."""
        result = reverse_geocode(13.0827, 80.2707)
        for key, value in result.items():
            assert isinstance(value, str), f"Expected str for key '{key}', got {type(value)}"

    def test_chennai_coordinates(self) -> None:
        """(13.0827, 80.2707) should resolve to Chennai area, India."""
        result = reverse_geocode(13.0827, 80.2707)
        assert result["country"] == "IN"
        assert result["city"] != ""

    def test_london_coordinates(self) -> None:
        """(51.5074, -0.1278) should resolve to London area, UK."""
        result = reverse_geocode(51.5074, -0.1278)
        assert result["country"] == "GB"
        assert result["city"] != ""

    def test_new_york_coordinates(self) -> None:
        """(40.7128, -74.0060) should resolve to New York area, USA."""
        result = reverse_geocode(40.7128, -74.0060)
        assert result["country"] == "US"
        assert result["city"] != ""

    def test_raises_value_error_for_lat_too_high(self) -> None:
        """lat > 90 should raise ValueError."""
        with pytest.raises(ValueError, match="lat"):
            reverse_geocode(91.0, 0.0)

    def test_raises_value_error_for_lat_too_low(self) -> None:
        """lat < -90 should raise ValueError."""
        with pytest.raises(ValueError, match="lat"):
            reverse_geocode(-91.0, 0.0)

    def test_raises_value_error_for_lon_too_high(self) -> None:
        """lon > 180 should raise ValueError."""
        with pytest.raises(ValueError, match="lon"):
            reverse_geocode(0.0, 181.0)

    def test_raises_value_error_for_lon_too_low(self) -> None:
        """lon < -180 should raise ValueError."""
        with pytest.raises(ValueError, match="lon"):
            reverse_geocode(0.0, -181.0)

    def test_accepts_integer_inputs(self) -> None:
        """Function should accept int lat/lon without error."""
        result = reverse_geocode(13, 80)
        assert set(result.keys()) == {"city", "state", "country"}

    def test_boundary_zero_zero(self) -> None:
        """(0.0, 0.0) — Gulf of Guinea — should return valid result."""
        result = reverse_geocode(0.0, 0.0)
        assert set(result.keys()) == {"city", "state", "country"}
        assert isinstance(result["country"], str)

    def test_boundary_north_pole(self) -> None:
        """(90.0, 0.0) — North Pole — should return valid result."""
        result = reverse_geocode(90.0, 0.0)
        assert set(result.keys()) == {"city", "state", "country"}
        assert isinstance(result["country"], str)

    def test_boundary_exact_lat_90(self) -> None:
        """lat == 90 is valid; must not raise."""
        result = reverse_geocode(90.0, 0.0)
        assert "city" in result

    def test_boundary_exact_lat_minus_90(self) -> None:
        """lat == -90 is valid; must not raise."""
        result = reverse_geocode(-90.0, 0.0)
        assert "city" in result

    def test_boundary_exact_lon_180(self) -> None:
        """lon == 180 is valid; must not raise."""
        result = reverse_geocode(0.0, 180.0)
        assert "city" in result

    def test_boundary_exact_lon_minus_180(self) -> None:
        """lon == -180 is valid; must not raise."""
        result = reverse_geocode(0.0, -180.0)
        assert "city" in result


class TestBatchReverseGeocode:
    """Tests for the batch_reverse_geocode() function."""

    def test_returns_same_length_as_input(self) -> None:
        """Output list must be the same length as input."""
        coords = [(13.0827, 80.2707), (51.5074, -0.1278), (40.7128, -74.0060)]
        results = batch_reverse_geocode(coords)
        assert len(results) == len(coords)

    def test_each_result_has_correct_keys(self) -> None:
        """Every result dict must have keys: city, state, country."""
        coords = [(13.0827, 80.2707), (51.5074, -0.1278)]
        results = batch_reverse_geocode(coords)
        for result in results:
            assert set(result.keys()) == {"city", "state", "country"}

    def test_results_in_same_order_as_input(self) -> None:
        """Results should correspond to input coords in the same order."""
        coords = [(13.0827, 80.2707), (51.5074, -0.1278), (40.7128, -74.0060)]
        results = batch_reverse_geocode(coords)
        assert results[0]["country"] == "IN"
        assert results[1]["country"] == "GB"
        assert results[2]["country"] == "US"

    def test_raises_value_error_on_empty_list(self) -> None:
        """Empty list should raise ValueError."""
        with pytest.raises(ValueError, match="empty"):
            batch_reverse_geocode([])

    def test_raises_value_error_on_invalid_lat_in_list(self) -> None:
        """Any coord with invalid lat should raise ValueError."""
        with pytest.raises(ValueError, match="lat"):
            batch_reverse_geocode([(13.0827, 80.2707), (95.0, 0.0)])

    def test_raises_value_error_on_invalid_lon_in_list(self) -> None:
        """Any coord with invalid lon should raise ValueError."""
        with pytest.raises(ValueError, match="lon"):
            batch_reverse_geocode([(13.0827, 80.2707), (0.0, 200.0)])

    def test_single_item_batch_matches_single_call(self) -> None:
        """Single-item batch result must match direct reverse_geocode call."""
        lat, lon = 13.0827, 80.2707
        single = reverse_geocode(lat, lon)
        batch = batch_reverse_geocode([(lat, lon)])
        assert len(batch) == 1
        assert batch[0] == single

    def test_all_values_are_strings_in_batch(self) -> None:
        """All values in batch results must be strings."""
        coords = [(13.0827, 80.2707), (40.7128, -74.0060)]
        results = batch_reverse_geocode(coords)
        for result in results:
            for key, value in result.items():
                assert isinstance(value, str), f"Expected str for '{key}', got {type(value)}"


class TestEdgeCases:
    """Edge case and defensive tests."""

    def test_reverse_geocode_empty_library_result_returns_empty_strings(self) -> None:
        """If reverse_geocoder returns empty list, return empty-string dict."""
        with patch("photomind.services.geo.reverse_geocoder.search", return_value=[]):
            result = reverse_geocode(13.0827, 80.2707)
        assert result == {"city": "", "state": "", "country": ""}

    def test_batch_reverse_geocode_length_mismatch_raises_runtime_error(self) -> None:
        """If library returns wrong number of results, raise RuntimeError."""
        with patch(
            "photomind.services.geo.reverse_geocoder.search",
            return_value=[{"name": "Chennai", "admin1": "Tamil Nadu", "cc": "IN"}],
        ):
            with pytest.raises(RuntimeError, match="results"):
                batch_reverse_geocode([(13.0827, 80.2707), (51.5074, -0.1278)])
