"""
One-time local script to load sample trips and generate their seat
inventory into the deployed DynamoDB tables.

Run after `sam deploy`.

Usage:
    python scripts/seed_dynamodb.py
"""

import json
import os
import boto3

REGION = os.environ.get("AWS_REGION", "ap-south-1")

dynamodb = boto3.resource(
    "dynamodb",
    region_name=REGION
)

trips_table = dynamodb.Table("Trips")
seats_table = dynamodb.Table("Seats")

seed_path = os.path.join(
    os.path.dirname(__file__),
    "..",
    "sample_data",
    "seed.json"
)

with open(seed_path, encoding="utf-8") as f:
    trips = json.load(f)

with trips_table.batch_writer() as trips_batch, \
     seats_table.batch_writer() as seats_batch:

    for trip in trips:

        route_key = f"{trip['origin']}#{trip['destination']}"

        trips_batch.put_item(
            Item={
                "trip_id": trip["trip_id"],
                "route_key": route_key,
                "origin": trip["origin"],
                "destination": trip["destination"],
                "travel_date": trip["travel_date"],
                "departure_time": trip["departure_time"],
                "arrival_time": trip["arrival_time"],
                "bus_name": trip["bus_name"],
                "fare": trip["fare"],
                "available_seats": trip["total_seats"],
                "total_seats": trip["total_seats"],
            }
        )

        for seat_number in range(1, trip["total_seats"] + 1):

            seats_batch.put_item(
                Item={
                    "trip_id": trip["trip_id"],
                    "seat_number": str(seat_number),
                    "seat_status": "AVAILABLE",
                }
            )

        print(
            f"Seeded {trip['trip_id']}: "
            f"{trip['total_seats']} seats"
        )

print("Done.")