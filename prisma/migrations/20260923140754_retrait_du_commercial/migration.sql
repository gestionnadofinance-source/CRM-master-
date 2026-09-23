-- Retrait du volet commercial de l'ERP.
--
-- Les conversions d'énumération générées plus bas utilisent un cast
-- `USING (colonne::text::"Type_new")` : il échoue dès qu'UNE seule ligne
-- porte encore une valeur retirée du type. Ce préambule normalise donc les
-- données AVANT la conversion. Il est sans effet sur une base déjà propre.
--
-- Les lignes concernées ne peuvent plus rien exprimer d'utile une fois le
-- volet commercial retiré :
--   - un accès de catégorie COMMERCIAL n'ouvrirait plus aucun onglet ;
--   - les permissions commerciales ne gardent plus aucune route ;
--   - les notifications commerciales pointent vers des pages supprimées.

-- Un accès commercial devient un accès ouvrier : c'est la catégorie la
-- moins privilégiée. Un administrateur pourra le repositionner en
-- secrétaire depuis /admin/users si besoin.
UPDATE "UserCrmAccess" SET "category" = 'OUVRIER' WHERE "category" = 'COMMERCIAL';

-- Retire les permissions commerciales des dérogations explicites, en
-- conservant les autres valeurs du tableau.
UPDATE "UserCrmAccess"
SET "permissions" = ARRAY(
  SELECT p FROM unnest("permissions") AS p
  WHERE p::text NOT IN ('MANAGE_APPOINTMENTS', 'MANAGE_QUOTES', 'MANAGE_PROSPECTS', 'MANAGE_CLIENTS')
)::"Permission"[]
WHERE "permissions" && ARRAY['MANAGE_APPOINTMENTS', 'MANAGE_QUOTES', 'MANAGE_PROSPECTS', 'MANAGE_CLIENTS']::"Permission"[];

-- Les notifications commerciales renvoient vers des pages qui n'existent
-- plus : elles sont supprimées plutôt que réétiquetées.
DELETE FROM "Notification" WHERE "type" <> 'DOCUMENT_ADDED';

-- AlterEnum
BEGIN;
CREATE TYPE "AccessCategory_new" AS ENUM ('OUVRIER', 'SECRETAIRE');
ALTER TABLE "public"."UserCrmAccess" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "UserCrmAccess" ALTER COLUMN "category" TYPE "AccessCategory_new" USING ("category"::text::"AccessCategory_new");
ALTER TYPE "AccessCategory" RENAME TO "AccessCategory_old";
ALTER TYPE "AccessCategory_new" RENAME TO "AccessCategory";
DROP TYPE "public"."AccessCategory_old";
ALTER TABLE "UserCrmAccess" ALTER COLUMN "category" SET DEFAULT 'OUVRIER';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('DOCUMENT_ADDED');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "Permission_new" AS ENUM ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT', 'MANAGE_SETTINGS', 'MANAGE_USERS');
ALTER TABLE "UserCrmAccess" ALTER COLUMN "permissions" TYPE "Permission_new"[] USING ("permissions"::text::"Permission_new"[]);
ALTER TYPE "Permission" RENAME TO "Permission_old";
ALTER TYPE "Permission_new" RENAME TO "Permission";
DROP TYPE "public"."Permission_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "AppointmentParticipant" DROP CONSTRAINT "AppointmentParticipant_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "AppointmentParticipant" DROP CONSTRAINT "AppointmentParticipant_userId_fkey";

-- DropForeignKey
ALTER TABLE "AutomationAction" DROP CONSTRAINT "AutomationAction_ruleId_fkey";

-- DropForeignKey
ALTER TABLE "AutomationRule" DROP CONSTRAINT "AutomationRule_crmId_fkey";

-- DropForeignKey
ALTER TABLE "AvailabilityException" DROP CONSTRAINT "AvailabilityException_crmId_fkey";

-- DropForeignKey
ALTER TABLE "AvailabilityException" DROP CONSTRAINT "AvailabilityException_userId_fkey";

-- DropForeignKey
ALTER TABLE "AvailabilityRule" DROP CONSTRAINT "AvailabilityRule_crmId_fkey";

-- DropForeignKey
ALTER TABLE "AvailabilityRule" DROP CONSTRAINT "AvailabilityRule_userId_fkey";

-- DropForeignKey
ALTER TABLE "BookingSettings" DROP CONSTRAINT "BookingSettings_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_convertedFromId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "ClientCollaborator" DROP CONSTRAINT "ClientCollaborator_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientCollaborator" DROP CONSTRAINT "ClientCollaborator_userId_fkey";

-- DropForeignKey
ALTER TABLE "ClientContact" DROP CONSTRAINT "ClientContact_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientTag" DROP CONSTRAINT "ClientTag_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientTag" DROP CONSTRAINT "ClientTag_tagId_fkey";

-- DropForeignKey
ALTER TABLE "CommercialObjective" DROP CONSTRAINT "CommercialObjective_crmId_fkey";

-- DropForeignKey
ALTER TABLE "CommercialObjective" DROP CONSTRAINT "CommercialObjective_userId_fkey";

-- DropForeignKey
ALTER TABLE "CustomFieldDefinition" DROP CONSTRAINT "CustomFieldDefinition_crmId_fkey";

-- DropForeignKey
ALTER TABLE "CustomFieldValue" DROP CONSTRAINT "CustomFieldValue_crmId_fkey";

-- DropForeignKey
ALTER TABLE "CustomFieldValue" DROP CONSTRAINT "CustomFieldValue_definitionId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "EmailTemplate" DROP CONSTRAINT "EmailTemplate_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_threadId_fkey";

