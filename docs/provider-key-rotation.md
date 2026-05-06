# Provider key rotation runbook

Provider credentials in `agent_providers.apiKeyEncryptedPlaceholder` are
encrypted under `PROVIDER_KEY_SECRET` (see
`artifacts/api-server/src/lib/provider-secrets.ts`). This document is the
operational runbook for rotating that secret without losing saved keys.

## Wire formats

Two formats coexist on the column:

| Format | Layout | Notes |
| --- | --- | --- |
| v1 (legacy) | `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>` | 5 segments, no key id. Default for new writes. |
| v2 (tagged) | `enc:v2:<keyId>:<iv_b64>:<tag_b64>:<ct_b64>` | 6 segments. Written when `PROVIDER_KEY_ID` is set. |

Values without an `enc:vN:` prefix are treated as legacy plaintext and
returned as-is.

## Environment variables

| Var | Purpose |
| --- | --- |
| `PROVIDER_KEY_SECRET` | **Required in production.** Current encryption secret. |
| `PROVIDER_KEY_SECRET_OLD` | Optional fallback secret used during rotation windows so existing rows still decrypt. |
| `PROVIDER_KEY_ID` | Optional. When set, new writes use the v2 wire format with this key id (e.g. `2026-05`). Without it, new writes stay on v1. |
| `PROVIDER_KEY_ID_OLD` | Optional. Tags the fallback key id when reading v2 rows; defaults to `"old"`. |

Key ids are restricted to `[A-Za-z0-9_.-]+` so they cannot collide with
the `:` wire-format delimiter — both the runtime and the rotation script
reject invalid ids at startup.

## Zero-downtime rotation

1. Pick a new secret value.
2. On the api-server, set `PROVIDER_KEY_SECRET_OLD` to the *current*
   secret and `PROVIDER_KEY_SECRET` to the *new* secret, then restart.
   Existing rows still decrypt via the OLD fallback while new writes
   immediately use the new key.
3. Run the rotation script with the same OLD/NEW values:

   ```bash
   PROVIDER_KEY_SECRET_OLD=<old> PROVIDER_KEY_SECRET=<new> \
     pnpm --filter @workspace/scripts run rotate-provider-keys -- --dry  # preview
   PROVIDER_KEY_SECRET_OLD=<old> PROVIDER_KEY_SECRET=<new> \
     pnpm --filter @workspace/scripts run rotate-provider-keys           # apply
   ```

   The script is idempotent (rows already on the new key are skipped) and
   exits non-zero if any row fails to decrypt under the OLD key.
4. Once the script reports `failed=0`, remove `PROVIDER_KEY_SECRET_OLD`
   from the environment and restart.

## Rollback

If anything goes wrong mid-rotation:

- Restore the previous `PROVIDER_KEY_SECRET` value.
- Leave `PROVIDER_KEY_SECRET_OLD` unset (or point it at the *new* secret
  to keep partially-rotated rows readable).
- Restart the server.

Any rows that were already re-encrypted under the new key will fail to
decrypt under only the old key and can be re-saved through the
Settings → Providers UI; rows still on the old key continue to work
unchanged.

## Related files

- Runtime: `artifacts/api-server/src/lib/provider-secrets.ts`
- Tests: `artifacts/api-server/src/lib/provider-secrets.test.ts`
- Backfill (one-shot, plaintext → encrypted): `scripts/src/encrypt-provider-keys.ts`
- Rotation script: `scripts/src/rotate-provider-keys.ts`
