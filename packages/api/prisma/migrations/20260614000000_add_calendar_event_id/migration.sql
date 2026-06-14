-- AlterTable
ALTER TABLE "Flight" ADD COLUMN "calendarEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Flight_userId_calendarEventId_key" ON "Flight"("userId", "calendarEventId");
