/*
  Warnings:

  - You are about to drop the column `role` on the `ChantierAssignment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ChantierAssignment" DROP COLUMN "role";

-- AlterTable
ALTER TABLE "UserCrmAccess" ADD COLUMN     "isForeman" BOOLEAN NOT NULL DEFAULT false;

-- DropEnum
DROP TYPE "ChantierAssignmentRole";
