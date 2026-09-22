import ExcelJS from "exceljs";
import type { ApiTestCase } from "../types/index.js";

function safeCell(value: unknown): string | number {
  if (typeof value === "number") return value;
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function createExcel(testCases: ApiTestCase[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Swagger API Testcase Generator";
  const sheet = workbook.addWorksheet("API Testcases", {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  sheet.columns = [
    { header: "Test Case ID", key: "testCaseId", width: 16 },
    { header: "Operation ID", key: "operationId", width: 22 },
    { header: "Endpoint", key: "endpoint", width: 30 },
    { header: "HTTP Method", key: "method", width: 14 },
    { header: "Category", key: "category", width: 18 },
    { header: "Title", key: "title", width: 42 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Preconditions", key: "preconditions", width: 42 },
    { header: "Headers", key: "headers", width: 32 },
    { header: "Path Parameters", key: "pathParameters", width: 28 },
    { header: "Query Parameters", key: "queryParameters", width: 28 },
    { header: "Request Body", key: "requestBody", width: 36 },
    { header: "Steps", key: "steps", width: 52 },
    { header: "Expected Status Code", key: "expectedStatusCode", width: 20 },
    { header: "Expected Result", key: "expectedResult", width: 48 },
    { header: "Source Reference", key: "sourceReferences", width: 38 }
  ];

  for (const testCase of testCases) {
    sheet.addRow({
      ...testCase,
      operationId: safeCell(testCase.operationId ?? ""),
      title: safeCell(testCase.title),
      preconditions: safeCell(testCase.preconditions.join("\n")),
      headers: safeCell(testCase.headers),
      pathParameters: safeCell(testCase.pathParameters),
      queryParameters: safeCell(testCase.queryParameters),
      requestBody: safeCell(testCase.requestBody ?? ""),
      steps: safeCell(testCase.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")),
      expectedResult: safeCell(testCase.expectedResult),
      sourceReferences: safeCell(testCase.sourceReferences.join("\n"))
    });
  }

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 24;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1FBF4" } };
      }
    }
  });
  sheet.autoFilter = { from: "A1", to: "P1" };

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
