-- AlterTable
ALTER TABLE "Chantier" ADD COLUMN     "clothingBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mealAllowance" DECIMAL(8,2) NOT NULL DEFAULT 9.81;

-- AlterTable
ALTER TABLE "ChantierAssignment" ADD COLUMN     "roomDeduction" DECIMAL(8,2),
ADD COLUMN     "sncfExpense" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "Pointage" ADD COLUMN     "clothingBonusApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mealAllowanceApplied" BOOLEAN NOT NULL DEFAULT false;
