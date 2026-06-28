-- CreateTable
CREATE TABLE "AppErrorEvent" (
    "id" TEXT NOT NULL,
    "publicEventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "internalCode" TEXT,
    "httpStatus" INTEGER,
    "correlationId" TEXT,
    "route" TEXT,
    "requestMethod" TEXT,
    "appVersion" TEXT,
    "browserFamily" TEXT,
    "platform" TEXT,
    "onlineStatus" BOOLEAN,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "sanitizedContext" JSONB,
    "diagnosticFingerprint" TEXT,
    "serverStackFingerprint" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" TEXT NOT NULL,
    "publicReportId" TEXT NOT NULL,
    "errorEventId" TEXT,
    "reporterPseudonym" TEXT NOT NULL,
    "encryptedReporterRef" TEXT,
    "encryptedReporterIv" TEXT,
    "encryptedReporterTag" TEXT,
    "userNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "severity" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "diagnosticFingerprint" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppErrorEvent_publicEventId_key" ON "AppErrorEvent"("publicEventId");

-- CreateIndex
CREATE INDEX "AppErrorEvent_category_createdAt_idx" ON "AppErrorEvent"("category", "createdAt");

-- CreateIndex
CREATE INDEX "AppErrorEvent_diagnosticFingerprint_idx" ON "AppErrorEvent"("diagnosticFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentReport_publicReportId_key" ON "IncidentReport"("publicReportId");

-- CreateIndex
CREATE INDEX "IncidentReport_status_lastSeenAt_idx" ON "IncidentReport"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "IncidentReport_severity_lastSeenAt_idx" ON "IncidentReport"("severity", "lastSeenAt");

-- CreateIndex
CREATE INDEX "IncidentReport_reporterPseudonym_diagnosticFingerprint_idx" ON "IncidentReport"("reporterPseudonym", "diagnosticFingerprint");

-- CreateIndex
CREATE INDEX "IncidentReport_reporterPseudonym_lastSeenAt_idx" ON "IncidentReport"("reporterPseudonym", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_errorEventId_fkey" FOREIGN KEY ("errorEventId") REFERENCES "AppErrorEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
