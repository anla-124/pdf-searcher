'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ArrowRight, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react'
import { clientLogger } from '@/lib/client-logger'

interface SectionMatch {
  docA_pageRange: string
  docB_pageRange: string
  avgScore: number
  chunkCount: number
  reusable: boolean
}

interface SectionMatchesListProps {
  sections: SectionMatch[]
}

export function SectionMatchesList({
  sections
}: SectionMatchesListProps) {
  const getScoreColor = (score: number) => {
    if (score >= 0.95) return 'text-green-600 dark:text-green-400'
    if (score >= 0.90) return 'text-blue-600 dark:text-blue-400'
    if (score >= 0.85) return 'text-orange-600 dark:text-orange-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getScoreBgColor = (score: number) => {
    if (score >= 0.95) return 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
    if (score >= 0.90) return 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
    if (score >= 0.85) return 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800'
    return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
  }

  const openDraftableComparison = (section: SectionMatch) => {
    // TODO: Implement Draftable integration
    // For now, just open both documents in new tabs
    clientLogger.info('Opening Draftable comparison for section', section)
    alert(`Draftable integration coming soon!\n\nWill compare:\nSource pages ${section.docA_pageRange} with Target pages ${section.docB_pageRange}`)
  }

  if (sections.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
        No section-level matches detected
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sections.map((section, index) => (
        <Card
          key={index}
          className={`p-3 border ${getScoreBgColor(section.avgScore)} transition-all hover:shadow-md`}
        >
          <div className="flex items-center justify-between gap-4">
            {/* Section Page Ranges */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Reusability Indicator */}
              <div className="flex-shrink-0">
                {section.reusable ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                )}
              </div>

              {/* Page Ranges */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Your Pages:
                  </span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {section.docA_pageRange}
                  </Badge>
                </div>

                <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Their Pages:
                  </span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {section.docB_pageRange}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Score and Stats */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Stats */}
              <div className="text-right hidden sm:block">
                <p className={`text-sm font-bold ${getScoreColor(section.avgScore)}`}>
                  {Math.round(section.avgScore * 100)}%
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {section.chunkCount} chunks
                </p>
              </div>

              {/* Reusability Badge */}
              <Badge
                variant={section.reusable ? 'default' : 'secondary'}
                className={section.reusable
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-orange-500 text-white hover:bg-orange-600'
                }
              >
                {section.reusable ? 'Reusable' : 'Review'}
              </Badge>

              {/* Compare Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => openDraftableComparison(section)}
                className="h-8 text-xs"
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Compare
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {/* Summary Footer */}
      <div className="flex items-center justify-between pt-2 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-4">
          <span>
            <strong>{sections.filter(s => s.reusable).length}</strong> reusable sections
          </span>
          <span>
            <strong>{sections.reduce((sum, s) => sum + s.chunkCount, 0)}</strong> total matching chunks
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3 w-3 text-green-600" />
          <span className="text-xs">≥85% similarity = Reusable</span>
        </div>
      </div>
    </div>
  )
}
