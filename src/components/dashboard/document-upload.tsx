'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, FileText, Loader2, Building, Users, Briefcase, Globe, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { useFileValidation } from '@/lib/file-validation'
import { 
  LAW_FIRM_OPTIONS, 
  FUND_MANAGER_OPTIONS, 
  FUND_ADMIN_OPTIONS, 
  JURISDICTION_OPTIONS,
  DEFAULT_METADATA,
  type LawFirmOption,
  type FundManagerOption,
  type FundAdminOption,
  type JurisdictionOption
} from '@/lib/metadata-constants'

interface DocumentMetadata {
  law_firm: LawFirmOption | ''
  fund_manager: FundManagerOption | ''
  fund_admin: FundAdminOption | ''
  jurisdiction: JurisdictionOption | ''
  subscription_agreement_skipped: boolean
  subscription_agreement_start_page: number | null
  subscription_agreement_end_page: number | null
}

interface TouchedFields {
  law_firm: boolean
  fund_manager: boolean
  fund_admin: boolean
  jurisdiction: boolean
  subscription_agreement_skipped: boolean
  subscription_agreement_start_page: boolean
  subscription_agreement_end_page: boolean
}

interface UploadFile {
  file: File
  id: string
  progress: number
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'validating'
  error?: string
  metadata: DocumentMetadata
  touchedFields: TouchedFields
  validation?: {
    isValid: boolean
    issues: string[]
    warnings: string[]
    fileInfo: {
      sizeFormatted: string
      [key: string]: unknown
    }
  }
}

interface DocumentUploadProps {
  onUploadComplete?: () => void
}

interface ValidationSummary {
  total: number
  valid: number
  invalid: number
  totalWarnings: number
  totalIssues: number
  canProceed: boolean
}

export function DocumentUpload({ onUploadComplete }: DocumentUploadProps) {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { validateFiles, getValidationSummary } = useFileValidation()

  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return


    const allFiles = Array.from(selectedFiles)
    const pdfFiles = allFiles.filter(file => file.type === 'application/pdf')
    const nonPdfCount = allFiles.length - pdfFiles.length

    // Show alert if non-PDF files were selected
    if (nonPdfCount > 0) {
      alert(`${nonPdfCount} file(s) were skipped. Only PDF files are allowed.`)
    }

    // Limit to 10 files
    const filesToProcess = pdfFiles.slice(0, 10)
    if (pdfFiles.length > 10) {
      alert(`Only the first 10 files will be processed. ${pdfFiles.length - 10} files were skipped.`)
    }

    // Create initial file objects with validating status
    const newFiles: UploadFile[] = filesToProcess.map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      progress: 0,
      status: 'validating' as const,
      metadata: { ...DEFAULT_METADATA },
      touchedFields: {
        law_firm: false,
        fund_manager: false,
        fund_admin: false,
        jurisdiction: false,
        subscription_agreement_skipped: false,
        subscription_agreement_start_page: false,
        subscription_agreement_end_page: false
      }
    }))

    setFiles(prev => [...prev, ...newFiles])
    setValidationSummary(null)
    setStatusMessage(null)
    setError(null)

    try {
      // Validate files
      const validationResults = await validateFiles(filesToProcess)
      
      // Update files with validation results
      setFiles(prev => prev.map(f => {
        const validation = validationResults.get(f.file.name)
        if (validation) {
          return {
            ...f,
            status: validation.isValid ? 'pending' as const : 'error' as const,
            validation,
            error: validation.isValid ? '' : validation.issues.join(', ')
          }
        }
        return f
      }))

      // Show validation summary
      const summary = getValidationSummary(validationResults)
      if (summary.invalid > 0) {
        alert(`${summary.invalid} file(s) failed validation. Please check the issues and try again.`)
      } else if (summary.totalWarnings > 0) {
        setValidationSummary(summary)
      }

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Validation failed')
      // Mark all new files as error if validation fails
      setFiles(prev => prev.map(f => 
        newFiles.some(nf => nf.id === f.id)
          ? { ...f, status: 'error' as const, error: 'Validation failed' }
          : f
      ))
    } finally {
    }
  }, [validateFiles, getValidationSummary])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  const uploadFiles = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending')
    
    // Parallel upload processing with concurrency limit
    const CONCURRENCY_LIMIT = 3 // Process up to 3 files simultaneously
    const uploadPromises: Promise<void>[] = []
    
    for (let i = 0; i < pendingFiles.length; i += CONCURRENCY_LIMIT) {
      const batch = pendingFiles.slice(i, i + CONCURRENCY_LIMIT)
      
      const batchPromises = batch.map(uploadFile => uploadSingleFile(uploadFile))
      uploadPromises.push(...batchPromises)
      
      // Wait for current batch to complete before starting next batch
      await Promise.allSettled(batchPromises)
    }
    
    // Optional: Trigger batch job processing after all uploads complete
    try {
      await fetch('/api/test/process-jobs')
    } catch {
      // Non-fatal: manual cron trigger unavailable
    }
  }

  const uploadSingleFile = async (uploadFile: UploadFile): Promise<void> => {
    try {
      // Update status to uploading
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'uploading' as const, progress: 10 } 
          : f
      ))

      const formData = new FormData()
      formData.append('file', uploadFile.file)
      formData.append('metadata', JSON.stringify(uploadFile.metadata))

      // Simulate progress during upload
      const progressInterval = setInterval(() => {
        setFiles(prev => prev.map(f => 
          f.id === uploadFile.id && f.progress < 90
            ? { ...f, progress: Math.min(f.progress + 10, 90) }
            : f
        ))
      }, 200)

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(errorData.error || 'Upload failed')
      }

      const _result = await response.json()

      // Upload completed successfully
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'completed' as const, progress: 100 } 
          : f
      ))

      setStatusMessage(`Uploaded ${uploadFile.file.name}`)
      
      // Trigger document list refresh
      if (onUploadComplete) {
        onUploadComplete()
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed'
      setStatusMessage(`Upload failed for ${uploadFile.file.name}`)
      
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'error' as const, error: errorMessage, progress: 0 } 
          : f
      ))
    }
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const clearCompleted = () => {
    setFiles(prev => prev.filter(f => f.status !== 'completed'))
  }

