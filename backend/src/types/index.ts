export type JsonObject = Record<string, unknown>;

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
  correctionStatus: "not-required" | "completed" | "partial" | "failed";
  source: "deterministic" | "groq" | "deterministic+groq";
  isCorrectedSpecificationValid: boolean;
  changes: CorrectionChange[];
  remainingErrors: ValidationIssue[];
};

export type TestCaseCategory =
  | "positive"
  | "negative"
  | "boundary"
  | "authentication"
  | "authorization"
  | "validation"
  | "error-handling";

export type ApiTestCase = {
  testCaseId: string;
  operationId?: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
  category: TestCaseCategory;
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

export type ProcessingSession = {
  sessionId: string;
  originalFileName: string;
  inputFormat: "yaml" | "json";
  originalSpecification: JsonObject;
  activeSpecification: JsonObject;
  correctedSpecification?: JsonObject;
  validationReport?: ValidationReport;
  correctionReport?: CorrectionReport;
  testGenerationConfirmed: boolean;
  testCases: ApiTestCase[];
  generationSource?: "deterministic" | "groq" | "deterministic+groq";
  generationModel?: string;
  postmanCollection?: JsonObject;
  createdAt: Date;
  expiresAt: Date;
};