-- DropForeignKey
ALTER TABLE "MessageAttachment" DROP CONSTRAINT "MessageAttachment_documentId_fkey";

-- DropForeignKey
ALTER TABLE "MessageAttachment" DROP CONSTRAINT "MessageAttachment_messageId_fkey";

-- DropForeignKey
ALTER TABLE "MessageThread" DROP CONSTRAINT "MessageThread_createdById_fkey";

-- DropForeignKey
ALTER TABLE "MessageThread" DROP CONSTRAINT "MessageThread_crmId_fkey";

-- DropForeignKey
ALTER TABLE "MessageThreadParticipant" DROP CONSTRAINT "MessageThreadParticipant_threadId_fkey";

-- DropForeignKey
ALTER TABLE "MessageThreadParticipant" DROP CONSTRAINT "MessageThreadParticipant_userId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_stageId_fkey";

-- DropForeignKey
ALTER TABLE "OpportunityHistory" DROP CONSTRAINT "OpportunityHistory_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "PipelineStage" DROP CONSTRAINT "PipelineStage_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Prospect" DROP CONSTRAINT "Prospect_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Prospect" DROP CONSTRAINT "Prospect_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Prospect" DROP CONSTRAINT "Prospect_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "ProspectContact" DROP CONSTRAINT "ProspectContact_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "ProspectTag" DROP CONSTRAINT "ProspectTag_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "ProspectTag" DROP CONSTRAINT "ProspectTag_tagId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteCounter" DROP CONSTRAINT "QuoteCounter_crmId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteItem" DROP CONSTRAINT "QuoteItem_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteItem" DROP CONSTRAINT "QuoteItem_vatRateId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteTemplate" DROP CONSTRAINT "QuoteTemplate_crmId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteVersion" DROP CONSTRAINT "QuoteVersion_authorId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteVersion" DROP CONSTRAINT "QuoteVersion_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "Source" DROP CONSTRAINT "Source_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assigneeId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_crmId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "UserTag" DROP CONSTRAINT "UserTag_tagId_fkey";

-- DropForeignKey
ALTER TABLE "UserTag" DROP CONSTRAINT "UserTag_userId_fkey";

-- DropForeignKey
ALTER TABLE "VatRate" DROP CONSTRAINT "VatRate_crmId_fkey";

-- AlterTable
ALTER TABLE "ActivityLog" DROP COLUMN "appointmentId",
DROP COLUMN "clientId",
DROP COLUMN "prospectId",
DROP COLUMN "quoteId";

-- AlterTable
ALTER TABLE "UserCrmAccess" ALTER COLUMN "category" SET DEFAULT 'OUVRIER';

-- DropTable
DROP TABLE "Appointment";

-- DropTable
DROP TABLE "AppointmentParticipant";

-- DropTable
DROP TABLE "AutomationAction";

-- DropTable
DROP TABLE "AutomationRule";

-- DropTable
DROP TABLE "AvailabilityException";

-- DropTable
DROP TABLE "AvailabilityRule";

-- DropTable
DROP TABLE "BookingSettings";

-- DropTable
DROP TABLE "Client";

-- DropTable
DROP TABLE "ClientCollaborator";

-- DropTable
DROP TABLE "ClientContact";

-- DropTable
DROP TABLE "ClientTag";

-- DropTable
DROP TABLE "CommercialObjective";

-- DropTable
DROP TABLE "CustomFieldDefinition";

-- DropTable
DROP TABLE "CustomFieldValue";

-- DropTable
DROP TABLE "Document";

-- DropTable
DROP TABLE "EmailTemplate";

-- DropTable
DROP TABLE "Message";

-- DropTable
DROP TABLE "MessageAttachment";

-- DropTable
DROP TABLE "MessageThread";

-- DropTable
DROP TABLE "MessageThreadParticipant";

-- DropTable
DROP TABLE "Opportunity";

-- DropTable
DROP TABLE "OpportunityHistory";

-- DropTable
DROP TABLE "PipelineStage";

-- DropTable
DROP TABLE "Prospect";

-- DropTable
DROP TABLE "ProspectContact";

-- DropTable
DROP TABLE "ProspectTag";

-- DropTable
DROP TABLE "Quote";

-- DropTable
DROP TABLE "QuoteCounter";

-- DropTable
DROP TABLE "QuoteItem";

-- DropTable
DROP TABLE "QuoteTemplate";

-- DropTable
DROP TABLE "QuoteVersion";

-- DropTable
DROP TABLE "Source";

-- DropTable
DROP TABLE "Tag";

-- DropTable
DROP TABLE "Task";

-- DropTable
DROP TABLE "UserTag";

-- DropTable
DROP TABLE "VatRate";

-- DropEnum
DROP TYPE "AppointmentStatus";

-- DropEnum
DROP TYPE "AutomationActionType";

-- DropEnum
DROP TYPE "AutomationTrigger";

-- DropEnum
DROP TYPE "AvailabilityExceptionType";

-- DropEnum
DROP TYPE "ClientStatus";

-- DropEnum
DROP TYPE "CustomFieldEntity";

-- DropEnum
DROP TYPE "CustomFieldType";

-- DropEnum
DROP TYPE "DocumentEntity";

-- DropEnum
DROP TYPE "ObjectivePeriod";

-- DropEnum
DROP TYPE "ProspectStatus";

-- DropEnum
DROP TYPE "QuoteStatus";

-- DropEnum
DROP TYPE "TagScope";

-- DropEnum
DROP TYPE "TaskPriority";

-- DropEnum
DROP TYPE "TaskStatus";

-- DropEnum
DROP TYPE "ThreadType";

