# FiberOS deployment secrets

The source distribution intentionally does not contain live credentials or production TLS private keys.

Before starting `docker-compose.base.yml`, create `deploy/secrets/pg_owner_password.txt`.
For production TLS, additionally create `deploy/secrets/server.crt` and `deploy/secrets/server.key` (private key mode 0600, owned by the PostgreSQL container user).

Use:

```text
docker compose -f deploy/docker-compose.base.yml -f deploy/docker-compose.tls.yml up -d db
```

The TLS override fails closed if the operator-provided certificate files are absent.
