'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Document } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select'
import { SearchModeModal } from '@/components/similarity/search-mode-modal'
import { EditDocumentMetadataModal } from './edit-document-metadata-modal'
import {
  FileText,
  Target,
  Search,
  Calendar,
  Filter,
  Download,
  AlertCircle,
  CheckCircle,
  Clock,
  Sparkles,
  MoreVertical,
  Trash2,
  Square,
  CheckSquare,
  X,
  Eye,
  Edit,
  Edit2,
  Building,
  Users,
  Briefcase,
  Globe,
  ArrowUp,
  ArrowDown,
  FilterX,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  RotateCcw
} from 'lucide-react'
import {
  LAW_FIRM_OPTIONS, 
  FUND_MANAGER_OPTIONS, 
  FUND_ADMIN_OPTIONS, 
  JURISDICTION_OPTIONS 
} from '@/lib/metadata-constants'
import { format } from 'date-fns'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { clientLogger } from '@/lib/client-logger'

interface DocumentListProps {
  refreshTrigger?: number
}

interface RenameDocumentDialogState {
  document: Document | null
  isOpen: boolean
  newTitle: string
  isRenaming: boolean
}

interface DocumentStatus {
  status: Document['status']
  phase: string
  message: string
  progress?: number
  estimatedTimeRemaining?: string
  error?: string | null
  lastUpdated?: string
  isStale?: boolean
}

type MetadataOption = {
  value: string
  label: string
}

interface SearchModeState {
  document: Document | null
  isOpen: boolean
}

