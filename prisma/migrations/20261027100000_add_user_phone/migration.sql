-- AlterTable: add nullable, backfill existing rows with a unique placeholder, then enforce
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
UPDATE "User" SET "phone" = 'legacy-' || "id" WHERE "phone" IS NULL;
ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
