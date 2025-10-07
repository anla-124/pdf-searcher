'use client'

import { useState, useEffect } from 'react'
import { Document } from '@/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  FileText, 
  Search, 
  CheckSquare, 
  Square,
  Sparkles,
  AlertTriangle,
  Loader2,
  TrendingUp,
  Eye,
  Download,
  Calendar,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { formatUploadDate } from '@/lib/date-utils'

interface SelectedSearchInterfaceProps {
  sourceDocument: Document | null
  autoSearchTargets?: string[]
}

interface SimilarityResult {
  document: Document
  score: number
  matching_chunks: Array<{ text: string; score: number }>
}

export function SelectedSearchInterface({ sourceDocument, autoSearchTargets }: SelectedSearchInterfaceProps) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isComparing, setIsComparing] = useState(false)
  const [results, setResults] = useState<SimilarityResult[]>([])
  const [sortBy, setSortBy] = useState<string>('similarity')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Fetch all completed documents
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const response = await fetch('/api/documents')
        if (!response.ok) {
          throw new Error('Failed to fetch documents')
        }
        const data = await response.json()
        const completedDocs = (data.documents || []).filter((doc: Document) => 
          doc.status === 'completed' && 
          !doc.metadata?.embeddings_skipped &&
          doc.id !== sourceDocument?.id // Exclude source document
        )
        setDocuments(completedDocs)
      } catch (error) {
        console.error('Error fetching documents:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDocuments()
  }, [sourceDocument?.id])

  // Auto-run search if target documents are provided in URL
  useEffect(() => {
    if (autoSearchTargets && autoSearchTargets.length > 0 && sourceDocument && !isLoading) {
      // Set the selected documents to the provided targets
      setSelectedDocuments(new Set(autoSearchTargets))
      
      // Automatically run the comparison
      const runAutoSearch = async () => {
        setIsComparing(true)

        try {
          const response = await fetch('/api/documents/selected-search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sourceDocumentId: sourceDocument.id,
              targetDocumentIds: autoSearchTargets
            }),
          })

          if (!response.ok) {
            throw new Error('Failed to compare documents')
          }

          const data = await response.json()
          setResults(data)
        } catch (error) {
          console.error('Auto-search failed:', error)
        } finally {
          setIsComparing(false)
        }
      }

      runAutoSearch()
    }
  }, [autoSearchTargets, sourceDocument, isLoading])

  // Filter documents based on search query
  const filteredDocuments = documents.filter(doc =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const toggleDocumentSelection = (documentId: string) => {
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

  const deselectAllDocuments = () => {
    setSelectedDocuments(new Set())
  }

  const handleCompareDocuments = async () => {
    if (!sourceDocument || selectedDocuments.size === 0) return

    setIsComparing(true)

    try {
      const response = await fetch('/api/documents/selected-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceDocumentId: sourceDocument.id,
          targetDocumentIds: Array.from(selectedDocuments)
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to compare documents')
      }

      const data = await response.json()
      setResults(data)
    } catch (error) {
      console.error('Error comparing documents:', error)
      alert('Failed to compare documents. Please try again.')
    } finally {
      setIsComparing(false)
    }
  }

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

  const sortResults = (results: SimilarityResult[]) => {
    const sorted = [...results].sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'similarity':
          comparison = a.score - b.score
          break
        case 'upload_time':
          comparison = new Date(a.document.created_at).getTime() - new Date(b.document.created_at).getTime()
          break
        case 'name':
          comparison = a.document.title.localeCompare(b.document.title)
          break
        case 'size':
          comparison = a.document.file_size - b.document.file_size
          break
        default:
          comparison = a.score - b.score
      }
      
      return sortOrder === 'asc' ? comparison : -comparison
    })
    return sorted
  }

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
  }


  const getScoreBadgeColor = (score: number) => {
    if (score >= 0.9) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    if (score >= 0.8) return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
    if (score >= 0.7) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
    return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
  }

  const downloadPdf = async (document: Document) => {
    try {
      const response = await fetch(`/api/documents/${document.id}/download`)
      
      if (!response.ok) {
        throw new Error('Failed to download document')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.filename
      window.document.body.appendChild(link)
      link.click()
      window.document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error downloading document:', error)
      alert('Failed to download document. Please try again.')
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
      
      // Open PDF in a new tab
      window.open(url, '_blank')
      
      // Clean up the URL after a short delay to allow the browser to load it
      setTimeout(() => {
        window.URL.revokeObjectURL(url)
      }, 1000)
    } catch (error) {
      console.error('Error viewing document:', error)
      alert('Failed to open document. Please try again.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Conditional Rendering: Document Selection (only if NOT auto-searching) OR Results */}
      {!autoSearchTargets ? (
        /* Document Selection */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Select Documents to Compare
                </CardTitle>
                <CardDescription>
                  Choose which documents to compare with {sourceDocument ? `"${sourceDocument.title}"` : 'the source document'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {selectedDocuments.size} selected
                </Badge>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={selectAllDocuments}
                  disabled={filteredDocuments.length === 0}
                >
                  Select All ({filteredDocuments.length})
                </Button>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={deselectAllDocuments}
                  disabled={selectedDocuments.size === 0}
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search documents by title or filename..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Document List */}
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">Loading documents...</span>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {searchQuery ? 'No documents found' : 'No documents available'}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {searchQuery 
                    ? 'Try adjusting your search terms'
                    : 'No completed documents available for comparison'
                  }
                </p>
              </div>
            ) : (
              <div className="grid gap-3 max-h-96 overflow-y-auto">
                {filteredDocuments.map((document) => (
                  <div
                    key={document.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                      selectedDocuments.has(document.id)
                        ? 'border-purple-300 bg-purple-50 dark:border-purple-600 dark:bg-purple-950/20'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                    }`}
                    onClick={() => toggleDocumentSelection(document.id)}
                  >
                    <div className="flex-shrink-0">
                      {selectedDocuments.has(document.id) ? (
                        <CheckSquare className="h-5 w-5 text-purple-600" />
                      ) : (
                        <Square className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
                      <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {document.title}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                        {document.filename}
                      </p>
                    </div>
                    <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                      <div>{formatFileSize(document.file_size)}</div>
                      <div>{formatUploadDate(document.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Compare Button */}
            <div className="flex justify-center pt-4">
              <Button
                onClick={handleCompareDocuments}
                disabled={!sourceDocument || selectedDocuments.size === 0 || isComparing}
                size="lg"
                className="min-w-48"
              >
                {isComparing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Comparing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Compare {selectedDocuments.size} Document{selectedDocuments.size !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Results Section - Always show when auto-searching */
        <Card className="card-enhanced">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Search Results
                </CardTitle>
                <CardDescription>
                  Found {results.length} similar document{results.length !== 1 ? 's' : ''} to &quot;{sourceDocument?.title}&quot;
                </CardDescription>
              </div>
              {results.length > 1 && (
                <div className="flex items-center gap-2">
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Sort by..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="similarity">Similarity</SelectItem>
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
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isComparing ? (
              <div className="flex items-center justify-center p-12">
                <div className="animate-pulse flex flex-col items-center">
                  <Sparkles className="h-12 w-12 text-purple-500 mb-4 animate-spin" />
                  <p className="text-gray-600 dark:text-gray-400">Searching for similar documents...</p>
                </div>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-12">
                <AlertTriangle className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  No Similar Documents Found
                </h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  The selected documents do not meet the similarity threshold with the source document.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {sortResults(results).map((result, _index) => (
                  <Card key={result.document.id} className="border-l-4 border-l-purple-500">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
                            <FileText className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                          </div>
                          <div>
                            <CardTitle className="text-lg">
                              {result.document.title}
                            </CardTitle>
                            <CardDescription className="mt-1">
                              {result.document.filename}
                            </CardDescription>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="flex items-center gap-2 mb-1">
                              <TrendingUp className="h-4 w-4 text-gray-400" />
                              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                Similarity
                              </span>
                            </div>
                            <Badge className={getScoreBadgeColor(result.score)}>
                              {Math.round(result.score * 100)}%
                            </Badge>
                          </div>
                          
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => viewPdf(result.document)}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View PDF
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => downloadPdf(result.document)}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      {/* Progress bar */}
                      <div>
                        <Progress value={result.score * 100} className="h-2" />
                      </div>

                      {/* Document metadata */}
                      <div className="space-y-3">
                        {/* Basic document info */}
                        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatUploadDate(result.document.created_at)}
                          </span>
                          <span>{formatFileSize(result.document.file_size)}</span>
                          {formatPageCount(result.document.page_count) && (
                            <span>{formatPageCount(result.document.page_count)}</span>
                          )}
                        </div>

                        {/* Business metadata */}
                        {(result.document.metadata?.law_firm || 
                          result.document.metadata?.fund_manager || 
                          result.document.metadata?.fund_admin || 
                          result.document.metadata?.jurisdiction) && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Business Details:</span>
                            {result.document.metadata?.law_firm && result.document.metadata.law_firm !== 'N/A' && (
                              <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800">
                                📋 {result.document.metadata.law_firm}
                              </Badge>
                            )}
                            {result.document.metadata?.fund_manager && result.document.metadata.fund_manager !== 'N/A' && (
                              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800">
                                💼 {result.document.metadata.fund_manager}
                              </Badge>
                            )}
                            {result.document.metadata?.fund_admin && result.document.metadata.fund_admin !== 'N/A' && (
                              <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800">
                                🏢 {result.document.metadata.fund_admin}
                              </Badge>
                            )}
                            {result.document.metadata?.jurisdiction && result.document.metadata.jurisdiction !== 'N/A' && (
                              <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800">
                                🌍 {result.document.metadata.jurisdiction}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Legacy metadata (if any) */}
                        {(result.document.metadata?.investor_type || result.document.metadata?.document_type) && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Other:</span>
                            {result.document.metadata?.investor_type && (
                              <Badge variant="outline" className="text-xs">
                                {result.document.metadata.investor_type}
                              </Badge>
                            )}
                            {result.document.metadata?.document_type && (
                              <Badge variant="outline" className="text-xs">
                                {result.document.metadata.document_type}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}