-- AlterTable: add ADS-B hex + dual-engine tracking phase state to Flight
ALTER TABLE "Flight" ADD COLUMN "icaoHex" TEXT;
ALTER TABLE "Flight" ADD COLUMN "trackingPhase" TEXT;
ALTER TABLE "Flight" ADD COLUMN "enrichmentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Flight" ADD COLUMN "wakeAt" DATETIME;
