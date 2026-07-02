-- 00_extensions.sql
-- Required PostgreSQL extensions for the Hospital Management System (HMS) schema.
-- Must run BEFORE all other schema files (00 -> 08) against a fresh PostgreSQL 16 database.

-- pgcrypto: provides gen_random_uuid() for UUID primary keys and
-- pgp_sym_encrypt()/pgp_sym_decrypt() for encrypting patient PII and MFA seeds
-- (the application supplies DATA_ENCRYPTION_KEY at query time; no key is stored here).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- btree_gist: adds GiST operator classes with B-tree behavior (incl. uuid + enum),
-- required for the appointments doctor double-booking exclusion constraint
-- EXCLUDE USING gist (doctor_id WITH =, tstzrange(scheduled_at, ends_at) WITH &&).
CREATE EXTENSION IF NOT EXISTS btree_gist;
