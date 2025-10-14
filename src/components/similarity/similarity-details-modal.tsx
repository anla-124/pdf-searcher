'use client'

import { Document } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { TrendingUp, Percent, Scale, Sigma, Info } from 'lucide-react'

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

interface SimilarityDetailsModalProps {
  result: SimilarityResultV2
  sourceDocument: Document
  isOpen: boolean
  onClose: () => void
}

export function SimilarityDetailsModal({
  result,
  sourceDocument,
  isOpen,
  onClose
}: SimilarityDetailsModalProps) {
  const { scores } = result
  const sourceChunks = (sourceDocument as unknown as { effective_chunk_count?: number }).effective_chunk_count
  const targetChunks = (result.document as unknown as { effective_chunk_count?: number }).effective_chunk_count
  const largestChunkCount = Math.max(
    sourceChunks ?? 0,
    targetChunks ?? 0,
    result.matchedChunkCount
  )
  const coverageDenominatorLabel = largestChunkCount > 0 ? largestChunkCount : '—'
  const coveragePercentLabel = (scores.final * 100).toFixed(1)

  const getScoreColor = (score: number) => {
    if (score >= 0.9) return 'text-green-600 dark:text-green-400'
    if (score >= 0.8) return 'text-blue-600 dark:text-blue-400'
    if (score >= 0.7) return 'text-orange-600 dark:text-orange-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getBadgeColor = (score: number) => {
    if (score >= 0.9) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    if (score >= 0.8) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
    if (score >= 0.7) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
    return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Similarity Score Breakdown
          </DialogTitle>
          <DialogDescription>
            Detailed analysis comparing &quot;{sourceDocument.title}&quot; with &quot;{result.document.title}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Final Score Card */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-2 border-blue-200 dark:border-blue-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-600 dark:bg-blue-500 rounded-lg">
                    <TrendingUp className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                      Coverage Score (Final)
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                      Portion of the larger document covered by matched chunks
                    </p>
                  </div>
                </div>
                <Badge className={`${getBadgeColor(scores.final)} text-2xl px-4 py-2`}>
                  {Number(coveragePercentLabel)}%
                </Badge>
              </div>
              {largestChunkCount > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                  Matched {result.matchedChunkCount} of {coverageDenominatorLabel} chunks in the larger document
                </p>
              )}
            </CardContent>
          </Card>

          {/* Component Scores */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Jaccard Score */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded">
                    <Percent className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Jaccard Similarity (Overlap)
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      Proportional reusable content
                    </p>
                  </div>
                  <span className={`text-xl font-bold ${getScoreColor(scores.jaccard)}`}>
                    {Math.round(scores.jaccard * 100)}%
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-2 rounded">
                  <strong>Formula:</strong> matched_pairs / (total_chunks_A + total_chunks_B - matched_pairs)
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                  Best for: Identifying what % of content is reusable across documents
                </p>
              </CardContent>
            </Card>

            {/* Weighted Bidirectional Score */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-green-100 dark:bg-green-900/50 rounded">
                    <Scale className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Weighted Bidirectional
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      Average match rate
                    </p>
                  </div>
                  <span className={`text-xl font-bold ${getScoreColor(scores.weightedBidir)}`}>
                    {Math.round(scores.weightedBidir * 100)}%
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-2 rounded">
                  <strong>Formula:</strong> (rate_A→B × len_A + rate_B→A × len_B) / (len_A + len_B)
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                  Best for: Understanding overall matching strength between documents
                </p>
              </CardContent>
            </Card>
          </div>

          <Separator />

          {/* Adaptive Weighting Parameters */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <Sigma className="h-4 w-4" />
              Adaptive Weighting Parameters
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Size Ratio */}
              <Card className="bg-gray-50 dark:bg-gray-800/50">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Size Ratio (s)
                    </p>
                    <Badge variant="outline" className="font-mono">
                      {(scores.sizeRatio * 100).toFixed(1)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    s = min(effective_chunks) / max(effective_chunks)
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    {scores.sizeRatio >= 0.8
                      ? '✓ Similar sized documents'
                      : scores.sizeRatio >= 0.5
                      ? '○ Moderate size difference'
                      : '▲ Large size difference'}
                  </p>
                </CardContent>
              </Card>

              {/* Alpha Weight */}
              <Card className="bg-gray-50 dark:bg-gray-800/50">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Alpha Weight (α)
                    </p>
                    <Badge variant="outline" className="font-mono">
                      {scores.alpha.toFixed(3)}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    α = clip(s², 0.15, 0.95) · retained for diagnostics
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Higher α still signals similar document lengths (legacy blend insight only)
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <Separator />

          {/* Formula Explanation */}
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">
              How the Final Score is Calculated
            </h3>
            <div className="space-y-2">
              <p className="text-sm text-blue-800 dark:text-blue-300 font-mono bg-white dark:bg-blue-950/50 p-2 rounded">
                Final = matched_chunks ÷ max(chunks_source, chunks_candidate)
              </p>
              <p className="text-sm text-blue-800 dark:text-blue-300 font-mono bg-white dark:bg-blue-950/50 p-2 rounded">
                Final = {result.matchedChunkCount} ÷ {coverageDenominatorLabel} = {coveragePercentLabel}%
              </p>
              <p className="text-sm text-blue-800 dark:text-blue-300 bg-white dark:bg-blue-950/50 p-2 rounded">
                Supporting metrics · Overlap {(scores.jaccard * 100).toFixed(1)}% · Match Rate {(scores.weightedBidir * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Detailed Explanation */}
          <Card className="bg-gray-50 dark:bg-gray-800/50">
            <CardContent className="pt-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Interpretation
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {scores.explanation}
              </p>
            </CardContent>
          </Card>

          {/* Statistics */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Matched Chunks</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {result.matchedChunkCount}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Matching Sections</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {result.sections.length}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
