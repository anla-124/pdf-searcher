// Document AI processor configuration

export const PROCESSOR_TYPES = {
  FORM_PARSER: 'form_parser',
  DOCUMENT_OCR: 'ocr',
} as const;

export type ProcessorType = typeof PROCESSOR_TYPES[keyof typeof PROCESSOR_TYPES];

export function getProcessorId(type?: ProcessorType): string {
  // If no type specified, use the primary processor
  if (!type) {
    return process.env['GOOGLE_CLOUD_PROCESSOR_ID']!;
  }

  // Use specific processor based on type
  switch (type) {
    case PROCESSOR_TYPES.FORM_PARSER:
      return process.env['GOOGLE_CLOUD_FORM_PARSER_ID'] || process.env['GOOGLE_CLOUD_PROCESSOR_ID']!;
    case PROCESSOR_TYPES.DOCUMENT_OCR:
      return process.env['GOOGLE_CLOUD_OCR_PROCESSOR_ID'] || process.env['GOOGLE_CLOUD_PROCESSOR_ID']!;
    default:
      return process.env['GOOGLE_CLOUD_PROCESSOR_ID']!;
  }
}

export function getProcessorName(processorId: string): string {
  return `projects/${process.env['GOOGLE_CLOUD_PROJECT_ID']}/locations/${process.env['GOOGLE_CLOUD_LOCATION']}/processors/${processorId}`;
}

// Current strategy: rely exclusively on the OCR/Document Layout processor to
// capture full text for similarity search. Form Parser is kept available for
// future use but not selected automatically.
export function detectOptimalProcessor(filename: string, fileSize: number): ProcessorType {
  console.log(`Using OCR processor for document: ${filename} (${fileSize} bytes)`)
  return PROCESSOR_TYPES.DOCUMENT_OCR
}
