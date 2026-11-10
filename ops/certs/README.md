# Supabase PostgreSQL CA on Railway

Public CA certificate supplied by the operator from Supabase Dashboard (2026-11-10).
Subject: Supabase Root 2021 CA. Valid until 2031-04-26.
SHA256 fingerprint: 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA

For the current Railpack image rooted at /app, configure Railway Variables:

    PG_SSL_MODE=verify-full
    PG_SSL_CA_FILE=/app/ops/certs/supabase-prod-ca-2021.crt

Deploy an image containing this file before enabling the path. The existing
PostgreSQL adapter loads this CA and keeps rejectUnauthorized=true. Do not disable
TLS verification. This certificate contains no private key and is not a browser asset.

Local checks verify PEM parsing, CA constraints, expiry, self-signature and adapter
loading. They do not prove that the live session pooler presents a chain signed by
this CA. Check deployment logs and /health after deployment; if TLS still fails,
inspect the exact TLS category/chain instead of bypassing verification.

Rollback: restore the previous image and previous PG_SSL_CA_FILE setting while
keeping admission closed. This does not change database contents.
