/**
 * Validation Helper Utilities
 * Reusable validation functions with consistent error handling
 */

import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_FILE_TYPES,
  ALLOWED_FILE_EXTENSIONS,
  ERROR_CODES,
} from '@/lib/constants'
import { validationError } from './api-response'

// =============================================================================
// FILE VALIDATION
// =============================================================================

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  error?: string
  errorCode?: string
}

/**
 * Validate file type
 *
 * @param file - File to validate
 * @returns Validation result
 */
export function validateFileType(file: File): ValidationResult {
  if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(file.type)) {
    return {
      isValid: false,
      error: `Invalid file type. Only ${ALLOWED_FILE_TYPES.join(', ')} files are allowed`,
      errorCode: ERROR_CODES.INVALID_FILE_TYPE,
    }
  }

  // Also check file extension for extra safety
  const extension = `.${file.name.split('.').pop()?.toLowerCase()}`
  if (!(ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      isValid: false,
      error: `Invalid file extension. Only ${ALLOWED_FILE_EXTENSIONS.join(', ')} files are allowed`,
      errorCode: ERROR_CODES.INVALID_FILE_TYPE,
    }
  }

  return { isValid: true }
}

/**
 * Validate file size
 *
 * @param file - File to validate
 * @returns Validation result
 */
export function validateFileSize(file: File): ValidationResult {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      errorCode: ERROR_CODES.FILE_TOO_LARGE,
    }
  }

  return { isValid: true }
}

/**
 * Validate file completely (type and size)
 *
 * @param file - File to validate
 * @returns Validation result
 */
export function validateFile(file: File): ValidationResult {
  // Check type first
  const typeValidation = validateFileType(file)
  if (!typeValidation.isValid) {
    return typeValidation
  }

  // Check size
  const sizeValidation = validateFileSize(file)
  if (!sizeValidation.isValid) {
    return sizeValidation
  }

  return { isValid: true }
}

/**
 * Validate file from form data and return error response if invalid
 *
 * @param formData - Form data containing the file
 * @param fileFieldName - Name of the file field (default: 'file')
 * @returns File if valid, or error response
 *
 * @example
 * const fileOrError = await validateFileFromFormData(formData)
 * if (fileOrError instanceof NextResponse) return fileOrError
 * const file = fileOrError
 */
export async function validateFileFromFormData(
  formData: FormData,
  fileFieldName: string = 'file'
): Promise<File | ReturnType<typeof validationError>> {
  const file = formData.get(fileFieldName)

  if (!file) {
    return validationError(`No ${fileFieldName} provided`)
  }

  if (!(file instanceof File)) {
    return validationError(`Invalid ${fileFieldName} format`)
  }

  // Validate the file
  const validation = validateFile(file)
  if (!validation.isValid) {
    return validationError(validation.error!, validation.error)
  }

  return file
}

// =============================================================================
// PARAMETER VALIDATION
// =============================================================================

/**
 * Validate required string parameter
 *
 * @param value - Value to validate
 * @param fieldName - Name of the field
 * @returns Validation result
 */
export function validateRequired(value: unknown, fieldName: string): ValidationResult {
  if (value === undefined || value === null || value === '') {
    return {
      isValid: false,
      error: `${fieldName} is required`,
      errorCode: ERROR_CODES.VALIDATION_ERROR,
    }
  }

  return { isValid: true }
}

/**
 * Validate string length
 *
 * @param value - Value to validate
 * @param fieldName - Name of the field
 * @param min - Minimum length
 * @param max - Maximum length
 * @returns Validation result
 */
export function validateStringLength(
  value: string,
  fieldName: string,
  min?: number,
  max?: number
): ValidationResult {
  if (min !== undefined && value.length < min) {
    return {
      isValid: false,
      error: `${fieldName} must be at least ${min} characters`,
      errorCode: ERROR_CODES.VALIDATION_ERROR,
    }
  }

  if (max !== undefined && value.length > max) {
    return {
      isValid: false,
      error: `${fieldName} must be at most ${max} characters`,
      errorCode: ERROR_CODES.VALIDATION_ERROR,
    }
  }

  return { isValid: true }
}

/**
 * Validate UUID format
 *
 * @param value - Value to validate
 * @param fieldName - Name of the field
 * @returns Validation result
 */
export function validateUUID(value: string, fieldName: string): ValidationResult {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!uuidRegex.test(value)) {
    return {
      isValid: false,
      error: `${fieldName} must be a valid UUID`,
      errorCode: ERROR_CODES.VALIDATION_ERROR,
    }
  }

  return { isValid: true }
}

/**
 * Validate number range
 *
 * @param value - Value to validate
 * @param fieldName - Name of the field
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Validation result
 */
export function validateNumberRange(
  value: number,
  fieldName: string,
  min?: number,
  max?: number
): ValidationResult {
  if (min !== undefined && value < min) {
    return {
      isValid: false,
      error: `${fieldName} must be at least ${min}`,
      errorCode: ERROR_CODES.VALIDATION_ERROR,
    }
  }

  if (max !== undefined && value > max) {
    return {
      isValid: false,
      error: `${fieldName} must be at most ${max}`,
      errorCode: ERROR_CODES.VALIDATION_ERROR,
    }
  }

  return { isValid: true }
}

// =============================================================================
// COMPOSITE VALIDATORS
// =============================================================================

/**
 * Run multiple validations and return the first error
 *
 * @param validations - Array of validation results
 * @returns First error or success
 */
export function combineValidations(...validations: ValidationResult[]): ValidationResult {
  for (const validation of validations) {
    if (!validation.isValid) {
      return validation
    }
  }

  return { isValid: true }
}
