import type { ApiTestCase } from "../types";

function toJavaIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const safe = cleaned && /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
  return safe || fallback;
}

function toCamelCase(title: string): string {
  const words = title.match(/[a-zA-Z0-9]+/g) ?? [];
  if (words.length === 0) return "executesScenario";
  const [first, ...rest] = words;
  return [first.toLowerCase(), ...rest.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())].join("");
}

function javaStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function formatBody(requestBody: unknown): string {
  const json = JSON.stringify(requestBody, null, 2);
  if (!json.includes('"""')) {
    const indented = json.split("\n").map((line) => `                        ${line}`).join("\n");
    return `.body("""\n${indented}\n                        """)`;
  }
  return `.body(${javaStringLiteral(json)})`;
}

function commentBlock(lines: string[], indent = "    "): string {
  return lines.map((line) => `${indent}// ${line}`).join("\n");
}

function javaValueLiteral(value: unknown): string {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : javaStringLiteral(String(value));
}

export function generateRestAssuredCode(testCase: ApiTestCase, baseUrl: string): string {
  const className = toJavaIdentifier(`${testCase.testCaseId}_Test`, "GeneratedTestCase_Test");
  const methodName = toCamelCase(testCase.title);
  const method = testCase.method.toLowerCase();

  const headerEntries = Object.entries(testCase.headers ?? {});
  const pathParamEntries = Object.entries(testCase.pathParameters ?? {});
  const queryParamEntries = Object.entries(testCase.queryParameters ?? {});

  const givenLines = [
    ...headerEntries.map(([key, value]) => `                .header(${javaStringLiteral(key)}, ${javaValueLiteral(value)})`),
    ...pathParamEntries.map(([key, value]) => `                .pathParam(${javaStringLiteral(key)}, ${javaValueLiteral(value)})`),
    ...queryParamEntries.map(([key, value]) => `                .queryParam(${javaStringLiteral(key)}, ${javaValueLiteral(value)})`),
    ...(testCase.requestBody !== undefined ? [`                ${formatBody(testCase.requestBody)}`] : [])
  ];

  const precondLines = testCase.preconditions.length
    ? [`    // Preconditions:`, ...testCase.preconditions.map((p) => `    //   - ${p}`)]
    : [];
  const stepLines = testCase.steps.length
    ? [`    // Steps:`, ...testCase.steps.map((s, i) => `    //   ${i + 1}. ${s}`)]
    : [];

  return [
    "import io.restassured.RestAssured;",
    "import io.restassured.response.Response;",
    "import org.junit.jupiter.api.Test;",
    "",
    "import static io.restassured.RestAssured.given;",
    "import static org.hamcrest.Matchers.*;",
    "",
    `public class ${className} {`,
    "",
    ...(precondLines.length ? [precondLines.join("\n")] : []),
    ...(stepLines.length ? [stepLines.join("\n")] : []),
    "    @Test",
    `    public void ${methodName}() {`,
    `        RestAssured.baseURI = ${javaStringLiteral(baseUrl)};`,
    "",
    "        Response response = given()",
    ...givenLines,
    "            .when()",
    `                .${method}(${javaStringLiteral(testCase.endpoint)})`,
    "            .then()",
    `                .statusCode(${testCase.expectedStatusCode})`,
    "                .extract().response();",
    "",
    commentBlock([`Expected: ${testCase.expectedResult}`], "        "),
    "    }",
    "}"
  ].join("\n");
}
