'use client'

import { memo, useMemo, useCallback } from 'react'
import { Document } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { 
  FileText, 
  Calendar, 
  MoreVertical,
  Square,
  CheckSquare,
  X,
  Eye,
  Edit,
  Building,
  Users,
  Briefcase,
  Globe,
  Target,
  Edit2,
  Download,
  Trash2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  Clock
} from 'lucide-react'
import { formatUploadDate } from '@/lib/date-utils'

interface DocumentStatus {
  phase: string
  message: string
  estimatedTimeRemaining?: string
  processingMethod: 'sync' | 'batch'
  isStale?: boolean
}

interface OptimizedDocumentCardProps {
  document: Document
  isSelected: boolean
  isSelectMode: boolean
  isSearchSource: boolean
  deletingDocuments: Set<string>
  documentStatuses: Map<string, DocumentStatus>
  onToggleSelection: (documentId: string) => void
  onViewPdf: (document: Document) => void
  onDownloadPdf: (document: Document) => void
  onSetEditingDocument: (document: Document) => void
  onOpenRenameDialog: (document: Document) => void
  onSetSearchModeDocument: (document: Document) => void
  onDeleteDocument: (documentId: string) => void
  onCancelProcessing: (documentId: string) => void
  onToggleSelectMode: () => void
}

// Status configuration function for performance
const getStatusConfig = (status: Document['status']) => {
  switch (status) {
    case 'completed':
      return {
        icon: CheckCircle,
        color: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
        label: 'Completed'
      }
    case 'processing':
      return {
        icon: Clock,
        color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800',
        label: 'Processing'
      }
    case 'uploading':
      return {
        icon: Clock,
        color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800',
        label: 'Uploading'
      }
    case 'queued':
      return {
        icon: Clock,
        color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-400 dark:border-purple-800',
        label: 'Queued'
      }
    case 'error':
      return {
        icon: AlertCircle,
        color: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
        label: 'Error'
      }
    case 'cancelled':
      return {
        icon: X,
        color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800',
        label: 'Cancelled'
      }
    case 'cancelling':
      return {
        icon: X,
        color: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-400 dark:border-yellow-800',
        label: 'Cancelling'
      }
    default:
      return {
        icon: FileText,
        color: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-950/50 dark:text-gray-400 dark:border-gray-800',
        label: 'Unknown'
      }
  }
}

// File size formatter
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Page count formatter
const formatPageCount = (pageCount?: number) => {
  if (!pageCount || pageCount === 0) return null
  return pageCount === 1 ? '1 page' : `${pageCount} pages`
}

// Progress calculator
const getProgressFromPhase = (phase: string, method: string) => {
  if (method === 'batch') {
    switch (phase) {
      case 'Preparing Batch': return 20
      case 'Batch Processing': return 60
      default: return 10
    }
  } else {
    switch (phase) {
      case 'Starting': return 15
      case 'Analyzing Document': return 40
      case 'Extracting Data': return 70
      case 'Generating Embeddings': return 90
      default: return 30
    }
  }
}

// Helper to check if processing can be cancelled
const canCancelProcessing = (status: string) => {
  return ['queued', 'processing'].includes(status)
}

// Helper to check if document is processing
const isProcessing = (status: string) => {
  return ['uploading', 'queued', 'processing', 'cancelling'].includes(status)
}

