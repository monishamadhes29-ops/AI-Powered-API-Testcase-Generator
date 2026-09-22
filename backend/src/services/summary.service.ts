import type { ProcessingSession } from "../types/index.js";
import { getSpecificationSummary } from "./swagger.service.js";
import { summarizeTestCases } from "./testcase.service.js";

export function createSessionSummary(session: ProcessingSession) {
  return {
    sessionId: session.sessionId,
    swaggerSummary: getSpecificationSummary(session.activeSpecification),
    validationSummary: {
      isValid: session.validationReport?.isValid ?? false,
      originalErrors: session.validationReport?.errorCount ?? 0,
      warnings: session.validationReport?.warningCount ?? 0,
      correctionStatus: session.correctionReport?.correctionStatus ?? "not-run",
      correctedChanges: session.correctionReport?.changes.length ?? 0,
      remainingErrors: session.correctionReport?.remainingErrors.length ?? session.validationReport?.errorCount ?? 0
    },
    testcaseSummary: summarizeTestCases(session.testCases),
    generationSource: session.generationSource ?? "not-generated",
    postmanCollectionGenerated: Boolean(session.postmanCollection)
  };
}
