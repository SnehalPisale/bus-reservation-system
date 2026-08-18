# Cloud-Based Bus Ticket Reservation System

A serverless AWS application for searching bus routes, reserving seats,
and managing bookings — built entirely on free-tier-eligible services.

## Architecture

```
┌────────────────┐        ┌──────────────────────┐
│ Frontend (S3   │  HTTP  │   API Gateway (REST)  │
│ static website)│───────▶│  + Cognito Authorizer │
└────────────────┘        └──────────┬───────────┘
                                      │
        ┌─────────────────┬──────────┼───────────────┬─────────────────┐
        ▼                 ▼          ▼                ▼                 ▼
  GET /routes      GET /trips/{id}  POST /bookings  GET /bookings   DELETE /bookings/{id}
  search-routes    /seats           create-booking  list-bookings  cancel-booking
  (public)         get-seats        (auth)          (auth)         (auth)
                    (public)
        │                 │              │                │              │
        ▼                 ▼              ▼                ▼              ▼
                    ┌────────────────────────────────────────────┐
                    │              DynamoDB                       │
                    │  Trips · Seats · Bookings (+ GSIs)          │
                    └────────────────────────────────────────────┘

                    ┌────────────────────────────────────────────┐
                    │     Cognito User Pool (sign up / sign in)   │
                    └────────────────────────────────────────────┘
```

**Why this design meets each requirement:**

- **Search routes** — `GET /routes` queries a DynamoDB GSI keyed on
  `origin#destination` + `travel_date`, so it never scans the whole
  table even as trips grow.
- **Reserve seats, no double-booking, high traffic** — `create-booking`
  wraps the seat updates and the trip's available-seat counter in a
  single DynamoDB **`TransactWriteItems`** call with a
  `ConditionExpression` on each seat (`status = AVAILABLE`). If two
  users click the same seat at the same instant, only one transaction
  succeeds — the other gets a `409` and the seat map re-renders as
  booked. No locking, no race condition, and it scales automatically
  with traffic since every piece (Lambda, DynamoDB on-demand, API
  Gateway) is serverless.
- **Manage bookings** — `list-bookings` / `cancel-booking`, scoped to
  the signed-in user via a Cognito JWT, query a `user_id` GSI so a
  user only ever reads their own data.
- **Secure storage** — DynamoDB encrypts data at rest by default;
  bookings are tied to the caller's Cognito identity (`sub` claim from
  the verified ID token), not a client-supplied user ID, so no one can
  view or cancel someone else's booking.
- **Scalable infrastructure** — Lambda, API Gateway, and DynamoDB
  on-demand all scale horizontally with no capacity you have to
  provision or manage.

## AWS services used (all free-tier eligible)

| Service | Role | Free tier |
|---|---|---|
| Cognito | User sign-up / sign-in, issues JWTs | 50,000 MAUs, always free |
| API Gateway | REST API, Cognito authorizer, CORS | 1M calls/month (first 12 months) |
| Lambda | Search, seats, booking, cancellation logic | 1M requests/month, always free |
| DynamoDB | Trips, Seats, Bookings (on-demand) | 25 GB storage, always free |
| S3 | Static frontend hosting | 5 GB storage |

Realistic cost for building and testing this: **$0**.

## Project structure

```
bus-reservation-system/
├── template.yaml                  # AWS SAM (infrastructure as code)
├── src/
│   ├── layers/common/             # shared response/auth/validation helpers
│   ├── search_routes/app.py       # GET  /routes
│   ├── get_seats/app.py           # GET  /trips/{trip_id}/seats
│   ├── create_booking/app.py      # POST /bookings   (atomic reservation)
│   ├── list_bookings/app.py       # GET  /bookings
│   └── cancel_booking/app.py      # DELETE /bookings/{booking_id}
├── frontend/                      # plain HTML/JS/CSS, no build step
│   ├── index.html
│   ├── app.js                     # Cognito auth (direct fetch) + API calls
│   ├── config.js                  # fill in after deploy
│   └── styles.css
├── sample_data/seed.json          # sample routes/trips
├── scripts/seed_dynamodb.py       # loads sample_data into DynamoDB
└── tests/test_booking_logic.py    # local unit tests, no AWS needed
```