export function EnhancedDocumentList({ refreshTrigger = 0 }: DocumentListProps) {
  const supabase = useMemo(() => createSupabaseClient(), [])
  const [documents, setDocuments] = useState<Document[]>([])
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('upload_time')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  
  // Metadata filters
  const [showFilters, setShowFilters] = useState(false)
  const [lawFirmFilter, setLawFirmFilter] = useState<string[]>([])
  const [fundManagerFilter, setFundManagerFilter] = useState<string[]>([])
  const [fundAdminFilter, setFundAdminFilter] = useState<string[]>([])
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [editingDocument, setEditingDocument] = useState<Document | null>(null)
  const [renameDialog, setRenameDialog] = useState<RenameDocumentDialogState>({
    document: null,
    isOpen: false,
    newTitle: '',
    isRenaming: false
  })

  const [deleteDialog, setDeleteDialog] = useState<{
    document: Document | null
    isOpen: boolean
    isDeleting: boolean
  }>({
    document: null,
    isOpen: false,
    isDeleting: false
  })
  const [bulkDeleteState, setBulkDeleteState] = useState({
    total: 0,
    processed: 0,
    isDeleting: false,
  })

  const [realtimeUserId, setRealtimeUserId] = useState<string | null>(null)

  const [sourceForSelectionId, setSourceForSelectionId] = useState<string | null>(null)
  const [retryingDocuments, setRetryingDocuments] = useState<Set<string>>(new Set())
  const [cancellingDocuments, setCancellingDocuments] = useState<Set<string>>(new Set())
  const [cancelDialogOpen, setCancelDialogOpen] = useState<string | null>(null)
  
  // Search mode and source document state
  const [searchModeModal, setSearchModeModal] = useState<SearchModeState>({
    document: null,
    isOpen: false
  })
  const [_selectedSearchSourceDocument, _setSelectedSearchSourceDocument] = useState<Document | null>(null)

  // Track when we last kicked the cron endpoint so we don't spam requests
  const [lastProcessingTrigger, setLastProcessingTrigger] = useState<number>(0)
  
  // Enhanced processing status tracking
  const [documentStatuses, setDocumentStatuses] = useState<Map<string, DocumentStatus>>(new Map())
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const documentsPerPage = 10
  
  // Router for navigation
  const router = useRouter()

  // Simple document fetching - no complex caching or polling
  const fetchDocuments = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setIsLoading(true)
      setError('')
      
      const response = await fetch('/api/documents', { cache: 'no-store' })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch documents: ${response.status}`)
      }
      
      const data = await response.json()
      setDocuments(data.documents || [])
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load documents'
      setError(errorMessage)
      clientLogger.error('Document fetch error:', err)
    } finally {
      if (showLoading) setIsLoading(false)
    }
  }, [])

  const handleDocumentUpdate = (updatedDocument: Document) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === updatedDocument.id ? updatedDocument : doc
    ))
    setEditingDocument(null)
  }

  // Resolve user ID for realtime subscriptions
  useEffect(() => {
    let isMounted = true
    supabase.auth.getUser()
      .then(({ data, error }) => {
        if (!isMounted) return
        if (error) {
          clientLogger.error('Failed to fetch Supabase user for realtime subscription:', error)
          return
        }
        if (data?.user?.id) {
          setRealtimeUserId(data.user.id)
        }
      })
      .catch((err) => {
        clientLogger.error('Unexpected Supabase auth error:', err)
      })

    return () => {
      isMounted = false
    }
  }, [supabase])

  // Fallback: infer user ID from documents if not already set
  useEffect(() => {
    if (!realtimeUserId && documents.length > 0) {
      const firstDocument = documents[0]
      if (firstDocument) {
        setRealtimeUserId(firstDocument.user_id)
      }
    }
  }, [documents, realtimeUserId])

  // Subscribe to realtime document updates to reflect status changes immediately
  useEffect(() => {
    if (!realtimeUserId) {
      return
    }

    const channel = supabase
      .channel(`documents-status-${realtimeUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documents', filter: `user_id=eq.${realtimeUserId}` },
        (payload) => {
          const newDoc = payload.new as Document | null
          const oldDoc = payload.old as Document | null

          setDocuments(prev => {
            if (payload.eventType === 'DELETE' && oldDoc?.id) {
              return prev.filter(doc => doc.id !== oldDoc.id)
            }

            if (!newDoc) {
              return prev
            }

            if (payload.eventType === 'INSERT') {
              const exists = prev.some(doc => doc.id === newDoc.id)
              if (exists) {
                return prev.map(doc => doc.id === newDoc.id ? { ...doc, ...newDoc } : doc)
              }
              return [...prev, newDoc]
            }

            if (payload.eventType === 'UPDATE') {
              let found = false
              const updated = prev.map(doc => {
                if (doc.id === newDoc.id) {
                  found = true
                  return { ...doc, ...newDoc }
                }
                return doc
              })
              if (!found) {
                return [...prev, newDoc]
              }
              return updated
            }

            return prev
          })

          if (payload.eventType === 'DELETE' && oldDoc?.id) {
            setDocumentStatuses(prev => {
              const next = new Map(prev)
              next.delete(oldDoc.id)
              return next
            })
          }

          if (payload.eventType === 'UPDATE' && newDoc?.id) {
            const terminalStatuses: Document['status'][] = ['completed', 'error', 'cancelled', 'cancelling']
            if (terminalStatuses.includes(newDoc.status)) {
              setDocumentStatuses(prev => {
                const next = new Map(prev)
                next.delete(newDoc.id)
                return next
              })
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, realtimeUserId])

  // Search mode handlers
  const handleSetSearchModeDocument = useCallback((document: Document) => {
    setSearchModeModal({
      document,
      isOpen: true
    })
  }, [])

  const handleSelectedSearchClick = useCallback(() => {
    if (searchModeModal.document) {
      const sourceDocId = searchModeModal.document.id
      setSourceForSelectionId(sourceDocId) // Set the source doc
      setIsSelectMode(true)
      setSelectedDocuments(prev => new Set(prev).add(sourceDocId))
    }
  }, [searchModeModal.document])

  const closeSearchModeModal = useCallback(() => {
    setSearchModeModal({
      document: null,
      isOpen: false
    })
  }, [])

  const openRenameDialog = (document: Document) => {
    setRenameDialog({
      document,
      isOpen: true,
      newTitle: document.title,
      isRenaming: false
    })
  }

  const closeRenameDialog = () => {
    setRenameDialog({
      document: null,
      isOpen: false,
      newTitle: '',
      isRenaming: false
    })
  }

  const handleRenameDocument = async () => {
    if (!renameDialog.document || !renameDialog.newTitle.trim()) return

    setRenameDialog(prev => ({ ...prev, isRenaming: true }))

    try {
      const response = await fetch(`/api/documents/${renameDialog.document.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: renameDialog.newTitle.trim()
        })
      })

      if (!response.ok) {
        throw new Error('Failed to rename document')
      }

      const updatedDocument = await response.json()

      // Update local state
      setDocuments(prev => prev.map(doc => 
        doc.id === updatedDocument.id ? updatedDocument : doc
      ))

      closeRenameDialog()
    } catch (error) {
      clientLogger.error('Error renaming document:', error)
      alert('Failed to rename document. Please try again.')
    } finally {
      setRenameDialog(prev => ({ ...prev, isRenaming: false }))
    }
  }

  const viewPdf = async (document: Document) => {
    try {
      const response = await fetch(`/api/documents/${document.id}/download`)
      
      if (!response.ok) {
        throw new Error('Failed to load document')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch (error) {
      clientLogger.error('Error viewing document:', error)
      alert('Failed to view document. Please try again.')
    }
  }

  // Cancel processing handler
  const handleCancelProcessing = useCallback(async (documentId: string) => {
    // Set loading state
    setCancellingDocuments(prev => {
      const next = new Set(prev)
      next.add(documentId)
      return next
    })

    try {
      // Optimistically mark as cancelled immediately (valid status)
      setDocuments(prev => prev.map(doc =>
        doc.id === documentId ? {
          ...doc,
          status: 'cancelled' as Document['status'],
          processing_error: 'Cancelling...'
        } : doc
      ))

      const response = await fetch(`/api/documents/${documentId}/cancel`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to cancel processing')
      }

      const result = await response.json()

      // If cleanup was successful, remove document from list entirely
      if (result.cleanedUp && result.status === 'deleted') {
        setDocuments(prev => prev.filter(doc => doc.id !== documentId))
        clientLogger.info('Document cancelled and completely removed:', result)
      } else {
        // Cleanup incomplete - keep in list as cancelled
        setDocuments(prev => prev.map(doc =>
          doc.id === documentId ? {
            ...doc,
            status: 'cancelled' as Document['status'],
            processing_error: result.message || 'Processing cancelled by user'
          } : doc
        ))
        clientLogger.warn('Document cancelled but cleanup incomplete:', result)
      }

      // Remove from tracking if it was being monitored
      setDocumentStatuses(prev => {
        const next = new Map(prev)
        next.delete(documentId)
        return next
      })

    } catch (error) {
      clientLogger.error('Error cancelling processing:', error)
      // Revert optimistic update on error
      await fetchDocuments()
      alert(error instanceof Error ? error.message : 'Failed to cancel processing. Please try again.')
    } finally {
      // Clear loading state
      setCancellingDocuments(prev => {
        const next = new Set(prev)
        next.delete(documentId)
        return next
      })
      // Close the dialog
      setCancelDialogOpen(prev => prev === documentId ? null : prev)
    }
  }, [fetchDocuments])

  const handleRetryProcessing = useCallback(async (document: Document) => {
    setRetryingDocuments(prev => {
      const next = new Set(prev)
      next.add(document.id)
      return next
    })

    try {
      const response = await fetch(`/api/documents/${document.id}/retry`, {
        method: 'POST'
      })

      if (!response.ok) {
        const { error: message } = await response.json().catch(() => ({ error: 'Failed to retry document' }))
        throw new Error(message || 'Failed to retry document')
      }

      const { document: updatedDocument } = await response.json() as { document: Document }

      setDocuments(prev => prev.map(doc =>
        doc.id === updatedDocument.id ? updatedDocument : doc
      ))

      setDocumentStatuses(prev => {
        const next = new Map(prev)
        next.delete(document.id)
        return next
      })

    } catch (error) {
      clientLogger.error('Error retrying document processing:', error)
      const message = error instanceof Error ? error.message : 'Failed to retry processing. Please try again.'
      alert(message)
    } finally {
      setRetryingDocuments(prev => {
        const next = new Set(prev)
        next.delete(document.id)
        return next
      })
    }
  }, [])

  // Enhanced status polling for processing documents
  useEffect(() => {
    const trackedStatuses: Document['status'][] = ['uploading', 'queued', 'processing', 'error']
    const processingDocs = documents.filter(doc => trackedStatuses.includes(doc.status))

    if (processingDocs.length === 0) {
      // Clear any existing statuses for non-processing documents
      setDocumentStatuses(new Map())
      return
    }

    const pollStatuses = async () => {
      try {
        const statusPromises = processingDocs.map(async (doc) => {
          const response = await fetch(`/api/documents/${doc.id}/processing-status`, {
            cache: 'no-store'
          })
          if (response.ok) {
            const statusData = await response.json()
            return { docId: doc.id, status: statusData }
          }
          return null
        })

        const results = await Promise.all(statusPromises)

        // Use functional update to avoid dependency on current documentStatuses
        setDocumentStatuses(prevStatuses => {
          const newStatuses = new Map(prevStatuses)
          
          results.forEach(result => {
            if (!result) return

            if (result.status.status === 'error') {
              newStatuses.delete(result.docId)
            } else {
              newStatuses.set(result.docId, result.status)
            }
          })
          
          // Remove statuses for documents that are no longer processing
          const processingIds = new Set(processingDocs.map(doc => doc.id))
          for (const [docId] of newStatuses) {
            if (!processingIds.has(docId)) {
              newStatuses.delete(docId)
            }
          }
          
          return newStatuses
        })

        // Update local document status when the backend status changes
        const statusById = new Map<string, DocumentStatus>()
        results.forEach(result => {
          if (result?.status) {
            statusById.set(result.docId, result.status)
          }
        })

        let shouldRefresh = false

        setDocuments(prev => prev.map(doc => {
          const latestStatus = statusById.get(doc.id)
          if (!latestStatus) {
            return doc
          }

          const newStatus = latestStatus.status as Document['status']
          const sameStatus = newStatus === doc.status
          const incomingError = latestStatus.error ?? null
          const existingError = doc.processing_error ?? null

          if (sameStatus && (newStatus !== 'error' || incomingError === existingError)) {
            return doc
          }

          if (newStatus === 'completed') {
            shouldRefresh = true
          }

          const updatedDoc: Document = { ...doc, status: newStatus }

          if (newStatus === 'error') {
            const message = incomingError || existingError || 'Document processing failed'
            updatedDoc.processing_error = message
          } else if ('processing_error' in updatedDoc) {
            updatedDoc.processing_error = null
          }

          return updatedDoc
        }))

        if (shouldRefresh) {
          // Pull the latest document metadata (page count, fields, etc.) once the status settles
          fetchDocuments(false)
        }
      } catch (error) {
        clientLogger.error('Error polling document statuses:', error)
      }
    }

    // Poll every 3 seconds for processing documents
    const interval = setInterval(pollStatuses, 3000)
    pollStatuses() // Initial poll

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents])

  // Automatically trigger the cron worker when queued documents are detected in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return
    }

    const hasQueuedDoc = documents.some(doc => doc.status === 'queued')
    if (!hasQueuedDoc) {
      return
    }

    const now = Date.now()
    if (now - lastProcessingTrigger < 5000) {
      return
    }

    setLastProcessingTrigger(now)

    const triggerProcessing = async () => {
      try {
        const response = await fetch('/api/test/process-jobs')
        if (!response.ok) {
          clientLogger.warn('Manual cron trigger returned non-OK response')
        }
      } catch (error) {
        clientLogger.warn('Failed to trigger manual cron processing', error)
      }
    }

    triggerProcessing()
  }, [documents, lastProcessingTrigger])

  // Filter helper functions
  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
  }

  const clearAllFilters = () => {
    setLawFirmFilter([])
    setFundManagerFilter([])
    setFundAdminFilter([])
    setJurisdictionFilter([])
    setShowFilters(false)
  }

  const toggleFilters = () => {
    setShowFilters(!showFilters)
  }

  const hasActiveFilters = () => {
    return lawFirmFilter.length > 0 || 
           fundManagerFilter.length > 0 || 
           fundAdminFilter.length > 0 || 
           jurisdictionFilter.length > 0
  }

  // Multi-select helper functions
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode)
    setSelectedDocuments(new Set())
    setSourceForSelectionId(null) // Reset source doc
  }

  const toggleDocumentSelection = (documentId: string) => {
    // Prevent the source document from being deselected
    if (documentId === sourceForSelectionId) {
      return
    }
    const newSelected = new Set(selectedDocuments)
    if (newSelected.has(documentId)) {
      newSelected.delete(documentId)
    } else {
      newSelected.add(documentId)
    }
    setSelectedDocuments(newSelected)
  }

  const selectAllDocuments = () => {
    const allIds = new Set(filteredDocuments.map(doc => doc.id))
    setSelectedDocuments(allIds)
  }

  const selectAllOnPage = () => {
    const paginatedIds = paginatedDocuments.map(doc => doc.id)
    setSelectedDocuments(prev => new Set([...Array.from(prev), ...paginatedIds]))
  }

  const deselectAllDocuments = () => {
    if (sourceForSelectionId) {
      setSelectedDocuments(new Set([sourceForSelectionId]))
    } else {
      setSelectedDocuments(new Set())
    }
  }

  const deleteDocument = async (documentId: string) => {
    setDeleteDialog(prev => {
      if (prev.document?.id === documentId) {
        return { ...prev, isDeleting: true }
      }
      return prev
    })
    
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete document')
      }

      // Remove from local state
      setDocuments(prev => prev.filter(doc => doc.id !== documentId))
      
      // If it was selected, remove from selection
      if (selectedDocuments.has(documentId)) {
        setSelectedDocuments(prev => {
          const newSelected = new Set(prev)
          newSelected.delete(documentId)
          return newSelected
        })
      }

    } catch (error) {
      clientLogger.error('Error deleting document:', error)
      alert('Failed to delete document. Please try again.')
    } finally {
      setDeleteDialog(prev => {
        if (prev.document?.id === documentId) {
          return { document: null, isOpen: false, isDeleting: false }
        }
        return prev
      })
    }
  }

  const deleteSelectedDocuments = async () => {
    if (selectedDocuments.size === 0) return

    setBulkDeleteState({ total: selectedDocuments.size, processed: 0, isDeleting: true })
    const documentIds = Array.from(selectedDocuments)

    try {
      for (const id of documentIds) {
        await deleteDocument(id)
        setBulkDeleteState(prev => ({ ...prev, processed: prev.processed + 1 }))
      }
      setBulkDeleteState(prev => ({ ...prev, isDeleting: false }))
      setShowBulkDeleteDialog(false)
      setSelectedDocuments(new Set())
      setIsSelectMode(false)
    } catch (error) {
      clientLogger.error('Error in bulk delete:', error)
      setBulkDeleteState(prev => ({ ...prev, isDeleting: false }))
      setShowBulkDeleteDialog(false)
    }
  }

  const downloadPdf = async (document: Document) => {
    try {
      const response = await fetch(`/api/documents/${document.id}/download`)
      
      if (!response.ok) {
        throw new Error('Failed to download document')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = document.filename || `${document.title}.pdf`
      window.document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      clientLogger.error('Error downloading document:', error)
      alert('Failed to download document. Please try again.')
    }
  }

  // Initial load
  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  // Refresh when trigger changes
  useEffect(() => {
    if (refreshTrigger > 0) {
      clientLogger.warn('📡 Refreshing document list after upload')
      fetchDocuments(false)
    }
  }, [refreshTrigger, fetchDocuments])

  // Apply filtering, sorting, and search directly
  useEffect(() => {
    let filtered = documents.filter(doc => {
      // Search query filter
      const matchesSearch = searchQuery === '' || 
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'processing' && ['uploading', 'queued', 'processing'].includes(doc.status)) ||
        doc.status === statusFilter
      
      // Metadata filters
      const matchesLawFirm = lawFirmFilter.length === 0 || 
        (doc.metadata?.law_firm && lawFirmFilter.includes(doc.metadata.law_firm))
      
      const matchesFundManager = fundManagerFilter.length === 0 || 
        (doc.metadata?.fund_manager && fundManagerFilter.includes(doc.metadata.fund_manager))
      
      const matchesFundAdmin = fundAdminFilter.length === 0 || 
        (doc.metadata?.fund_admin && fundAdminFilter.includes(doc.metadata.fund_admin))
      
      const matchesJurisdiction = jurisdictionFilter.length === 0 || 
        (doc.metadata?.jurisdiction && jurisdictionFilter.includes(doc.metadata.jurisdiction))
      
      return matchesSearch && matchesStatus && matchesLawFirm && 
             matchesFundManager && matchesFundAdmin && matchesJurisdiction
    })

    // Apply sorting
    filtered = filtered.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'upload_time':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
        case 'name':
          comparison = a.title.localeCompare(b.title)
          break
        case 'size':
          comparison = a.file_size - b.file_size
          break
        default:
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      
      return sortOrder === 'asc' ? comparison : -comparison
    })

    setFilteredDocuments(filtered)
    // Reset to first page when filters change
    setCurrentPage(1)
  }, [documents, searchQuery, statusFilter, lawFirmFilter, fundManagerFilter, fundAdminFilter, jurisdictionFilter, sortBy, sortOrder])

  // Calculate pagination
  const totalPages = Math.ceil(filteredDocuments.length / documentsPerPage)
  const startIndex = (currentPage - 1) * documentsPerPage
  const endIndex = startIndex + documentsPerPage
  const paginatedDocuments = filteredDocuments.slice(startIndex, endIndex)

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

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
          color: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-950/50 dark:text-gray-400 dark:border-gray-800',
          label: 'Cancelled'
        }
      case 'cancelling':
        return {
          icon: X,
          color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800',
          label: 'Cancelling...'
        }
      default:
        return {
          icon: FileText,
          color: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-950/50 dark:text-gray-400 dark:border-gray-800',
          label: 'Unknown'
        }
    }
  }

  // Helper functions for document display
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatPageCount = (pageCount?: number) => {
    if (!pageCount || pageCount === 0) return null
    return pageCount === 1 ? '1 page' : `${pageCount} pages`
  }

  const statusCounts = useMemo(() => {
    const filteredByMetadata = documents.filter(doc => {
      const matchesSearch = searchQuery === '' ||
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.filename.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesLawFirm = lawFirmFilter.length === 0 ||
        (doc.metadata?.law_firm && lawFirmFilter.includes(doc.metadata.law_firm))

      const matchesFundManager = fundManagerFilter.length === 0 ||
        (doc.metadata?.fund_manager && fundManagerFilter.includes(doc.metadata.fund_manager))

      const matchesFundAdmin = fundAdminFilter.length === 0 ||
        (doc.metadata?.fund_admin && fundAdminFilter.includes(doc.metadata.fund_admin))

      const matchesJurisdiction = jurisdictionFilter.length === 0 ||
        (doc.metadata?.jurisdiction && jurisdictionFilter.includes(doc.metadata.jurisdiction))

      return matchesSearch && matchesLawFirm && matchesFundManager && matchesFundAdmin && matchesJurisdiction
    })

    return {
      all: filteredByMetadata.length,
      completed: filteredByMetadata.filter(d => d.status === 'completed').length,
      processing: filteredByMetadata.filter(d => ['uploading', 'queued', 'processing'].includes(d.status)).length,
      error: filteredByMetadata.filter(d => d.status === 'error').length,
    }
  }, [documents, searchQuery, lawFirmFilter, fundManagerFilter, fundAdminFilter, jurisdictionFilter])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Documents</h2>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <div className="animate-pulse flex flex-col items-center">
              <div className="h-12 w-12 bg-gray-200 dark:bg-gray-700 rounded-lg mb-4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Documents</h2>
        </div>
        <div className="flex items-center gap-2">
          {isSelectMode && (
            <>
              <Badge variant="secondary">
                {selectedDocuments.size} selected
              </Badge>
              {sourceForSelectionId && (
                <Button
                  size="sm"
                  variant="default"
                  className="bg-purple-600 hover:bg-purple-700 focus-visible:ring-purple-400"
                  disabled={selectedDocuments.size < 2}
                  onClick={() => {
                    const ids = Array.from(selectedDocuments)
                    router.push(`/documents/selected-search?ids=${ids.join(',')}`)
                  }}
                >
                  <Search className="h-4 w-4 mr-2" />
                  Search Selected ({selectedDocuments.size})
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    Select All
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={selectAllOnPage}>
                    Select All on Page
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={selectAllDocuments}>
                    Select All Documents
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={deselectAllDocuments}>
                Deselect All
              </Button>
              {selectedDocuments.size > 0 && !sourceForSelectionId && (
                <AlertDialog open={showBulkDeleteDialog} onOpenChange={(open) => {
                  if (!open && !bulkDeleteState.isDeleting) {
                    setShowBulkDeleteDialog(false)
                  } else {
                    setShowBulkDeleteDialog(open)
                  }
                }}>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setBulkDeleteState({ total: selectedDocuments.size, processed: 0, isDeleting: false })
                        setShowBulkDeleteDialog(true)
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Selected ({selectedDocuments.size})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !bulkDeleteState.isDeleting) {
                        event.preventDefault()
                        deleteSelectedDocuments()
                      }
                    }}
                  >
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Documents</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete {selectedDocuments.size} selected document{selectedDocuments.size > 1 ? 's' : ''}? 
                        This action cannot be undone and will permanently remove the document{selectedDocuments.size > 1 ? 's' : ''} 
                        from your account.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={bulkDeleteState.isDeleting}>Cancel</AlertDialogCancel>
                      <Button
                        type="button"
                        onClick={deleteSelectedDocuments}
                        disabled={bulkDeleteState.isDeleting}
                        className="bg-red-600 hover:bg-red-700"
                        autoFocus
                      >
                        {bulkDeleteState.isDeleting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Deleting... ({bulkDeleteState.processed}/{bulkDeleteState.total})
                          </>
                        ) : (
                          `Delete ${selectedDocuments.size} Document${selectedDocuments.size > 1 ? 's' : ''}`
                        )}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button size="sm" variant="ghost" onClick={toggleSelectMode}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </>
          )}
          {!isSelectMode && (
            <Button size="sm" variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export List
            </Button>
          )}
        </div>
      </div>

      {/* Status Tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all" className="flex items-center gap-2">
            All
            <Badge variant="secondary" className="ml-1">
              {statusCounts.all}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex items-center gap-2">
            <CheckCircle className="h-3 w-3" />
            Completed
            <Badge variant="secondary" className="ml-1">
              {statusCounts.completed}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="processing" className="flex items-center gap-2">
            <Clock className="h-3 w-3" />
            Processing
            <Badge variant="secondary" className="ml-1">
              {statusCounts.processing}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="error" className="flex items-center gap-2">
            <AlertCircle className="h-3 w-3" />
            Errors
            <Badge variant="secondary" className="ml-1">
              {statusCounts.error}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Filters and Search */}
        <div className="flex gap-4 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" aria-hidden="true" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              aria-label="Search documents by title"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={toggleFilters}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters() && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {lawFirmFilter.length + fundManagerFilter.length + fundAdminFilter.length + jurisdictionFilter.length}
                </Badge>
              )}
            </Button>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-40" aria-label="Sort documents">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upload_time">Upload Time</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="size">Size</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSortOrder}
              className="px-3"
              aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortOrder === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Metadata Filters */}
        {showFilters && (
          <div className="border rounded-lg p-4 space-y-3 bg-gray-50 dark:bg-slate-800/60 filter-panel-enhanced">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">Filter Documents</span>
              </div>
              {hasActiveFilters() && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs h-auto py-1 px-2"
                >
                  <FilterX className="h-3 w-3 mr-1" />
                  Clear All
                </Button>
              )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Law Firm Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-xs font-medium">
                  <Building className="h-3 w-3" />
                  Law Firm
                </Label>
                <SearchableMultiSelect
                  options={[...LAW_FIRM_OPTIONS]}
                  values={lawFirmFilter}
                  onValuesChange={setLawFirmFilter}
                  placeholder="Select law firms..."
                  searchPlaceholder="Search law firms..."
                />
              </div>

              {/* Fund Manager Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-xs font-medium">
                  <Users className="h-3 w-3" />
                  Fund Manager
                </Label>
                <SearchableMultiSelect
                  options={[...FUND_MANAGER_OPTIONS]}
                  values={fundManagerFilter}
                  onValuesChange={setFundManagerFilter}
                  placeholder="Select fund managers..."
                  searchPlaceholder="Search fund managers..."
                />
              </div>

              {/* Fund Admin Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-xs font-medium">
                  <Briefcase className="h-3 w-3" />
                  Fund Admin
                </Label>
                <SearchableMultiSelect
                  options={[...FUND_ADMIN_OPTIONS]}
                  values={fundAdminFilter}
                  onValuesChange={setFundAdminFilter}
                  placeholder="Select fund admins..."
                  searchPlaceholder="Search fund admins..."
                />
              </div>

              {/* Jurisdiction Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-xs font-medium">
                  <Globe className="h-3 w-3" />
                  Jurisdiction
                </Label>
                <SearchableMultiSelect
                  options={[...JURISDICTION_OPTIONS]}
                  values={jurisdictionFilter}
                  onValuesChange={setJurisdictionFilter}
                  placeholder="Select jurisdictions..."
                  searchPlaceholder="Search jurisdictions..."
                />
              </div>
            </div>
          </div>
        )}

        <TabsContent value={statusFilter}>
          {error && (
            <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  <p className="text-red-800 dark:text-red-200">{error}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {filteredDocuments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-12">
                <FileText className="h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  {searchQuery || hasActiveFilters() ? 'No matching documents' : 'No documents yet'}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-center">
                  {searchQuery || hasActiveFilters()
                    ? 'Try adjusting your search or filter criteria.'
                    : 'Upload your first document to get started.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div>
              {/* Simple Document List - showing paginated documents */}
              <div className="space-y-3">
                {paginatedDocuments.map((document) => {
                  const statusConfig = getStatusConfig(document.status)
                  const StatusIcon = statusConfig.icon

                  return (
                    <Card 
                      key={document.id} 
                      className={`group hover:shadow-md transition-all duration-200 ${
                        isSelectMode && selectedDocuments.has(document.id) ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950/20' : ''
                      } ${
                        _selectedSearchSourceDocument?.id === document.id ? 'ring-2 ring-purple-500 bg-purple-50 dark:bg-purple-950/20' : ''
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
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleDocumentSelection(document.id)}
                                className="p-1 h-auto"
                                aria-label={`${selectedDocuments.has(document.id) ? 'Deselect' : 'Select'} ${document.title}`}
                              >
                                {selectedDocuments.has(document.id) ? (
                                  <CheckSquare className="h-5 w-5 text-blue-600" />
                                ) : (
                                  <Square className="h-5 w-5 text-gray-400" />
                                )}
                              </Button>
                            )}
                            {isSelectMode && sourceForSelectionId === document.id && (
                              <div className="flex items-center gap-1 pl-1">
                                <Target className="h-4 w-4 text-purple-600" />
                                <span className="text-xs font-medium text-purple-600">Source</span>
                              </div>
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
                                  {document.status === 'processing'
                                    ? documentStatuses.get(document.id)?.phase || statusConfig.label
                                    : statusConfig.label}
                                  </Badge>
                                </div>

                                {/* Metadata Row */}
                                <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {format(new Date(document.created_at), 'dd MMM yyyy - HH:mm')}
                                  </div>
                                  <div>{formatFileSize(document.file_size)}</div>
                                  {formatPageCount(document.page_count) && <div>{formatPageCount(document.page_count)}</div>}
                                </div>

                                {/* Document Metadata Row */}
                                {(document.metadata?.law_firm || document.metadata?.fund_manager || document.metadata?.fund_admin || document.metadata?.jurisdiction) && (
                                  <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
                                    {document.metadata?.law_firm && (
                                      <div className="flex items-center gap-1">
                                        <Building className="h-3 w-3" />
                        {resolveOptionLabel(document.metadata?.law_firm ?? '', LAW_FIRM_OPTIONS)}
                                      </div>
                                    )}
                                    {document.metadata?.fund_manager && (
                                      <div className="flex items-center gap-1">
                                        <Users className="h-3 w-3" />
                        {resolveOptionLabel(document.metadata?.fund_manager ?? '', FUND_MANAGER_OPTIONS)}
                                      </div>
                                    )}
                                    {document.metadata?.fund_admin && (
                                      <div className="flex items-center gap-1">
                                        <Briefcase className="h-3 w-3" />
                        {resolveOptionLabel(document.metadata?.fund_admin ?? '', FUND_ADMIN_OPTIONS)}
                                      </div>
                                    )}
                                    {document.metadata?.jurisdiction && (
                                      <div className="flex items-center gap-1">
                                        <Globe className="h-3 w-3" />
                        {resolveOptionLabel(document.metadata?.jurisdiction ?? '', JURISDICTION_OPTIONS)}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Enhanced Processing Status */}
                                {document.status === 'processing' && documentStatuses.get(document.id) && (
                                  <div className="space-y-2">
                                    <div className="text-xs text-gray-600 dark:text-gray-400">
                                      {documentStatuses.get(document.id)?.message}
                                    </div>
                                    {documentStatuses.get(document.id)?.estimatedTimeRemaining && (
                                      <div className="text-xs text-blue-600 dark:text-blue-400">
                                        {documentStatuses.get(document.id)?.estimatedTimeRemaining}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {document.status !== 'processing' && document.status !== 'completed' && (
                                  <div className="space-y-2">
                                    <div className="text-xs text-gray-600 dark:text-gray-400">
                                      {document.status === 'error'
                                        ? document.processing_error || 'Document processing failed'
                                        : statusConfig.label}
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
                                      onClick={() => viewPdf(document)}
                                    >
                                      <Eye className="h-3 w-3 mr-1" />
                                      View
                                    </Button>
                                    {document.metadata?.embeddings_skipped ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleRetryProcessing(document)}
                                        disabled={retryingDocuments.has(document.id)}
                                        className="min-w-[120px] border-amber-300 text-amber-700 hover:bg-amber-50"
                                      >
                                        {retryingDocuments.has(document.id) ? (
                                          <>
                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                            Retrying...
                                          </>
                                        ) : (
                                          <>
                                            <RotateCcw className="h-3 w-3 mr-1" />
                                            Retry Embeddings
                                          </>
                                        )}
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        onClick={() => handleSetSearchModeDocument(document)}
                                      >
                                        <Sparkles className="h-3 w-3 mr-1" />
                                        Search Similar
                                      </Button>
                                    )}
                                  </>
                                )}

                                {document.status === 'error' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRetryProcessing(document)}
                                    disabled={retryingDocuments.has(document.id)}
                                    className="min-w-[96px]"
                                  >
                                    {retryingDocuments.has(document.id) ? (
                                      <>
                                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                        Retrying...
                                      </>
                                    ) : (
                                      'Retry Processing'
                                    )}
                                  </Button>
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
                                      onClick={() => downloadPdf(document)}
                                      className="flex items-center"
                                    >
                                      <Download className="h-4 w-4 mr-2" />
                                      Download PDF
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem 
                                      onClick={toggleSelectMode}
                                      className="flex items-center"
                                    >
                                      <CheckSquare className="h-4 w-4 mr-2" />
                                      Select Documents
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => setEditingDocument(document)}
                                      className="flex items-center"
                                    >
                                      <Edit className="h-4 w-4 mr-2" />
                                      Edit Details
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => openRenameDialog(document)}
                                      className="flex items-center"
                                    >
                                      <Edit2 className="h-4 w-4 mr-2" />
                                      Rename Document
                                    </DropdownMenuItem>
                                    
                                    {/* Cancel Processing Option */}
                                    {['queued', 'processing'].includes(document.status) && (() => {
                                      const isCancelling = cancellingDocuments.has(document.id)
                                      const isDialogOpen = cancelDialogOpen === document.id
                                      return (
                                        <>
                                          <DropdownMenuSeparator />
                                          <AlertDialog
                                            open={isDialogOpen}
                                            onOpenChange={(open) => {
                                              if (!open) {
                                                // Prevent closing when cancelling
                                                if (isCancelling) {
                                                  return
                                                }
                                                setCancelDialogOpen(null)
                                              } else {
                                                setCancelDialogOpen(document.id)
                                              }
                                            }}
                                          >
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
                                                  {isCancelling && (
                                                    <span className="block mt-2 text-orange-600 dark:text-orange-400">
                                                      Cancelling and cleaning up...
                                                    </span>
                                                  )}
                                                </AlertDialogDescription>
                                              </AlertDialogHeader>
                                              <AlertDialogFooter>
                                                <AlertDialogCancel disabled={isCancelling}>
                                                  Keep Processing
                                                </AlertDialogCancel>
                                                <Button
                                                  type="button"
                                                  onClick={() => handleCancelProcessing(document.id)}
                                                  disabled={isCancelling}
                                                  className="bg-orange-600 hover:bg-orange-700"
                                                >
                                                  {isCancelling ? (
                                                    <>
                                                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                      Cancelling...
                                                    </>
                                                  ) : (
                                                    'Cancel Processing'
                                                  )}
                                                </Button>
                                              </AlertDialogFooter>
                                            </AlertDialogContent>
                                          </AlertDialog>
                                        </>
                                      )
                                    })()}
                                    
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="flex items-center text-red-600 dark:text-red-400"
                                      onSelect={() => {
                                        setDeleteDialog({ document, isOpen: true, isDeleting: false })
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              {/* Pagination Controls */}
              {filteredDocuments.length > documentsPerPage && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t">
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredDocuments.length)} of {filteredDocuments.length} documents
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(1)}
                      disabled={currentPage === 1}
                      className="w-8 h-8 p-0"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="w-8 h-8 p-0"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        
                        return (
                          <Button
                            key={pageNum}
                            variant={currentPage === pageNum ? "default" : "outline"}
                            size="sm"
                            onClick={() => goToPage(pageNum)}
                            className="w-8 h-8 p-0"
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="w-8 h-8 p-0"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="w-8 h-8 p-0"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Document Metadata Modal */}
      <EditDocumentMetadataModal
        document={editingDocument}
        isOpen={!!editingDocument}
        onClose={() => setEditingDocument(null)}
        onSuccess={handleDocumentUpdate}
      />

      {/* Search Mode Modal */}
      <SearchModeModal
        isOpen={searchModeModal.isOpen}
        onClose={closeSearchModeModal}
        documentId={searchModeModal.document?.id || ''}
        documentTitle={searchModeModal.document?.title || ''}
        onSelectedSearchClick={handleSelectedSearchClick}
      />

      {/* Rename Document Dialog */}
      <AlertDialog
        open={renameDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (renameDialog.isRenaming) {
              return
            }
            closeRenameDialog()
          }
        }}
      >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rename Document</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new name for &quot;{renameDialog.document?.title}&quot;
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <Input
              value={renameDialog.newTitle}
              onChange={(e) => setRenameDialog(prev => ({ ...prev, newTitle: e.target.value }))}
              placeholder="Document title"
              disabled={renameDialog.isRenaming}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !renameDialog.isRenaming && renameDialog.newTitle.trim()) {
                  handleRenameDocument()
                }
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renameDialog.isRenaming}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              onClick={handleRenameDocument}
              disabled={renameDialog.isRenaming || !renameDialog.newTitle.trim()}
              className="min-w-[140px]"
            >
              {renameDialog.isRenaming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Renaming...
                </>
              ) : (
                'Rename Document'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Document Dialog */}
      <AlertDialog
        open={deleteDialog.isOpen}
        onOpenChange={open => {
          if (!open) {
            if (deleteDialog.isDeleting) {
              return
            }
            setDeleteDialog({ document: null, isOpen: false, isDeleting: false })
          }
        }}
      >
        <AlertDialogContent
          onKeyDown={event => {
            if (event.key === 'Enter' && !deleteDialog.isDeleting && deleteDialog.document) {
              event.preventDefault()
              deleteDocument(deleteDialog.document.id)
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialog.document
                ? `Are you sure you want to delete "${deleteDialog.document.title}"? This action cannot be undone.`
                : 'Are you sure you want to delete this document? This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDialog.isDeleting}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                if (!deleteDialog.document || deleteDialog.isDeleting) return
                deleteDocument(deleteDialog.document.id)
              }}
              disabled={deleteDialog.isDeleting}
              className="bg-red-600 hover:bg-red-700"
              autoFocus
            >
              {deleteDialog.isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Document'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default EnhancedDocumentList
const resolveOptionLabel = (
  value: string | null | undefined,
  options: ReadonlyArray<MetadataOption>
): string => {
  if (!value) {
    return ''
  }
  return options.find(option => option.value === value)?.label ?? value
}