const toPositiveIntegerOrNull = (value: string): number | null => {
  if (value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const rounded = Math.floor(parsed)
  return rounded > 0 ? rounded : null
}

const updateFileMetadata = (fileId: string, field: keyof DocumentMetadata, value: string | number | boolean | null) => {
  setFiles(prev => prev.map(f => 
    f.id === fileId 
      ? { 
          ...f, 
          metadata: { ...f.metadata, [field]: value },
          touchedFields: { ...f.touchedFields, [field]: true }
        }
      : f
  ))
}

const updateRangeMetadata = (
  fileId: string,
  field: keyof DocumentMetadata,
  value: string
) => {
  const parsed = toPositiveIntegerOrNull(value)

  setFiles(prev => prev.map(f => {
    if (f.id !== fileId) return f
    const updatedMetadata: DocumentMetadata = {
      ...f.metadata,
      [field]: parsed,
      subscription_agreement_skipped: false
    }

    return {
      ...f,
      metadata: updatedMetadata,
      touchedFields: {
        ...f.touchedFields,
        [field]: true,
        subscription_agreement_skipped: true
      }
    }
  }))
}

const toggleNoSubscriptionAgreement = (fileId: string, checked: boolean) => {
  setFiles(prev => prev.map(f => {
    if (f.id !== fileId) return f

    const updatedMetadata: DocumentMetadata = {
      ...f.metadata,
      subscription_agreement_skipped: checked,
      subscription_agreement_start_page: checked ? null : f.metadata.subscription_agreement_start_page,
      subscription_agreement_end_page: checked ? null : f.metadata.subscription_agreement_end_page
    }

    return {
      ...f,
      metadata: updatedMetadata,
      touchedFields: {
        ...f.touchedFields,
        subscription_agreement_skipped: true
      }
    }
  }))
}

const getDropdownClassName = (uploadFile: UploadFile, field: keyof DocumentMetadata) => {
  const baseClass = "h-8 text-xs transition-colors duration-200"
  
  if (!uploadFile.touchedFields[field]) {
      // Orange border when untouched
      return `${baseClass} border-orange-300 focus:border-orange-500 focus:ring-orange-500`
    } else {
      // Green border when touched
      return `${baseClass} border-green-300 focus:border-green-500 focus:ring-green-500`
    }
  }

const isValidSubscriptionRange = (metadata: DocumentMetadata) => {
  if (metadata.subscription_agreement_skipped) return true
  const start = metadata.subscription_agreement_start_page
  const end = metadata.subscription_agreement_end_page

  if (start === null || end === null) return false
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  if (start < 1 || end < 1) return false
  if (end < start) return false
  return true
}

const isMetadataComplete = (metadata: DocumentMetadata) => {
  return metadata.law_firm !== '' && 
         metadata.fund_manager !== '' && 
         metadata.fund_admin !== '' && 
         metadata.jurisdiction !== '' &&
         isValidSubscriptionRange(metadata)
}

  const canUpload = () => {
    const pendingFiles = files.filter(f => f.status === 'pending')
    return pendingFiles.length > 0 && 
           pendingFiles.every(f => isMetadataComplete(f.metadata) && f.validation?.isValid !== false)
  }

  const getFileStatusIcon = (uploadFile: UploadFile) => {
    switch (uploadFile.status) {
      case 'validating':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      case 'pending':
        return uploadFile.validation?.isValid ? 
          <CheckCircle className="h-4 w-4 text-green-500" /> :
          <FileText className="h-4 w-4 text-gray-400" />
      case 'uploading':
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      default:
        return <FileText className="h-4 w-4 text-gray-400" />
    }
  }

  return (
    <Card className="card-enhanced" data-testid="upload-form">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Documents
        </CardTitle>
        <CardDescription>
          Upload PDF documents for processing and similarity search
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {statusMessage && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{statusMessage}</AlertDescription>
          </Alert>
        )}

        {validationSummary && validationSummary.totalWarnings > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              {validationSummary.totalWarnings} warning{validationSummary.totalWarnings === 1 ? '' : 's'} detected during validation. You can proceed, but review the highlighted fields.
            </AlertDescription>
          </Alert>
        )}

        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/10'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            Drop PDF files here or click to browse
          </p>
          <p className="text-xs text-gray-500">
            Maximum 10 files, up to 50MB each
          </p>
          <Input
            id="file-upload"
            type="file"
            multiple
            accept=".pdf"
            className="hidden"
            data-testid="file-input"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Upload Queue</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCompleted}
                disabled={!files.some(f => f.status === 'completed')}
              >
                Clear Completed
              </Button>
            </div>
            
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {files.map((uploadFile) => (
                <div key={uploadFile.id} className={`border rounded-lg p-4 space-y-3 ${
                  isMetadataComplete(uploadFile.metadata) 
                    ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20' 
                    : 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                }`}>
                  {/* File Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getFileStatusIcon(uploadFile)}
                      <div className="flex-1">
                        <p className="text-sm font-medium truncate">
                          {uploadFile.file.name}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs text-gray-500 capitalize">
                            {uploadFile.status}
                            {uploadFile.error && `: ${uploadFile.error}`}
                          </p>
                          
                          {/* Validation status */}
                          {uploadFile.validation && (
                            <>
                              {uploadFile.validation.isValid ? (
                                <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                                  ✓ Validated
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">
                                  ✗ Invalid
                                </Badge>
                              )}
                              
                              {/* File info */}
                              <span className="text-xs text-gray-400">
                                {uploadFile.validation.fileInfo.sizeFormatted}
                              </span>
                            </>
                          )}
                          
                          {/* Metadata status */}
                          {uploadFile.status === 'pending' && isMetadataComplete(uploadFile.metadata) && (
                            <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                              ✓ Ready
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(uploadFile.id)}
                      disabled={uploadFile.status === 'uploading' || uploadFile.status === 'processing'}
                    >
                      ×
                    </Button>
                  </div>

                  {/* Validation Issues and Warnings */}
                  {uploadFile.validation && (uploadFile.validation.issues.length > 0 || uploadFile.validation.warnings.length > 0) && (
                    <div className="space-y-2">
                      {uploadFile.validation.issues.length > 0 && (
                        <Alert className="border-red-200 bg-red-50">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <AlertDescription className="text-sm text-red-800">
                            <div className="font-medium">Issues found:</div>
                            <ul className="list-disc list-inside mt-1">
                              {uploadFile.validation.issues.map((issue, idx) => (
                                <li key={idx}>{issue}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}
                      
                      {uploadFile.validation.warnings.length > 0 && (
                        <Alert className="border-amber-200 bg-amber-50">
                          <Info className="h-4 w-4 text-amber-600" />
                          <AlertDescription className="text-sm text-amber-800">
                            <div className="font-medium">Warnings:</div>
                            <ul className="list-disc list-inside mt-1">
                              {uploadFile.validation.warnings.map((warning, idx) => (
                                <li key={idx}>{warning}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                  {/* Metadata Dropdowns */}
                  {uploadFile.status === 'pending' && uploadFile.validation?.isValid && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="flex items-center gap-2 text-xs">
                            <Building className="h-3 w-3" />
                            Law Firm
                          </Label>
                          <SearchableSelect
                            options={LAW_FIRM_OPTIONS as unknown as {value: string; label: string}[]}
                            value={uploadFile.metadata.law_firm}
                            onValueChange={(value: string) => 
                              updateFileMetadata(uploadFile.id, 'law_firm', value as LawFirmOption)
                            }
                            placeholder="Please select"
                            searchPlaceholder="Search law firms..."
                            className={getDropdownClassName(uploadFile, 'law_firm')}
                            data-testid="law-firm-select"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="flex items-center gap-2 text-xs">
                            <Users className="h-3 w-3" />
                            Fund Manager
                          </Label>
                          <SearchableSelect
                            options={FUND_MANAGER_OPTIONS as unknown as {value: string; label: string}[]}
                            value={uploadFile.metadata.fund_manager}
                            onValueChange={(value: string) => 
                              updateFileMetadata(uploadFile.id, 'fund_manager', value as FundManagerOption)
                            }
                            placeholder="Please select"
                            searchPlaceholder="Search fund managers..."
                            className={getDropdownClassName(uploadFile, 'fund_manager')}
                            data-testid="fund-manager-select"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="flex items-center gap-2 text-xs">
                            <Briefcase className="h-3 w-3" />
                            Fund Admin
                          </Label>
                          <SearchableSelect
                            options={FUND_ADMIN_OPTIONS as unknown as {value: string; label: string}[]}
                            value={uploadFile.metadata.fund_admin}
                            onValueChange={(value: string) => 
                              updateFileMetadata(uploadFile.id, 'fund_admin', value as FundAdminOption)
                            }
                            placeholder="Please select"
                            searchPlaceholder="Search fund admins..."
                            className={getDropdownClassName(uploadFile, 'fund_admin')}
                            data-testid="fund-admin-select"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="flex items-center gap-2 text-xs">
                            <Globe className="h-3 w-3" />
                            Jurisdiction
                          </Label>
                          <SearchableSelect
                            options={JURISDICTION_OPTIONS as unknown as {value: string; label: string}[]}
                            value={uploadFile.metadata.jurisdiction}
                            onValueChange={(value: string) => 
                              updateFileMetadata(uploadFile.id, 'jurisdiction', value as JurisdictionOption)
                            }
                            placeholder="Please select"
                            searchPlaceholder="Search jurisdictions..."
                            className={getDropdownClassName(uploadFile, 'jurisdiction')}
                            data-testid="jurisdiction-select"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <div className="font-medium">Subscription Agreement Pages to Skip</div>
                        <Input
                          type="number"
                          min={1}
                          value={uploadFile.metadata.subscription_agreement_start_page ?? ''}
                          onChange={(event) =>
                            updateRangeMetadata(
                              uploadFile.id,
                              'subscription_agreement_start_page',
                              event.target.value
                            )
                          }
                          className="h-8 w-20 text-xs"
                          placeholder="From"
                          disabled={uploadFile.metadata.subscription_agreement_skipped}
                        />
                        <Input
                          type="number"
                          min={1}
                          value={uploadFile.metadata.subscription_agreement_end_page ?? ''}
                          onChange={(event) =>
                            updateRangeMetadata(
                              uploadFile.id,
                              'subscription_agreement_end_page',
                              event.target.value
                            )
                          }
                          className="h-8 w-20 text-xs"
                          placeholder="To"
                          disabled={uploadFile.metadata.subscription_agreement_skipped}
                        />
                        <label className="flex items-center gap-2 text-gray-600">
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={uploadFile.metadata.subscription_agreement_skipped}
                            onChange={(event) => toggleNoSubscriptionAgreement(uploadFile.id, event.target.checked)}
                          />
                          <span>N/A</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Progress Bar */}
                  {uploadFile.progress > 0 && (
                    <div className="w-full bg-gray-200 rounded-full h-1">
                      <div 
                        className="bg-blue-600 h-1 rounded-full transition-all"
                        style={{ width: `${uploadFile.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Button
              onClick={uploadFiles}
              disabled={!canUpload()}
              className="w-full"
              data-testid="upload-submit-button"
            >
              {files.some(f => f.status === 'uploading' || f.status === 'processing')
                ? 'Processing...'
                : canUpload()
                  ? `Upload ${files.filter(f => f.status === 'pending').length} Files`
                  : 'Complete all metadata fields to upload'
              }
            </Button>
            
          </div>
        )}
      </CardContent>
    </Card>
  )
}
