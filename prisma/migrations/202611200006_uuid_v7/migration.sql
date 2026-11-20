-- Temporary UUIDv7 generator for backfilling the two identity changes on PostgreSQL17.
CREATE FUNCTION migration_uuid_v7() RETURNS uuid
LANGUAGE SQL VOLATILE AS $$
  WITH entropy AS (
    SELECT substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6)
      || substring(uuid_send(gen_random_uuid()) FROM 7 FOR 10) AS bytes
  )
  SELECT encode(set_byte(set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112),
    8, (get_byte(bytes, 8) & 63) | 128), 'hex')::uuid FROM entropy
$$;

ALTER TABLE "AppSettings" DROP CONSTRAINT "AppSettings_check";
ALTER TABLE "AppSettings" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "AppSettings" ALTER COLUMN "id" TYPE uuid USING migration_uuid_v7();
ALTER TABLE "AppSettings" ADD COLUMN "singletonKey" integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "AppSettings_singletonKey_key" ON "AppSettings"("singletonKey");
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_singleton_locale_check"
  CHECK ("singletonKey" = 1 AND currency = 'IDR' AND timezone = 'Asia/Jakarta');
UPDATE "AuditLog" SET "entityId" = (SELECT id FROM "AppSettings" WHERE "singletonKey" = 1)
WHERE "entityType" = 'AppSettings' AND "entityId" = '00000000-0000-4000-8000-000000000001'
  AND EXISTS (SELECT 1 FROM "AppSettings");

ALTER TABLE "FineCaseCreation" ADD COLUMN "id" uuid;
UPDATE "FineCaseCreation" SET "id" = migration_uuid_v7();
ALTER TABLE "FineCaseCreation" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "FineCaseCreation" DROP CONSTRAINT "FineCaseCreation_pkey";
ALTER TABLE "FineCaseCreation" ADD CONSTRAINT "FineCaseCreation_pkey" PRIMARY KEY (id);
CREATE UNIQUE INDEX "FineCaseCreation_key_key" ON "FineCaseCreation"("key");
ALTER TABLE "FineCaseCreation" ADD COLUMN "seedKey" varchar(96);
CREATE UNIQUE INDEX "FineCaseCreation_seedKey_key" ON "FineCaseCreation"("seedKey");

-- Preserve the already-applied seed batch when upgrading without a reset.
UPDATE "FineCaseCreation" AS creation SET "seedKey" = legacy.seed_key
FROM (VALUES
  ('fb415c96-84b5-57a4-bde3-6b0e3976e734'::uuid, 'catat-denda:initial-2026:v1:incident:1'),
  ('d8778c4b-7c50-5c67-96f6-d9f09f3673b8'::uuid, 'catat-denda:initial-2026:v1:incident:2'),
  ('3a689398-804a-5a5f-a7fb-95c62241cef4'::uuid, 'catat-denda:initial-2026:v1:incident:3'),
  ('0ebd438f-c37f-505a-8b7d-1bf328b114cb'::uuid, 'catat-denda:initial-2026:v1:incident:4'),
  ('6f5ad3c0-a4a6-539f-b09f-550c9a1e03a6'::uuid, 'catat-denda:initial-2026:v1:incident:5'),
  ('2d60c273-2747-5ea9-8a0d-afc15129c933'::uuid, 'catat-denda:initial-2026:v1:incident:6'),
  ('cedb9e2a-c7ce-5593-b8ee-5d67bccbc40a'::uuid, 'catat-denda:initial-2026:v1:incident:7'),
  ('0e10cc49-df96-56a1-bbd6-5605c0c4a8e2'::uuid, 'catat-denda:initial-2026:v1:incident:8'),
  ('6d9325a2-fe25-5bae-8a79-7164cc418a6b'::uuid, 'catat-denda:initial-2026:v1:incident:9'),
  ('56276cb8-018b-56fd-a600-dead34cb7d98'::uuid, 'catat-denda:initial-2026:v1:incident:10'),
  ('9a0e6c42-b309-5a80-bb51-ea11de56e1d4'::uuid, 'catat-denda:initial-2026:v1:incident:11'),
  ('67a08208-ead6-5ac5-b47e-6bed8c15532c'::uuid, 'catat-denda:initial-2026:v1:incident:12'),
  ('8e1d5142-30b2-5e71-9951-c9f204aee670'::uuid, 'catat-denda:initial-2026:v1:incident:13'),
  ('65185977-c2ec-5e57-afd2-e041ac5d82ea'::uuid, 'catat-denda:initial-2026:v1:incident:14'),
  ('8ab64b09-3b1e-5cdf-9660-9e21428c4eb9'::uuid, 'catat-denda:initial-2026:v1:incident:15'),
  ('0cad5999-01b8-5998-89cc-11fdb5d8ca10'::uuid, 'catat-denda:initial-2026:v1:incident:16'),
  ('9b97bb3c-cfd9-5af5-b5d8-4dc3e046d030'::uuid, 'catat-denda:initial-2026:v1:incident:17'),
  ('e4073eae-556d-5aa8-b783-3ecce058385f'::uuid, 'catat-denda:initial-2026:v1:incident:18')
) AS legacy(key, seed_key) WHERE creation.key = legacy.key;

DROP FUNCTION migration_uuid_v7();
