-- CreateTable
CREATE TABLE "SharePushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareTokenId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SharePushSubscription_shareTokenId_fkey" FOREIGN KEY ("shareTokenId") REFERENCES "ShareToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SharePushSubscription_endpoint_key" ON "SharePushSubscription"("endpoint");
