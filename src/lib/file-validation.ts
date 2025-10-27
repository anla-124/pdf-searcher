interface ValidationResult {
  isValid: boolean
  issues: string[]
  warnings: string[]
  fileInfo: {
    size: number
    sizeFormatted: string
    type: string
    isPasswordProtected?: boolean
  }
}


export class FileValidator {
  private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
  private static readonly MIN_FILE_SIZE = 1024 // 1KB
  private static readonly ALLOWED_TYPES = ['application/pdf']
  
  static async validateFile(file: File): Promise<ValidationResult> {
    const issues: string[] = []
    const warnings: string[] = []
    
    // Basic file validation
    if (!this.ALLOWED_TYPES.includes(file.type)) {
      issues.push('Only PDF files are supported')
    }
    
    if (file.size > this.MAX_FILE_SIZE) {
      issues.push(`File size exceeds ${this.formatFileSize(this.MAX_FILE_SIZE)} limit`)
    }
    
    if (file.size < this.MIN_FILE_SIZE) {
      issues.push('File appears to be empty or corrupted')
    }
    
    // Check filename
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      warnings.push('File extension should be .pdf')
    }
    
    if (file.name.length > 255) {
      warnings.push('Filename is very long and may cause issues')
    }
    
    // Simplified validation - skip expensive PDF content analysis
    let isPasswordProtected = false
    
    // Quick password protection check using basic PDF header analysis
    try {
      const buffer = await file.arrayBuffer()
      const header = new Uint8Array(buffer.slice(0, 1024))
      const headerString = new TextDecoder().decode(header)
      
      // Conservative PDF encryption detection
      const encryptMatch = headerString.match(/\/Encrypt\s+\d+\s+\d+\s+R/)
      const hasUserPassword = headerString.includes('/U ') || headerString.includes('/UE ')
      const hasOwnerPassword = headerString.includes('/O ') || headerString.includes('/OE ')
      
      // Only flag as encrypted if we have both an encrypt reference AND password fields
      isPasswordProtected = encryptMatch !== null && (hasUserPassword || hasOwnerPassword)
      
      if (isPasswordProtected) {
        issues.push('Password-protected PDFs are not currently supported')
      }
    } catch {
      warnings.push('Could not analyze file - proceeding with upload')
    }
    
    // Add size-based warnings without detailed analysis
    if (file.size > 10 * 1024 * 1024) { // > 10MB
      warnings.push('Large file - processing may take several minutes')
    }
    
    const fileInfo = {
      size: file.size,
      sizeFormatted: this.formatFileSize(file.size),
      type: file.type,
      isPasswordProtected
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      fileInfo
    }
  }
  
  private static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }
  
  static getValidationRules() {
    return {
      maxFileSize: this.MAX_FILE_SIZE,
      minFileSize: this.MIN_FILE_SIZE,
      allowedTypes: this.ALLOWED_TYPES,
      maxFileSizeFormatted: this.formatFileSize(this.MAX_FILE_SIZE)
    }
  }
}

// Real-time file validation hook for React components
export const useFileValidation = () => {
  const validateFiles = async (files: FileList | File[]): Promise<Map<string, ValidationResult>> => {
    const results = new Map<string, ValidationResult>()
    const fileArray = Array.from(files)
    
    // Validate files in parallel
    const validationPromises = fileArray.map(async (file) => {
      const result = await FileValidator.validateFile(file)
      return { file, result }
    })
    
    const validationResults = await Promise.all(validationPromises)
    
    validationResults.forEach(({ file, result }) => {
      results.set(file.name, result)
    })
    
    return results
  }
  
  const getValidationSummary = (results: Map<string, ValidationResult>) => {
    const total = results.size
    const valid = Array.from(results.values()).filter(r => r.isValid).length
    const invalid = total - valid
    const totalWarnings = Array.from(results.values()).reduce((sum, r) => sum + r.warnings.length, 0)
    const totalIssues = Array.from(results.values()).reduce((sum, r) => sum + r.issues.length, 0)
    
    return {
      total,
      valid,
      invalid,
      totalWarnings,
      totalIssues,
      canProceed: invalid === 0
    }
  }
  
  return {
    validateFiles,
    getValidationSummary,
    rules: FileValidator.getValidationRules()
  }
}
