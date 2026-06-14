-- CreateTable
CREATE TABLE "Train" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tripId" TEXT,
    "trainNumber" TEXT NOT NULL,
    "trainName" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "originName" TEXT,
    "destinationName" TEXT,
    "departureScheduled" DATETIME NOT NULL,
    "departureEstimated" DATETIME,
    "departureActual" DATETIME,
    "arrivalScheduled" DATETIME NOT NULL,
    "arrivalEstimated" DATETIME,
    "arrivalActual" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "stopsJson" TEXT,
    "seat" TEXT,
    "confirmationCode" TEXT,
    "calendarEventId" TEXT,
    "lastPolledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Train_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Train_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainEvent_trainId_fkey" FOREIGN KEY ("trainId") REFERENCES "Train" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Train_userId_calendarEventId_key" ON "Train"("userId", "calendarEventId");
