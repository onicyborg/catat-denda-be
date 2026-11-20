-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('PREPARATION', 'SPILL', 'CLEANLINESS', 'INVENTORY_LOG', 'ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('PAYMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "Method" AS ENUM ('CASH', 'TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "lastLoginAt" TIMESTAMPTZ,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "employeeCode" VARCHAR(40),
    "displayName" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "archivedAt" TIMESTAMPTZ,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAlias" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "aliasDisplay" VARCHAR(120) NOT NULL,
    "aliasNormalized" VARCHAR(120) NOT NULL,

    CONSTRAINT "EmployeeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationType" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "Category" NOT NULL,
    "description" TEXT,
    "defaultAmountPerPerson" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ViolationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FineCase" (
    "id" UUID NOT NULL,
    "caseNumber" SERIAL NOT NULL,
    "occurredAt" TIMESTAMPTZ,
    "violationTypeId" UUID,
    "violationCodeSnapshot" VARCHAR(40),
    "violationNameSnapshot" VARCHAR(120),
    "violationCategorySnapshot" VARCHAR(40),
    "defaultRateSnapshot" INTEGER,
    "description" TEXT,
    "sourceText" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" UUID NOT NULL,
    "postedBy" UUID,
    "voidedBy" UUID,
    "postedAt" TIMESTAMPTZ,
    "voidedAt" TIMESTAMPTZ,
    "voidReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FineCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FineCaseMember" (
    "id" UUID NOT NULL,
    "fineCaseId" UUID NOT NULL,
    "employeeId" UUID,
    "employeeNameSnapshot" VARCHAR(120),
    "rawEmployeeName" VARCHAR(120),
    "assignedAmount" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FineCaseMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEntry" (
    "id" UUID NOT NULL,
    "fineCaseMemberId" UUID NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "Method",
    "effectiveAt" TIMESTAMPTZ NOT NULL,
    "originalPaymentId" UUID,
    "note" TEXT,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "businessName" VARCHAR(150) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "finePolicyReference" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "updatedBy" UUID NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAlias_aliasNormalized_key" ON "EmployeeAlias"("aliasNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationType_code_key" ON "ViolationType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FineCase_caseNumber_key" ON "FineCase"("caseNumber");

-- CreateIndex
CREATE INDEX "FineCase_status_occurredAt_idx" ON "FineCase"("status", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "FineCase_violationTypeId_occurredAt_idx" ON "FineCase"("violationTypeId", "occurredAt");

-- CreateIndex
CREATE INDEX "FineCaseMember_employeeId_fineCaseId_idx" ON "FineCaseMember"("employeeId", "fineCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "FineCaseMember_fineCaseId_employeeId_key" ON "FineCaseMember"("fineCaseId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEntry_originalPaymentId_key" ON "PaymentEntry"("originalPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEntry_idempotencyKey_key" ON "PaymentEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentEntry_fineCaseMemberId_effectiveAt_idx" ON "PaymentEntry"("fineCaseMemberId", "effectiveAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAlias" ADD CONSTRAINT "EmployeeAlias_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FineCase" ADD CONSTRAINT "FineCase_violationTypeId_fkey" FOREIGN KEY ("violationTypeId") REFERENCES "ViolationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FineCaseMember" ADD CONSTRAINT "FineCaseMember_fineCaseId_fkey" FOREIGN KEY ("fineCaseId") REFERENCES "FineCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FineCaseMember" ADD CONSTRAINT "FineCaseMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEntry" ADD CONSTRAINT "PaymentEntry_fineCaseMemberId_fkey" FOREIGN KEY ("fineCaseMemberId") REFERENCES "FineCaseMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEntry" ADD CONSTRAINT "PaymentEntry_originalPaymentId_fkey" FOREIGN KEY ("originalPaymentId") REFERENCES "PaymentEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ViolationType" ADD CHECK ("defaultAmountPerPerson" BETWEEN 1 AND 100000000);
ALTER TABLE "FineCaseMember" ADD CHECK ("assignedAmount" IS NULL OR "assignedAmount" BETWEEN 1 AND 100000000);
ALTER TABLE "PaymentEntry" ADD CHECK (amount BETWEEN 1 AND 100000000);
ALTER TABLE "PaymentEntry" ADD CHECK ((kind = 'PAYMENT' AND "originalPaymentId" IS NULL AND method IS NOT NULL) OR (kind = 'REVERSAL' AND "originalPaymentId" IS NOT NULL AND method IS NULL));
ALTER TABLE "AppSettings" ADD CHECK (id = 1 AND currency = 'IDR' AND timezone = 'Asia/Jakarta');
ALTER TABLE "FineCase" ADD FOREIGN KEY ("createdBy") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "FineCase" ADD FOREIGN KEY ("postedBy") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "FineCase" ADD FOREIGN KEY ("voidedBy") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "PaymentEntry" ADD FOREIGN KEY ("recordedBy") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "AuditLog" ADD FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "AppSettings" ADD FOREIGN KEY ("updatedBy") REFERENCES "User"(id) ON DELETE RESTRICT;
