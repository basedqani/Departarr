-- AlterTable: add isAdmin to User
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: add OOOI takeoff fields to Flight
ALTER TABLE "Flight" ADD COLUMN "takeoffScheduled" DATETIME;
ALTER TABLE "Flight" ADD COLUMN "takeoffEstimated" DATETIME;
ALTER TABLE "Flight" ADD COLUMN "takeoffActual" DATETIME;

-- AlterTable: add OOOI landing fields to Flight
ALTER TABLE "Flight" ADD COLUMN "landingScheduled" DATETIME;
ALTER TABLE "Flight" ADD COLUMN "landingEstimated" DATETIME;
ALTER TABLE "Flight" ADD COLUMN "landingActual" DATETIME;

-- AlterTable: add user-editable booking detail fields to Flight
ALTER TABLE "Flight" ADD COLUMN "seat" TEXT;
ALTER TABLE "Flight" ADD COLUMN "confirmationCode" TEXT;