// Main optimized document card component
const OptimizedDocumentCard = memo<OptimizedDocumentCardProps>(({
  document,
  isSelected,
  isSelectMode,
  isSearchSource,
  deletingDocuments,
  documentStatuses,
  onToggleSelection,
  onViewPdf,
  onDownloadPdf,
  onSetEditingDocument,
  onOpenRenameDialog,
  onSetSearchModeDocument,
  onDeleteDocument,
  onCancelProcessing,
  onToggleSelectMode
}) => {
  // Memoize expensive calculations
  const statusConfig = useMemo(() => getStatusConfig(document.status), [document.status])
  const enhancedStatus = useMemo(() => documentStatuses.get(document.id), [documentStatuses, document.id])
  const isProcessingDocument = useMemo(() => document.status === 'processing' || document.status === 'queued', [document.status])
  const formattedFileSize = useMemo(() => formatFileSize(document.file_size), [document.file_size])
  const formattedPageCount = useMemo(() => formatPageCount(document.page_count), [document.page_count])
  const formattedUploadDate = useMemo(() => formatUploadDate(document.created_at), [document.created_at])
  
  // Memoize event handlers to prevent unnecessary re-renders
  const handleToggleSelection = useCallback(() => {
    onToggleSelection(document.id)
  }, [onToggleSelection, document.id])
  
  const handleViewPdf = useCallback(() => {
    onViewPdf(document)
  }, [onViewPdf, document])
  
  const handleDownloadPdf = useCallback(() => {
    onDownloadPdf(document)
  }, [onDownloadPdf, document])
  
  const handleSetEditingDocument = useCallback(() => {
    onSetEditingDocument(document)
  }, [onSetEditingDocument, document])
  
  const handleOpenRenameDialog = useCallback(() => {
    onOpenRenameDialog(document)
  }, [onOpenRenameDialog, document])
  
  const handleSetSearchModeDocument = useCallback(() => {
    onSetSearchModeDocument(document)
  }, [onSetSearchModeDocument, document])
  
  const handleDeleteDocument = useCallback(() => {
    onDeleteDocument(document.id)
  }, [onDeleteDocument, document.id])
  
  const handleCancelProcessing = useCallback(() => {
    onCancelProcessing(document.id)
  }, [onCancelProcessing, document.id])

  // Memoize business metadata to prevent re-calculations
  const businessMetadata = useMemo(() => {
    if (!document.metadata) return null
    
    const { law_firm, fund_manager, fund_admin, jurisdiction } = document.metadata
    if (!law_firm && !fund_manager && !fund_admin && !jurisdiction) return null
    
    return { law_firm, fund_manager, fund_admin, jurisdiction }
  }, [document.metadata])

  // Memoize legacy metadata
  const legacyMetadata = useMemo(() => {
    if (!document.metadata) return null
    
    const { investor_type, document_type } = document.metadata
    if (!investor_type && !document_type) return null
    
    return { investor_type, document_type }
  }, [document.metadata])

  // Memoize progress calculation for processing documents
  const progressData = useMemo(() => {
    if (!isProcessingDocument || !enhancedStatus) return null
    
    const progress = getProgressFromPhase(enhancedStatus.phase, enhancedStatus.processingMethod)
    return { progress, enhancedStatus }
  }, [isProcessingDocument, enhancedStatus])

  const StatusIcon = statusConfig.icon

  return (
    <Card 
      className={`group hover:shadow-md transition-all duration-200 ${
        isSelectMode && isSelected ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950/20' : ''
      } ${
        isSearchSource ? 'ring-2 ring-purple-500 bg-purple-50 dark:bg-purple-950/20' : ''
      }`} 
      role="article" 
      aria-labelledby={`document-title-${document.id}`}
      data-testid="document-item"
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          {/* Document Icon and Selection */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {isSelectMode && (
              <>
                {isSearchSource ? (
                  <div className="flex items-center gap-1">
                    <Target className="h-4 w-4 text-purple-600" />
                    <span className="text-xs font-medium text-purple-600">Source</span>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleToggleSelection}
                    className="p-1 h-auto"
                    aria-label={`${isSelected ? 'Deselect' : 'Select'} ${document.title}`}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-5 w-5 text-blue-600" />
                    ) : (
                      <Square className="h-5 w-5 text-gray-400" />
                    )}
                  </Button>
                )}
              </>
            )}
            <div className="p-2 bg-blue-50 dark:bg-gradient-to-br dark:from-blue-900/60 dark:to-blue-800/40 rounded-lg border dark:border-blue-700/30" aria-hidden="true">
              <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              {/* Document Info */}
              <div className="min-w-0 flex-1 space-y-2">
                {/* Title and Status Row */}
                <div className="flex items-center gap-3">
                  <h3 id={`document-title-${document.id}`} className="text-base font-semibold truncate text-gray-900 dark:text-white">
                    {document.title}
                  </h3>
                  <Badge 
                    className={`${statusConfig.color} flex items-center gap-1 flex-shrink-0`}
                    data-testid="document-status"
                  >
                    <StatusIcon className="h-3 w-3" />
                    {enhancedStatus?.phase || statusConfig.label}
                  </Badge>
                </div>

                {/* Metadata Row */}
                <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formattedUploadDate}
                  </div>
                  <div>{formattedFileSize}</div>
                  {formattedPageCount && <div>{formattedPageCount}</div>}
                </div>

                {/* Business Metadata Row */}
                {businessMetadata && (
                  <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                    {businessMetadata.law_firm && (
                      <div className="flex items-center gap-1">
                        <Building className="h-3 w-3" />
                        <span className="truncate">{businessMetadata.law_firm}</span>
                      </div>
                    )}
                    {businessMetadata.fund_manager && (
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span className="truncate">{businessMetadata.fund_manager}</span>
                      </div>
                    )}
                    {businessMetadata.fund_admin && (
                      <div className="flex items-center gap-1">
                        <Briefcase className="h-3 w-3" />
                        <span className="truncate">{businessMetadata.fund_admin}</span>
                      </div>
                    )}
                    {businessMetadata.jurisdiction && (
                      <div className="flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        <span className="truncate">{businessMetadata.jurisdiction}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Legacy Metadata Tags */}
                {legacyMetadata && (
                  <div className="flex gap-2 flex-wrap">
                    {legacyMetadata.investor_type && (
                      <Badge variant="outline" className="text-xs">
                        {legacyMetadata.investor_type}
                      </Badge>
                    )}
                    {legacyMetadata.document_type && (
                      <Badge variant="outline" className="text-xs">
                        {legacyMetadata.document_type}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Enhanced Processing Status */}
                {progressData && (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {progressData.enhancedStatus.message}
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div 
                            className={`h-1.5 rounded-full transition-all duration-500 ${
                              progressData.enhancedStatus.processingMethod === 'batch' 
                                ? 'bg-purple-500 dark:bg-purple-400' 
                                : 'bg-blue-500 dark:bg-blue-400'
                            }`}
                            style={{ width: `${progressData.progress}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                        {progressData.progress}%
                      </span>
                      {progressData.enhancedStatus.estimatedTimeRemaining && (
                        <span className={`text-xs font-medium ${progressData.enhancedStatus.isStale ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'}`}>
                          {progressData.enhancedStatus.estimatedTimeRemaining}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs">
                      {progressData.enhancedStatus.processingMethod === 'batch' && (
                        <div className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                          <Clock className="h-3 w-3" />
                          <span>Batch processing</span>
                        </div>
                      )}
                      
                      {progressData.enhancedStatus.isStale && (
                        <div className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                          <AlertCircle className="h-3 w-3" />
                          <span>Status checking...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {document.processing_error && (
                  <div className="p-2 bg-red-50 dark:bg-red-950/50 rounded text-xs text-red-700 dark:text-red-400">
                    {document.processing_error}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Primary Action Buttons */}
                {document.status === 'completed' && (
                  <>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={handleViewPdf}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      View
                    </Button>
                    {!document.metadata?.embeddings_skipped && (
                      <Button 
                        size="sm"
                        onClick={handleSetSearchModeDocument}
                      >
                        <Sparkles className="h-3 w-3 mr-1" />
                        Search Similar
                      </Button>
                    )}
                  </>
                )}

                {/* More Options Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`More options for ${document.title}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem 
                      onClick={handleDownloadPdf}
                      className="flex items-center"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download PDF
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={onToggleSelectMode}
                      className="flex items-center"
                    >
                      <CheckSquare className="h-4 w-4 mr-2" />
                      Select Documents
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleSetEditingDocument}
                      className="flex items-center"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit Details
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleOpenRenameDialog}
                      className="flex items-center"
                    >
                      <Edit2 className="h-4 w-4 mr-2" />
                      Rename Document
                    </DropdownMenuItem>
                    
                    {/* Cancel Processing Option */}
                    {canCancelProcessing(document.status) && (
                      <>
                        <DropdownMenuSeparator />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem 
                              className="flex items-center text-orange-600 dark:text-orange-400"
                              onSelect={(e) => e.preventDefault()}
                            >
                              <X className="h-4 w-4 mr-2" />
                              Cancel Processing
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel Processing</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to cancel processing for &quot;{document.title}&quot;? 
                                This will stop all current processing operations and mark the document as cancelled.
                                You can retry processing later if needed.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep Processing</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={handleCancelProcessing} 
                                className="bg-orange-600 hover:bg-orange-700"
                                disabled={deletingDocuments.has(document.id)}
                              >
                                {deletingDocuments.has(document.id) ? 'Cancelling...' : 'Cancel Processing'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                    
                    <DropdownMenuSeparator />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem 
                          className="flex items-center text-red-600 dark:text-red-400"
                          onSelect={(e) => e.preventDefault()}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Document</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete &quot;{document.title}&quot;? 
                            This action cannot be undone and will permanently remove the document 
                            from your account.
                            {isProcessing(document.status) && (
                              <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-md">
                                <div className="flex items-center">
                                  <AlertCircle className="h-4 w-4 text-orange-600 mr-2" />
                                  <span className="text-sm font-medium text-orange-800 dark:text-orange-200">
                                    Warning: This document is currently processing
                                  </span>
                                </div>
                                <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                                  Deleting will not stop the background processing. Consider using &quot;Cancel Processing&quot; first.
                                </p>
                              </div>
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={handleDeleteDocument} 
                            className="bg-red-600 hover:bg-red-700"
                            disabled={deletingDocuments.has(document.id)}
                          >
                            {deletingDocuments.has(document.id) ? 'Deleting...' : 'Delete Document'}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}, (prevProps, nextProps) => {
  // Custom comparison function for better memo performance
  return (
    prevProps.document.id === nextProps.document.id &&
    prevProps.document.status === nextProps.document.status &&
    prevProps.document.title === nextProps.document.title &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isSelectMode === nextProps.isSelectMode &&
    prevProps.isSearchSource === nextProps.isSearchSource &&
    prevProps.deletingDocuments.has(prevProps.document.id) === nextProps.deletingDocuments.has(nextProps.document.id) &&
    prevProps.documentStatuses.get(prevProps.document.id) === nextProps.documentStatuses.get(nextProps.document.id)
  )
})

OptimizedDocumentCard.displayName = 'OptimizedDocumentCard'

export { OptimizedDocumentCard }