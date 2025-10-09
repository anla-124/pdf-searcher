'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Document } from '@/types'
import { OptimizedDocumentCard } from './optimized-document-card'

interface DocumentStatus {
  phase: string
  message: string
  estimatedTimeRemaining?: string
  processingMethod: 'sync' | 'batch'
  isStale?: boolean
}

interface VirtualDocumentListProps {
  documents: Document[]
  isSelectMode: boolean
  selectedDocuments: Set<string>
  selectedSearchSourceDocument: Document | null
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
  itemHeight?: number
  containerHeight?: number
  overscan?: number
}

export function VirtualDocumentList({
  documents,
  isSelectMode,
  selectedDocuments,
  selectedSearchSourceDocument,
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
  onToggleSelectMode,
  itemHeight = 120, // Approximate height of each document card
  containerHeight = 600, // Height of the scrollable container
  overscan = 5 // Number of items to render outside visible area
}: VirtualDocumentListProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const [isScrolling, setIsScrolling] = useState(false)
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Calculate visible range
  const visibleStart = Math.floor(scrollTop / itemHeight)
  const visibleEnd = Math.min(
    visibleStart + Math.ceil(containerHeight / itemHeight),
    documents.length - 1
  )

  // Add overscan for smoother scrolling
  const startIndex = Math.max(0, visibleStart - overscan)
  const endIndex = Math.min(documents.length - 1, visibleEnd + overscan)
  const visibleItems = documents.slice(startIndex, endIndex + 1)

  // Calculate offsets
  const offsetY = startIndex * itemHeight
  const totalHeight = documents.length * itemHeight

  // Handle scroll events
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop
    setScrollTop(scrollTop)
    setIsScrolling(true)

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Set scrolling to false after a delay
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false)
    }, 150)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Memoized handlers to prevent unnecessary re-renders
  const memoizedHandlers = useMemo(() => ({
    onToggleSelection,
    onViewPdf,
    onDownloadPdf,
    onSetEditingDocument,
    onOpenRenameDialog,
    onSetSearchModeDocument,
    onDeleteDocument,
    onCancelProcessing,
    onToggleSelectMode
  }), [
    onToggleSelection,
    onViewPdf,
    onDownloadPdf,
    onSetEditingDocument,
    onOpenRenameDialog,
    onSetSearchModeDocument,
    onDeleteDocument,
    onCancelProcessing,
    onToggleSelectMode
  ])

  // Scroll to specific document
  const _scrollToDocument = useCallback((documentId: string) => {
    const index = documents.findIndex(doc => doc.id === documentId)
    if (index !== -1 && scrollElementRef.current) {
      const targetScrollTop = index * itemHeight
      scrollElementRef.current.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      })
    }
  }, [documents, itemHeight])

  return (
    <div className="relative">
      {/* Virtual scrolling container */}
      <div
        ref={scrollElementRef}
        className="overflow-auto"
        style={{ height: containerHeight }}
        onScroll={handleScroll}
      >
        {/* Total height spacer */}
        <div style={{ height: totalHeight, position: 'relative' }}>
          {/* Visible items container */}
          <div
            style={{
              transform: `translateY(${offsetY}px)`,
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              width: '100%'
            }}
          >
            <div className="space-y-3">
              {visibleItems.map((document, index) => {
                const actualIndex = startIndex + index
                
                return (
                  <div
                    key={document.id}
                    style={{
                      minHeight: itemHeight,
                      // Maintain consistent height for proper virtual scrolling
                      height: 'auto'
                    }}
                    data-index={actualIndex}
                  >
                    <OptimizedDocumentCard
                      document={document}
                      isSelected={selectedDocuments.has(document.id)}
                      isSelectMode={isSelectMode}
                      isSearchSource={selectedSearchSourceDocument?.id === document.id}
                      deletingDocuments={deletingDocuments}
                      documentStatuses={documentStatuses}
                      {...memoizedHandlers}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Loading indicator when scrolling */}
      {isScrolling && documents.length > 100 && (
        <div className="absolute top-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <span>Scrolling...</span>
          </div>
        </div>
      )}

      {/* Scroll position indicator for large lists */}
      {documents.length > 50 && (
        <div className="absolute bottom-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border">
          {Math.min(endIndex + 1, documents.length)} of {documents.length}
        </div>
      )}
    </div>
  )
}

// Hook for managing virtual scrolling with search and filtering
export function useVirtualDocumentList(
  allDocuments: Document[],
  searchQuery: string,
  statusFilter: string,
  metadataFilters: {
    lawFirm: string[]
    fundManager: string[]
    fundAdmin: string[]
    jurisdiction: string[]
  }
) {
  // Filter documents based on search and filters
  const filteredDocuments = useMemo(() => {
    return allDocuments.filter(doc => {
      const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesStatus = statusFilter === 'all' || doc.status === statusFilter
      
      // Metadata filters
      const matchesLawFirm = metadataFilters.lawFirm.length === 0 || 
        (doc.metadata?.law_firm && metadataFilters.lawFirm.includes(doc.metadata.law_firm))
      
      const matchesFundManager = metadataFilters.fundManager.length === 0 || 
        (doc.metadata?.fund_manager && metadataFilters.fundManager.includes(doc.metadata.fund_manager))
      
      const matchesFundAdmin = metadataFilters.fundAdmin.length === 0 || 
        (doc.metadata?.fund_admin && metadataFilters.fundAdmin.includes(doc.metadata.fund_admin))
      
      const matchesJurisdiction = metadataFilters.jurisdiction.length === 0 || 
        (doc.metadata?.jurisdiction && metadataFilters.jurisdiction.includes(doc.metadata.jurisdiction))
      
      return matchesSearch && matchesStatus && matchesLawFirm && 
             matchesFundManager && matchesFundAdmin && matchesJurisdiction
    })
  }, [allDocuments, searchQuery, statusFilter, metadataFilters])

  // Sort documents
  const sortedDocuments = useMemo(() => {
    return [...filteredDocuments].sort((a, b) => {
      // Default sort by created_at descending
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [filteredDocuments])

  return {
    documents: sortedDocuments,
    totalCount: sortedDocuments.length
  }
}