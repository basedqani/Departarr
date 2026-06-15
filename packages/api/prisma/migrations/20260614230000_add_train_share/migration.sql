-- Add trainId column to ShareToken for train sharing support
ALTER TABLE "ShareToken" ADD COLUMN "trainId" TEXT;
