"""
Local tests for common.validation — no AWS credentials required.
Run with:  python -m pytest tests/  (or just: python tests/test_booking_logic.py)
"""

import os
import sys

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "src", "layers", "common", "python"),
)

from common.validation import validate_booking_request


def test_valid_request_passes():
    ok, errors = validate_booking_request(
        {"trip_id": "T1", "seat_numbers": [1, 2], "passenger_name": "Asha Rao", "contact": "asha@example.com"}
    )
    assert ok and errors == []


def test_missing_trip_id_fails():
    ok, errors = validate_booking_request(
        {"seat_numbers": [1], "passenger_name": "Asha", "contact": "asha@example.com"}
    )
    assert not ok
    assert any("trip_id" in e for e in errors)


def test_empty_seat_list_fails():
    ok, errors = validate_booking_request(
        {"trip_id": "T1", "seat_numbers": [], "passenger_name": "Asha", "contact": "asha@example.com"}
    )
    assert not ok


def test_missing_passenger_name_fails():
    ok, errors = validate_booking_request(
        {"trip_id": "T1", "seat_numbers": [1], "contact": "asha@example.com"}
    )
    assert not ok


def test_missing_contact_fails():
    ok, errors = validate_booking_request(
        {"trip_id": "T1", "seat_numbers": [1], "passenger_name": "Asha"}
    )
    assert not ok


if __name__ == "__main__":
    test_valid_request_passes()
    test_missing_trip_id_fails()
    test_empty_seat_list_fails()
    test_missing_passenger_name_fails()
    test_missing_contact_fails()
    print("All tests passed.")
