/*
  Warnings:

  - A unique constraint covering the columns `[userId,workspaceId]` on the table `Membership` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Membership_userId_workspaceId_memberName_key";

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_workspaceId_key" ON "Membership"("userId", "workspaceId");
