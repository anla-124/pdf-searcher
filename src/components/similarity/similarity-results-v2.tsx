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
  Download,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Eye,
  ArrowUp,
  ArrowDown,
  Building,
  Users,
  Briefcase,
  Globe,
  GitCompare
} from 'lucide-react'
import { formatUploadDate } from '@/lib/date-utils'

interface SimilarityScores {
  sourceScore: number
  targetScore: number
  overlapScore: number
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
  maxResults?: number
}

export function SimilarityResultsV2({ results, sourceDocument, isLoading, maxResults }: SimilarityResultsV2Props) {
  const [sortBy, setSortBy] = useState<string>('source_score')
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

  const getCreatedAtTime = (doc: Document) => {
    const timestamp = new Date(doc.created_at).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  const compareScoreHierarchy = (a: SimilarityResultV2, b: SimilarityResultV2) => {
    const tolerance = 0.000001
    const sourceDiff = a.scores.sourceScore - b.scores.sourceScore
    if (Math.abs(sourceDiff) > tolerance) return sourceDiff

    const targetDiff = a.scores.targetScore - b.scores.targetScore
    if (Math.abs(targetDiff) > tolerance) return targetDiff

    const overlapDiff = a.scores.overlapScore - b.scores.overlapScore
    if (Math.abs(overlapDiff) > tolerance) return overlapDiff

    const uploadDiff = getCreatedAtTime(a.document) - getCreatedAtTime(b.document)
    if (uploadDiff !== 0) return uploadDiff

    // Final deterministic tie-breaker by document title then id
    const titleDiff = a.document.title.localeCompare(b.document.title)
    if (titleDiff !== 0) return titleDiff

    return a.document.id.localeCompare(b.document.id)
  }

  const sortResults = (results: SimilarityResultV2[]) => {
    const sorted = [...results].sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'target_score':
          comparison = a.scores.targetScore - b.scores.targetScore
          break
        case 'source_score':
          comparison = compareScoreHierarchy(a, b)
          break
        case 'overlap_score':
          comparison = a.scores.overlapScore - b.scores.overlapScore
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
          comparison = a.scores.targetScore - b.scores.targetScore
      }

      if (comparison === 0) {
        comparison = compareScoreHierarchy(a, b)
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })
    const limit = Number.isFinite(maxResults ?? NaN) && (maxResults ?? 0) > 0
      ? Math.min(sorted.length, Math.floor(maxResults ?? 0))
      : sorted.length
    return sorted.slice(0, limit)
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

  const sortedResults = sortResults(results)
  const visibleCount = sortedResults.length
  const totalResults = results.length

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
                Similarity Results
              </CardTitle>
              <CardDescription>
                Showing {visibleCount} of {totalResults} similar document{totalResults !== 1 ? 's' : ''} to &quot;{sourceDocument.title}&quot;
              </CardDescription>
            </div>
            {totalResults > 0 && (
              <div className="flex items-center gap-2">
                {totalResults > 1 && (
                  <>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="Sort by..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="source_score">Source Score</SelectItem>
                        <SelectItem value="target_score">Target Score</SelectItem>
                        <SelectItem value="overlap_score">Overlap</SelectItem>
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
          {totalResults === 0 ? (
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
            <div className="space-y-4">
              {sortedResults.map(result => (
                <Card key={result.document.id} className="border border-blue-100 dark:border-blue-900">
                  <div className="flex flex-col gap-3 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                          <FileText className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="space-y-2">
                          <div>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                              {result.document.title}
                            </h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                            <span>{formatFileSize(result.document.file_size)}</span>
                            <span>{formatUploadDate(result.document.created_at)}</span>
                            {formatPageCount(result.document.page_count) && (
                              <span>{formatPageCount(result.document.page_count)}</span>
                            )}
                          </div>
                          {(result.document.metadata?.law_firm ||
                            result.document.metadata?.fund_manager ||
                            result.document.metadata?.fund_admin ||
                            result.document.metadata?.jurisdiction) && (
                            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
                              {result.document.metadata?.law_firm && (
                                <div className="flex items-center gap-1">
                                  <Building className="h-3 w-3" />
                                  {result.document.metadata.law_firm}
                                </div>
                              )}
                              {result.document.metadata?.fund_manager && (
                                <div className="flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  {result.document.metadata.fund_manager}
                                </div>
                              )}
                              {result.document.metadata?.fund_admin && (
                                <div className="flex items-center gap-1">
                                  <Briefcase className="h-3 w-3" />
                                  {result.document.metadata.fund_admin}
                                </div>
                              )}
                              {result.document.metadata?.jurisdiction && (
                                <div className="flex items-center gap-1">
                                  <Globe className="h-3 w-3" />
                                  {result.document.metadata.jurisdiction}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            <Badge variant="outline" className="text-xs">
                              Target: {Math.round(result.scores.targetScore * 100)}%
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              Overlap: {Math.round(result.scores.overlapScore * 100)}%
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-start sm:items-end gap-2 min-w-[220px]">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-gray-400" />
                          <Badge className={`${getScoreBadgeColor(result.scores.sourceScore)} text-base px-3 py-1`}>
                            {Number((result.scores.sourceScore * 100).toFixed(1))}%
                          </Badge>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => viewPdf(result.document)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadPdf(result.document)}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </Button>
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white focus-visible:ring-blue-400"
                          >
                            <GitCompare className="h-4 w-4 mr-1 text-white" />
                            Compare with Draftable
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Similarity Details Modal removed during cleanup */}
      {/* Modal can be re-added if detailed view is needed */}
    </>
  )
}
