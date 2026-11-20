ALTER TABLE "AppSettings" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId","createdAt" DESC);
