-- CreateEnum
CREATE TYPE "ApiKeyPermission" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "permission" "ApiKeyPermission" NOT NULL DEFAULT 'READ_ONLY';
