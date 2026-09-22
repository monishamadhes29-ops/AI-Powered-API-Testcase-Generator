export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type ValidationReport = {
  isValid: boolean;
  openApiVersion?: string;
  errorCount: number;
  warningCount: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type CorrectionChange = {
  path: string;
  issue: string;
  correction: string;
  confidence: number;
};

export type CorrectionReport = {
  correctionStatus: string;
  source: string;
  isCorrectedSpecificationValid: boolean;
  changes: CorrectionChange[];
  remainingErrors: ValidationIssue[];
};

export type ApiTestCase = {
  testCaseId: string;
  operationId?: string;
  endpoint: string;
  method: string;
  category: string;
  title: string;
  priority: "High" | "Medium" | "Low";
  preconditions: string[];
  headers: Record<string, unknown>;
  pathParameters: Record<string, unknown>;
  queryParameters: Record<string, unknown>;
  requestBody?: unknown;
  steps: string[];
  expectedStatusCode: number;
  expectedResult: string;
  sourceReferences: string[];
};

export type TestcaseSummary = Record<string, number> & { totalTestCases: number };

export type GenerationInfo = {
  generationSource: string;
  generationModel?: string;
};
