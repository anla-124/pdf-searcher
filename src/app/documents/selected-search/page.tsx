import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Document as AppDocument } from '@/types'
import { DashboardLayout } from '@/components/dashboard/layout'
import { SelectedSearchInterface } from '@/components/similarity/selected-search-interface'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, FileText, Users, Target } from 'lucide-react'
import { formatUploadDate } from '@/lib/date-utils'

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function SelectedSearchPage({ searchParams }: PageProps) {
  const params = await searchParams
  const idsParam = typeof params['ids'] === 'string' ? params['ids'] : undefined
  
  // New logic: derive source and targets from a single 'ids' parameter
  let sourceId: string | undefined = undefined
  let targetIds: string[] = []

  if (idsParam) {
    const allIds = idsParam.split(',')
    if (allIds.length > 0) {
      sourceId = allIds[0] // First document is the source
    }
    if (allIds.length > 1) {
      targetIds = allIds.slice(1) // The rest are targets
    }
  }
  
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the source document if provided
  let sourceDocument: AppDocument | null = null
  if (sourceId) {
    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', sourceId)
      .eq('user_id', user.id)
      .single<AppDocument>()

    if (!error && document?.status === 'completed') {
      sourceDocument = document
    }
  }

  // If we have both source and targets, show auto-search results
  // Otherwise, show the selection interface
  const shouldAutoSearch = sourceDocument && targetIds.length > 0

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div className="h-6 border-l border-gray-300 dark:border-gray-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Users className="h-6 w-6 text-purple-500" />
                Selected Search
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {shouldAutoSearch ? 'Automatic similarity comparison results' : 'Compare specific documents for debugging similarity algorithm'}
              </p>
            </div>
          </div>
        </div>

        {/* Source Document Card */}
        {sourceDocument && (
          <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-purple-900 dark:text-purple-100">
                <Target className="h-5 w-5" />
                Source Document
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
                    <FileText className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {sourceDocument.title}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {sourceDocument.filename}
                      </p>
                    </div>
                    
                    {/* Basic document info */}
                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                      <span>{formatFileSize(sourceDocument.file_size)}</span>
                      <span>{formatUploadDate(sourceDocument.created_at)}</span>
                      {sourceDocument.page_count && (
                        <span>{sourceDocument.page_count === 1 ? '1 page' : `${sourceDocument.page_count} pages`}</span>
                      )}
                    </div>

                    {/* Business metadata */}
                    {(sourceDocument.metadata?.law_firm || 
                      sourceDocument.metadata?.fund_manager || 
                      sourceDocument.metadata?.fund_admin || 
                      sourceDocument.metadata?.jurisdiction) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Business Details:</span>
                        {sourceDocument.metadata?.law_firm && sourceDocument.metadata.law_firm !== 'N/A' && (
                          <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800">
                            📋 {sourceDocument.metadata.law_firm}
                          </Badge>
                        )}
                        {sourceDocument.metadata?.fund_manager && sourceDocument.metadata.fund_manager !== 'N/A' && (
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800">
                            💼 {sourceDocument.metadata.fund_manager}
                          </Badge>
                        )}
                        {sourceDocument.metadata?.fund_admin && sourceDocument.metadata.fund_admin !== 'N/A' && (
                          <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800">
                            🏢 {sourceDocument.metadata.fund_admin}
                          </Badge>
                        )}
                        {sourceDocument.metadata?.jurisdiction && sourceDocument.metadata.jurisdiction !== 'N/A' && (
                          <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800">
                            🌍 {sourceDocument.metadata.jurisdiction}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Legacy metadata (if any) */}
                    {(sourceDocument.metadata?.investor_type || sourceDocument.metadata?.document_type) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Other:</span>
                        {sourceDocument.metadata?.investor_type && (
                          <Badge variant="outline" className="text-xs">
                            {sourceDocument.metadata.investor_type}
                          </Badge>
                        )}
                        {sourceDocument.metadata?.document_type && (
                          <Badge variant="outline" className="text-xs">
                            {sourceDocument.metadata.document_type}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search Interface and Results */}
        <SelectedSearchInterface 
          sourceDocument={sourceDocument} 
          autoSearchTargets={shouldAutoSearch ? targetIds : []}
        />
      </div>
    </DashboardLayout>
  )
}
