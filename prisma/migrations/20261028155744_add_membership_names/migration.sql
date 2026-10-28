-- CreateIndex
CREATE UNIQUE INDEX "User_id_name_key" ON "User"("id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_id_name_key" ON "Workspace"("id", "name");

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_userId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_workspaceId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Membership_userId_workspaceId_key";

-- AlterTable: Add columns as nullable first
ALTER TABLE "Membership" ADD COLUMN "memberName" TEXT,
ADD COLUMN "workspaceName" TEXT;

-- Backfill data from User and Workspace
UPDATE "Membership" m
SET "memberName" = u."name"
FROM "User" u
WHERE m."userId" = u."id";

UPDATE "Membership" m
SET "workspaceName" = w."name"
FROM "Workspace" w
WHERE m."workspaceId" = w."id";

-- AlterTable: Enforce NOT NULL after backfill
ALTER TABLE "Membership" ALTER COLUMN "memberName" SET NOT NULL,
ALTER COLUMN "workspaceName" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_workspaceId_memberName_key" ON "Membership"("userId", "workspaceId", "memberName");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_memberName_fkey" FOREIGN KEY ("userId", "memberName") REFERENCES "User"("id", "name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_workspaceName_fkey" FOREIGN KEY ("workspaceId", "workspaceName") REFERENCES "Workspace"("id", "name") ON DELETE CASCADE ON UPDATE CASCADE;
