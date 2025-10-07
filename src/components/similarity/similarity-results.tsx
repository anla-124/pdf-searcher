'use client'

import { useState } from 'react'
import { Document, SimilaritySearchResult } from '@/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Search, 
  FileText, 
  Calendar, 
  Download,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Eye,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { formatUploadDate } from '@/lib/date-utils'

interface SimilarityResultsProps {
  results: SimilaritySearchResult[]
  sourceDocument: Document
  isLoading: boolean
}

export function SimilarityResults({ results, sourceDocument, isLoading }: SimilarityResultsProps) {
  const [sortBy, setSortBy] = useState<string>('similarity')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

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

  const sortResults = (results: SimilaritySearchResult[]) => {
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
    if (score >= 0.8) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
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

  if (isLoading) {
    return (
      <Card className="card-enhanced">
        <CardContent className="flex items-center justify-center p-12">
          <div className="animate-pulse flex flex-col items-center">
            <Sparkles className="h-12 w-12 text-blue-500 mb-4 animate-spin" />
            <p className="text-gray-600 dark:text-gray-400">Searching for similar documents...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="card-enhanced">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search Results
            </CardTitle>
            <CardDescription>
              Found {results.length} similar document{results.length !== 1 ? 's' : ''} to &quot;{sourceDocument.title}&quot;
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
        {results.length === 0 ? (
          <div className="text-center py-12">
            <AlertTriangle className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              No Similar Documents Found
            </h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Try adjusting your search parameters, lowering the minimum similarity threshold, 
              or removing filters to search more results.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortResults(results).map((result, _index) => (
              <Card key={result.document.id} className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                        <FileText className="h-6 w-6 text-blue-600 dark:text-blue-400" />
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
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800">
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
  )
}