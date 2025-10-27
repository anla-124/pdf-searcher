'use client'

import { useState } from 'react'
import { Document } from '@/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  ArrowDown,
  Layers
} from 'lucide-react'
import { formatUploadDate } from '@/lib/date-utils'

interface SimilarityScores {
  jaccard: number
  weightedBidir: number
  sizeRatio: number
  alpha: number
  final: number
  explanation: string
}

interface SectionMatch {
  docA_pageRange: string
  docB_pageRange: string
  avgScore: number
  chunkCount: number
  reusable: boolean
}

interface SimilarityResultV2 {
  document: Document
  scores: SimilarityScores
  matchedChunkCount: number
  sections: SectionMatch[]
}

interface SimilarityResultsV2Props {
  results: SimilarityResultV2[]
  sourceDocument: Document
  isLoading: boolean
}

export function SimilarityResultsV2({ results, sourceDocument, isLoading }: SimilarityResultsV2Props) {
  const [sortBy, setSortBy] = useState<string>('final_score')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  // selectedResult state removed - was only used by deleted SimilarityDetailsModal

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

  const getEffectiveChunkCount = (doc: Document): number | undefined => {
    const value = (doc as unknown as { effective_chunk_count?: number }).effective_chunk_count
    return typeof value === 'number' ? value : undefined
  }

  const sortResults = (results: SimilarityResultV2[]) => {
    const sorted = [...results].sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'final_score':
          comparison = a.scores.final - b.scores.final
          break
        case 'overlap':
          comparison = a.scores.jaccard - b.scores.jaccard
          break
        case 'match_rate':
          comparison = a.scores.weightedBidir - b.scores.weightedBidir
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
          comparison = a.scores.final - b.scores.final
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

      window.open(url, '_blank')

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
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">Running 3-stage similarity pipeline...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className="card-enhanced">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Enhanced Similarity Results
              </CardTitle>
              <CardDescription>
                Found {results.length} similar document{results.length !== 1 ? 's' : ''} to &quot;{sourceDocument.title}&quot;
              </CardDescription>
            </div>
            {results.length > 0 && (
              <div className="flex items-center gap-2">
                {results.length > 1 && (
                  <>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="Sort by..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="final_score">Coverage (Final)</SelectItem>
                        <SelectItem value="overlap">Overlap</SelectItem>
                        <SelectItem value="match_rate">Match Rate</SelectItem>
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
                  </>
                )}
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
                or removing filters to find more results.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {sortResults(results).map((result) => {
                const sourceChunks = getEffectiveChunkCount(sourceDocument)
                const candidateChunks = getEffectiveChunkCount(result.document)
                const largestChunkCount = Math.max(
                  sourceChunks ?? 0,
                  candidateChunks ?? 0,
                  result.matchedChunkCount
                )
                const coverageDenominatorLabel = largestChunkCount > 0 ? largestChunkCount : '—'

                return (
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
                              Coverage Score (Final)
                            </span>
                          </div>
                          <Badge className={`${getScoreBadgeColor(result.scores.final)} text-lg px-3 py-1`}>
                            {Number((result.scores.final * 100).toFixed(1))}%
                          </Badge>
                          {largestChunkCount > 0 && (
                            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                              Matched {result.matchedChunkCount} of {coverageDenominatorLabel} chunks in the larger document
                            </p>
                          )}
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
                    {/* Context Scores Row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Supporting Metrics:
                      </span>
                      <Badge variant="outline" className="text-xs">
                        Overlap (Jaccard): {Math.round(result.scores.jaccard * 100)}%
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Match Rate: {Math.round(result.scores.weightedBidir * 100)}%
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Size Ratio: {(result.scores.sizeRatio * 100).toFixed(0)}%
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Alpha (diag): {result.scores.alpha.toFixed(2)}
                      </Badge>
                      {largestChunkCount > 0 && (
                        <Badge variant="outline" className="text-xs">
                          Coverage: {result.matchedChunkCount}/{coverageDenominatorLabel} chunks
                        </Badge>
                      )}

                      {/* Details button removed - modal functionality deleted during cleanup */}
                      {/* <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                      >
                        <Info className="h-3 w-3 mr-1" />
                        <span className="text-xs">Details</span>
                      </Button> */}
                    </div>

                    {/* Section Matches */}
                    {result.sections.length > 0 && (
                      <div className="border-t pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Layers className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Matching Sections ({result.sections.length})
                          </span>
                        </div>
                        {/* SectionMatchesList component removed during cleanup */}
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {result.sections.length} matching sections found
                        </div>
                      </div>
                    )}

                    {/* Document metadata */}
                    <div className="space-y-3 border-t pt-4">
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatUploadDate(result.document.created_at)}
                        </span>
                        <span>{formatFileSize(result.document.file_size)}</span>
                        {formatPageCount(result.document.page_count) && (
                          <span>{formatPageCount(result.document.page_count)}</span>
                        )}
                        <span className="text-xs">
                          {result.matchedChunkCount} matched chunks
                        </span>
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
                    </div>
                  </CardContent>
                </Card>
              )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Similarity Details Modal removed during cleanup */}
      {/* Modal can be re-added if detailed view is needed */}
    </>
  )
}
