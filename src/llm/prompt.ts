// ---------------------------------------------------------------------------
// EXTRACTION PROMPT — multi-document aware
// ---------------------------------------------------------------------------

export const EXTRACTION_PROMPT = `You are an expert maritime document analyst with deep knowledge of STCW, MARINA, IMO, and international seafarer certification standards.

A document file has been provided. It may contain ONE or MULTIPLE maritime certificates/documents within the same file.

Perform the following in a single pass:
1. IDENTIFY every distinct document or certificate present in the file
2. For EACH document found, DETERMINE if it belongs to a DECK officer, ENGINE officer, BOTH, or is role-agnostic (N/A)
3. EXTRACT all fields meaningful for each specific document type
4. FLAG any compliance issues, anomalies, or concerns per document

Document type taxonomy (use these exact codes):
COC | COP_BT | COP_PSCRB | COP_AFF | COP_MEFA | COP_MECA | COP_SSO | COP_SDSD |
ECDIS_GENERIC | ECDIS_TYPE | SIRB | PASSPORT | PEME | DRUG_TEST | YELLOW_FEVER |
ERM | MARPOL | SULPHUR_CAP | BALLAST_WATER | HATCH_COVER | BRM_SSBT |
TRAIN_TRAINER | HAZMAT | FLAG_STATE | OTHER

Return ONLY a valid JSON array — one object per document found. No markdown. No code fences. No preamble.

[{"detection":{"documentType":"SHORT_CODE","documentName":"Full name","category":"IDENTITY|CERTIFICATION|STCW_ENDORSEMENT|MEDICAL|TRAINING|FLAG_STATE|OTHER","applicableRole":"DECK|ENGINE|BOTH|N/A","isRequired":true,"confidence":"HIGH|MEDIUM|LOW","detectionReason":"One sentence"},"holder":{"fullName":"string or null","dateOfBirth":"DD/MM/YYYY or null","nationality":"string or null","passportNumber":"string or null","sirbNumber":"string or null","rank":"string or null","photo":"PRESENT|ABSENT"},"fields":[{"key":"snake_case_key","label":"Human label","value":"extracted value","importance":"CRITICAL|HIGH|MEDIUM|LOW","status":"OK|EXPIRED|WARNING|MISSING|N/A"}],"validity":{"dateOfIssue":"string or null","dateOfExpiry":"string or null","isExpired":false,"daysUntilExpiry":null,"revalidationRequired":null},"compliance":{"issuingAuthority":"string","regulationReference":"string or null","imoModelCourse":"string or null","recognizedAuthority":true,"limitations":"string or null"},"medicalData":{"fitnessResult":"FIT|UNFIT|N/A","drugTestResult":"NEGATIVE|POSITIVE|N/A","restrictions":"string or null","specialNotes":"string or null","expiryDate":"string or null"},"flags":[{"severity":"CRITICAL|HIGH|MEDIUM|LOW","message":"string"}],"summary":"Two-sentence summary."}]

RULES: Always return a JSON ARRAY. Extract EVERY certificate in the file. One array entry per certificate.`;

// ---------------------------------------------------------------------------
// VALIDATION PROMPT
// ---------------------------------------------------------------------------

export interface ExtractionSummary {
  id: string;
  documentType: string | null;
  documentName: string | null;
  applicableRole: string | null;
  holderName: string | null;
  dateOfBirth: string | null;
  sirbNumber: string | null;
  passportNumber: string | null;
  validity: unknown;
  compliance: unknown;
  medicalData: unknown;
  flags: unknown;
  isExpired: boolean | null;
  summary: string | null;
}

export function buildValidationPrompt(
  extractionSummaries: ExtractionSummary[],
): string {
  const docsJson = JSON.stringify(extractionSummaries);

  return `You are a maritime compliance officer. Analyze these ${extractionSummaries.length} extracted certificate records and return a compliance assessment as a single JSON object.

RECORDS:
${docsJson}

Instructions:
- Derive the holder's full name, DOB, nationality, SIRB, passport, rank, and role (DECK/ENGINE/BOTH/N/A) from the records
- Check if name, DOB, SIRB number, and passport number are consistent across all documents
- Identify any expired documents (isExpired=true)
- Check medical fitness from PEME and drug test records
- Overall status: APPROVED if no critical issues, CONDITIONAL if minor issues, REJECTED if expired required cert or critical flag
- Score: start 100, subtract 25 per CRITICAL issue, 15 per HIGH, 5 per MEDIUM, 2 per LOW

You MUST return ONLY the following JSON object with NO other text, NO markdown, NO explanation:

{
  "holderProfile": {
    "fullName": "string",
    "dateOfBirth": "string or null",
    "nationality": "string or null",
    "sirbNumber": "string or null",
    "passportNumber": "string or null",
    "rank": "string or null",
    "detectedRole": "DECK or ENGINE or BOTH or N/A"
  },
  "consistencyChecks": [
    {"field": "fullName", "status": "CONSISTENT or INCONSISTENT or INSUFFICIENT_DATA", "values": ["value"], "note": null}
  ],
  "missingDocuments": [],
  "expiringDocuments": [],
  "medicalFlags": [],
  "overallStatus": "APPROVED or CONDITIONAL or REJECTED",
  "overallScore": 100,
  "summary": "Plain English summary of compliance status.",
  "recommendations": ["string"]
}`;
}