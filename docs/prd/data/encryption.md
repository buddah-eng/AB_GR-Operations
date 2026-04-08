# PII Encryption

> Column-level application-layer encryption (AES-256-GCM) for guest PII fields on top of RBAC and Cloud SQL
> at-rest encryption. Key in GCP Secret Manager, never in DB or source code. Decrypt only after RBAC field
> filtering — if a role can't see the field, decryption never runs. Three layers: TLS in transit, at-rest
> disk encryption, column-level encryption for PII.

---

## Overview

Guest data includes legally and ethically sensitive PII: names, emails, phone numbers, passport/visa info, dietary restrictions (health data), hotel room numbers, flight details, home addresses, and compensation amounts. RBAC controls who can access this data through the API. Encryption controls what happens if the database itself is compromised — backup stolen, DB credentials leaked, rogue actor with direct SQL access.

Three layers of encryption protect data at different threat levels. The critical addition beyond standard cloud infrastructure is **column-level application-layer encryption** for PII fields, ensuring that even with direct database access, sensitive data is unreadable without the application's encryption key.

---

## Full Specification

### 1. Three Encryption Layers

**Purpose:** Define defense-in-depth encryption strategy.

| Layer | What | Protects Against | Implementation |
|---|---|---|---|
| **TLS in transit** | All connections encrypted (client→API, API→Postgres, API→Redis) | Network sniffing, MITM | Cloud SQL requires SSL; Cloud Run enforces HTTPS |
| **At-rest (disk)** | Cloud SQL storage encrypted with AES-256 | Physical disk theft, data center breach | Google-managed keys (default), option for CMEK |
| **Column-level (application)** | PII fields encrypted before write, decrypted after read | DB credential compromise, backup theft, direct SQL access, rogue admin |  Application-layer AES-256-GCM via Node `crypto` |

**Why column-level matters:** Cloud SQL at-rest encryption protects the disk, but anyone with DB credentials can `SELECT * FROM guests` and see plaintext. Column-level encryption means PII fields are stored as encrypted `bytea` — even direct SQL access returns gibberish without the application key.

**Acceptance Criteria:**
- [ ] All Postgres connections use SSL (enforced, not optional)
- [ ] Cloud SQL at-rest encryption verified enabled
- [ ] PII fields unreadable via direct SQL without application key

---

### 2. What Gets Encrypted

**Purpose:** Define which fields across which concepts require encryption.

| Field | Concept(s) | Data Type | Why |
|---|---|---|---|
| `email` | guest, staff, volunteer | Contact PII | GDPR/privacy |
| `phone` | guest, staff, volunteer | Contact PII | GDPR/privacy |
| `emergency_contact` | volunteer | Health/safety PII | Sensitive personal |
| `passport_number` | guest | Government ID | Identity theft risk |
| `visa_details` | guest | Immigration data | Legal sensitivity |
| `hotel_room` | guest (accommodation) | Physical security | Safety concern |
| `home_address` | guest (contracts) | Physical address | Stalking/safety risk |
| `dietary_restrictions` | guest | Health data | Medical privacy |
| `flight_details` | guest (transport) | Travel PII | Security/privacy |
| `driver_phone` | transport_driver | Contact PII | Privacy |
| `compensation` | guest (contracts) | Financial data | Confidentiality |
| `api_key_hash` | api_clients | Credential | Already hashed, but encrypted hash adds layer |

**What does NOT get encrypted:**
- `name` — needed for display in lists, search, and sorting. Protected by RBAC, not encryption.
- `status`, `type`, `department` — operational fields used in queries/filters. Not PII.
- `id`, `created_at`, `updated_at` — system metadata.

**Acceptance Criteria:**
- [ ] All listed fields stored as encrypted bytea in Postgres
- [ ] Unencrypted values never written to any database column or log

---

### 3. Encryption Implementation

**Purpose:** Define the application-layer encryption approach.

**Detail:**

**Algorithm:** AES-256-GCM (authenticated encryption — provides both confidentiality and integrity)

**Key management:**
- Encryption key stored in GCP Secret Manager
- Key ID referenced in application config (environment variable pointing to secret)
- Key rotation: new key version created periodically; old versions retained for decryption of existing data
- Key never appears in source code, environment variables as plaintext, logs, or the database

**Encryption flow (write):**
```typescript
import { createCipheriv, randomBytes } from 'crypto'

function encrypt(plaintext: string, key: Buffer): EncryptedField {
  const iv = randomBytes(12)  // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: authTag.toString('base64'),
    keyVersion: currentKeyVersion,
  }
}
// Stored in Postgres as JSONB: { iv, data, tag, keyVersion }
```

**Decryption flow (read):**
```typescript
import { createDecipheriv } from 'crypto'

function decrypt(field: EncryptedField, keys: Map<number, Buffer>): string {
  const key = keys.get(field.keyVersion)
  if (!key) throw new Error(`Unknown key version: ${field.keyVersion}`)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(field.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(field.tag, 'base64'))
  return decipher.update(Buffer.from(field.data, 'base64')) + decipher.final('utf8')
}
```

**Storage format:** Encrypted fields stored as JSONB containing `{ iv, data, tag, keyVersion }`. This allows key rotation (old data decryptable with old key version, new data encrypted with new key).

**Why application-layer over pgcrypto:**
- Encryption key never reaches the database server
- Works with any Postgres host (no extension dependency)
- Decryption happens in the application where RBAC already filters
- No risk of key exposure in Postgres logs or `pg_stat_statements`

