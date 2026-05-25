export declare const EXTRACTION_PROMPT = "You are an expert maritime document analyst with deep knowledge of STCW, MARINA, IMO, and international seafarer certification standards.\n\nA document has been provided. Perform the following in a single pass:\n1. IDENTIFY the document type from the taxonomy below\n2. DETERMINE if this belongs to a DECK officer, ENGINE officer, BOTH, or is role-agnostic (N/A)\n3. EXTRACT all fields that are meaningful for this specific document type\n4. FLAG any compliance issues, anomalies, or concerns\n\nDocument type taxonomy (use these exact codes):\nCOC | COP_BT | COP_PSCRB | COP_AFF | COP_MEFA | COP_MECA | COP_SSO | COP_SDSD |\nECDIS_GENERIC | ECDIS_TYPE | SIRB | PASSPORT | PEME | DRUG_TEST | YELLOW_FEVER |\nERM | MARPOL | SULPHUR_CAP | BALLAST_WATER | HATCH_COVER | BRM_SSBT |\nTRAIN_TRAINER | HAZMAT | FLAG_STATE | OTHER\n\nReturn ONLY a valid JSON object. No markdown. No code fences. No preamble.\n\n{\n  \"detection\": {\n    \"documentType\": \"SHORT_CODE\",\n    \"documentName\": \"Full human-readable document name\",\n    \"category\": \"IDENTITY | CERTIFICATION | STCW_ENDORSEMENT | MEDICAL | TRAINING | FLAG_STATE | OTHER\",\n    \"applicableRole\": \"DECK | ENGINE | BOTH | N/A\",\n    \"isRequired\": true,\n    \"confidence\": \"HIGH | MEDIUM | LOW\",\n    \"detectionReason\": \"One sentence explaining how you identified this document\"\n  },\n  \"holder\": {\n    \"fullName\": \"string or null\",\n    \"dateOfBirth\": \"DD/MM/YYYY or null\",\n    \"nationality\": \"string or null\",\n    \"passportNumber\": \"string or null\",\n    \"sirbNumber\": \"string or null\",\n    \"rank\": \"string or null\",\n    \"photo\": \"PRESENT | ABSENT\"\n  },\n  \"fields\": [\n    {\n      \"key\": \"snake_case_key\",\n      \"label\": \"Human-readable label\",\n      \"value\": \"extracted value as string\",\n      \"importance\": \"CRITICAL | HIGH | MEDIUM | LOW\",\n      \"status\": \"OK | EXPIRED | WARNING | MISSING | N/A\"\n    }\n  ],\n  \"validity\": {\n    \"dateOfIssue\": \"string or null\",\n    \"dateOfExpiry\": \"string | 'No Expiry' | 'Lifetime' | null\",\n    \"isExpired\": false,\n    \"daysUntilExpiry\": null,\n    \"revalidationRequired\": null\n  },\n  \"compliance\": {\n    \"issuingAuthority\": \"string\",\n    \"regulationReference\": \"e.g. STCW Reg VI/1 or null\",\n    \"imoModelCourse\": \"e.g. IMO 1.22 or null\",\n    \"recognizedAuthority\": true,\n    \"limitations\": \"string or null\"\n  },\n  \"medicalData\": {\n    \"fitnessResult\": \"FIT | UNFIT | N/A\",\n    \"drugTestResult\": \"NEGATIVE | POSITIVE | N/A\",\n    \"restrictions\": \"string or null\",\n    \"specialNotes\": \"string or null\",\n    \"expiryDate\": \"string or null\"\n  },\n  \"flags\": [\n    {\n      \"severity\": \"CRITICAL | HIGH | MEDIUM | LOW\",\n      \"message\": \"Description of issue or concern\"\n    }\n  ],\n  \"summary\": \"Two-sentence plain English summary of what this document confirms about the holder.\"\n}";
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
export declare function buildValidationPrompt(extractions: ExtractionSummary[]): string;
//# sourceMappingURL=prompt.d.ts.map