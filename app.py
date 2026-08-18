"""
Lambda: get-seats
Trigger: API Gateway  GET /trips/{trip_id}/seats

Public endpoint — returns the full seat map for a trip so the
frontend can render availability before the user picks seats.
"""

import os

import boto3

from common.db import response

dynamodb = boto3.resource("dynamodb")
SEATS_TABLE = dynamodb.Table(os.environ["SEATS_TABLE"])


def lambda_handler(event, context):
    trip_id = (event.get("pathParameters") or {}).get("trip_id")
    if not trip_id:
        return response(400, {"error": "trip_id is required"})

    result = SEATS_TABLE.query(
        KeyConditionExpression="trip_id = :t",
        ExpressionAttributeValues={":t": trip_id},
    )

    seats = sorted(result.get("Items", []), key=lambda s: int(s["seat_number"]))
    return response(200, {"trip_id": trip_id, "seats": seats})