**Acceptance Criteria:**
- [ ] AES-256-GCM with unique IV per field per write
- [ ] Key version tracked per encrypted field for rotation support
- [ ] Key stored only in Secret Manager, loaded at application startup

---

### 4. RBAC + Encryption Interaction

**Purpose:** Define how encryption integrates with the existing RBAC pipeline.

**Detail:**

```
Request → Auth → RBAC check → Data scope filter → Postgres query
  → encrypted JSONB returned → RBAC field filter (strip invisible fields)
  → decrypt ONLY remaining visible fields → return plaintext to authorized user
```

**Critical order:** Field filtering happens BEFORE decryption. If a role's `visibleProperties` doesn't include `email`, the encrypted email field is stripped from the record before any decryption runs. This means:

1. **No unnecessary decryption** — only decrypt what the user is authorized to see
2. **No plaintext leakage** — unauthorized fields never exist in plaintext in application memory
3. **Performance benefit** — fewer fields to decrypt per request

**The encryption layer in the data access module:**
```typescript
// In functions/src/db/encryption.ts
async function decryptRecord(
  record: Record<string, unknown>,
  encryptedFields: string[]  // from ontology property metadata
): Promise<Record<string, unknown>> {
  const result = { ...record }
  for (const field of encryptedFields) {
    if (result[field] && typeof result[field] === 'object') {
      result[field] = decrypt(result[field] as EncryptedField, keys)
    }
  }
  return result
}
```

**Which properties are encrypted** is defined in the ontology. A new property-level flag `encrypted: boolean` on the `ontology_properties` table tells the data access layer to encrypt/decrypt.

**Acceptance Criteria:**
- [ ] Decryption runs only after RBAC field filtering
- [ ] Fields stripped by RBAC are never decrypted
- [ ] Encrypted flag on ontology properties controls encryption behavior

---

### 5. Searchability of Encrypted Fields

**Purpose:** Address the trade-off between encryption and queryability.

**Detail:**

Encrypted fields cannot be searched or filtered via SQL (the values are opaque bytea). This is an intentional trade-off:

| Need | Solution |
|---|---|
| Search by email | Blind index: store `HMAC-SHA256(email)` alongside encrypted email. Search by HMAC, return encrypted record, decrypt in app |
| Filter by dietary restriction | Accept that dietary filters must load + decrypt in application memory (small dataset, acceptable for convention scale) |
| Sort by name | Name is NOT encrypted — it's protected by RBAC, not encryption |
| Display in lists | Decrypt on read for authorized users. Cache decrypted values in application memory (not Redis — never cache plaintext externally) |

**Blind index for email:**
```sql
ALTER TABLE guests ADD COLUMN email_hmac TEXT;
CREATE INDEX idx_guests_email_hmac ON guests (email_hmac);

-- On write: email_hmac = HMAC-SHA256(email, hmac_key)
-- On lookup: compute HMAC of search term, query by email_hmac
```

**Acceptance Criteria:**
- [ ] Email lookup works via blind index without decrypting all records
- [ ] Dietary restriction filtering works (application-level, acceptable at convention scale)
- [ ] No plaintext PII in Redis or any external cache

---

### 6. Key Rotation

**Purpose:** Define how encryption keys are rotated.

**Detail:**

1. New key version created in Secret Manager
2. Application loads new key version on next startup/deploy
3. New writes encrypted with new key version (`keyVersion` field in encrypted JSONB)
4. Old writes remain decryptable (old key versions retained in Secret Manager)
5. Optional: background migration job re-encrypts old records with new key (batch, off-peak)
6. Old key version retired after all records re-encrypted

**Rotation frequency:** Annually, or immediately if compromise suspected.

**Acceptance Criteria:**
- [ ] New key version immediately used for new writes
- [ ] Old records remain decryptable after rotation
- [ ] Re-encryption migration runs without downtime

---

### 7. Audit Integration

**Purpose:** Define how encryption interacts with the audit system.

**Detail:**

- **Audit logs store encrypted values:** `old_value` and `new_value` JSONB in audit tables contain the encrypted form, not plaintext. Audit log readers must have decryption access to see PII changes.
- **Access logging:** Every decryption operation logged: who decrypted which field for which record at what time. Separate from the domain audit log — this is a security audit.
- **Admin forensics:** Requires encryption key access. Standard admin dashboard shows "[encrypted]" for PII fields in audit views. Decrypted view requires elevated security role.

**Acceptance Criteria:**
- [ ] Audit logs don't contain plaintext PII
- [ ] Decryption operations logged separately
- [ ] Forensics requires explicit security role beyond normal admin

---

### 8. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Encrypt/decrypt roundtrip | Unit | Encrypt string → decrypt → matches original | All field types roundtrip correctly |
| Unique IV per write | Unit | Two encryptions of same value produce different ciphertext | IV uniqueness verified |
| Key rotation | Integration | Write with key v1, rotate to v2, read old record | Old record decryptable with v1 |
| RBAC + encryption | Integration | Unauthorized field → no decryption attempted | Decryption function not called for stripped fields |
| Blind index lookup | Integration | Store HMAC, search by email → correct record found | Lookup works without decrypting all records |
| Direct SQL access | Security | SELECT encrypted column via psql → unreadable | Ciphertext returned, not plaintext |
| Audit log | Integration | Update encrypted field → audit log has encrypted values | No plaintext in audit |
| Key not in logs | Security | Grep application logs for key material | Zero matches |
| Performance | Load | 50 concurrent reads with decryption | <50ms p95 additional latency from decryption |

**Coverage target:** 100% on encrypt/decrypt functions (security-critical). ≥80% on RBAC+encryption interaction.