## Prerequisites

1. AWS free-tier account.
2. [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed and configured (`aws configure`).
3. [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed.
4. Python 3.12 and `boto3` locally (`pip install boto3 --break-system-packages`) for running tests and the seed script.

## Deploy

```bash
cd bus-reservation-system

# Run the local tests first (optional but recommended)
python tests/test_booking_logic.py

# Build and deploy
sam build
sam deploy --guided
```

During `--guided` setup: accept the defaults, confirm "Allow SAM CLI IAM
role creation" = Yes, and "Save arguments to configuration file" = Yes.

Note the `Outputs` when it finishes: `ApiEndpoint`, `UserPoolClientId`,
`FrontendBucketName`, `FrontendWebsiteURL`.

## Load sample data

```bash
python scripts/seed_dynamodb.py
```

This creates 3 sample trips (Bengaluru→Pune ×2, Mumbai→Goa) and their
full seat inventory, all dated `2026-09-01` — search using that date,
or edit `sample_data/seed.json` first.

## Configure and deploy the frontend

Open `frontend/config.js` and fill in the values from the stack Outputs:

```javascript
const CONFIG = {
  region: "us-east-1",                 // your deploy region
  apiBaseUrl: "<ApiEndpoint output>",
  userPoolClientId: "<UserPoolClientId output>",
};
```

Then upload the frontend to its bucket:

```bash
aws s3 sync frontend/ s3://<FrontendBucketName output>
```

Open `<FrontendWebsiteURL output>` in a browser.

> If the page loads but assets 403, your account's S3 "Block Public
> Access" default may be overriding the bucket policy — go to the
> bucket in the S3 console → Permissions → Block public access, and
> turn it off for this bucket.

## Test the full flow

1. **Sign up** with an email + password, then check that inbox for a
   verification code and enter it under **Confirm**.
2. **Sign in.**
3. **Search**: From `Bengaluru`, To `Pune`, Date `2026-09-01` → two
   trips should appear.
4. **Select** a trip → click a few available (green) seats.
5. Enter a passenger name + contact → **Confirm booking**. The seat
   map refreshes and those seats turn grey.
6. Check **My bookings** — the new booking is listed.
7. **Cancel** it — the seats become available again.
8. To see the concurrency protection: open the same trip in two
   browser tabs, select the *same* seat in both, and book from both —
   the second one gets a "no longer available" error instead of a
   double-booked seat.

## Automated / local testing

`tests/test_booking_logic.py` checks the booking-request validation
logic in isolation (no AWS calls). For testing the deployed API
directly:

```bash
sam logs -n create-booking --tail
sam logs -n search-routes --tail
```

For a load test against the free tier's `1M requests/month` ceiling, a
tool like `artillery` or `hey` pointed at the `ApiEndpoint` is a
reasonable next step — Lambda and DynamoDB on-demand will scale to
absorb it without any infrastructure changes on your part.

## Extending it

- **CloudFront** in front of the S3 frontend bucket adds HTTPS, a CDN,
  and a custom domain — worth adding before showing this to real
  users, since the raw S3 website endpoint is HTTP-only.
- **Payments**: hook `create-booking` up to a payment step (e.g. mark
  the booking `PENDING_PAYMENT` first, confirm on webhook) if this
  needs to take real money.
- **Admin operations** (adding trips/routes) currently go through the
  seed script; a small admin-only API + a Cognito user group would be
  the natural next step.

## Cleanup (avoid any charges after you're done)

```bash
aws s3 rm s3://<FrontendBucketName output> --recursive
sam delete
```
