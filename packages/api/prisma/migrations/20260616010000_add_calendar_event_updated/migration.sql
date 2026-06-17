-- AlterTable: track Google Calendar event.updated so edited events re-enrich (CAL-3)
ALTER TABLE "Flight" ADD COLUMN "calendarEventUpdated" DATETIME;
ALTER TABLE "Train" ADD COLUMN "calendarEventUpdated" DATETIME;
