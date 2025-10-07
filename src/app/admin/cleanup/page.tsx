'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Trash2, Search, CheckCircle, RefreshCw } from 'lucide-react'

interface OrphanedData {
  totalOrphaned: number
  details: {
    orphanedJobs: any[]
    orphanedEmbeddings: any[]
    orphanedProcessingStatus: any[]
    orphanedExtractedFields: any[]
  }
  timestamp: string
}

interface CleanupSummary {
  jobsCancelled: number
  embeddingsDeleted: number
  statusRecordsDeleted: number
  extractedFieldsDeleted: number
  errors: string[]
}

export default function OrphanedCleanupPage() {
  const [orphanedData, setOrphanedData] = useState<OrphanedData | null>(null)
  const [cleanupSummary, setCleanupSummary] = useState<CleanupSummary | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isCleaning, setIsCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkOrphanedProcessing = async () => {
    setIsChecking(true)
    setError(null)
    
    try {
      const response = await fetch('/api/admin/cleanup-orphaned')
      if (!response.ok) {
        throw new Error('Failed to check orphaned processing')
      }
      
      const data = await response.json()
      setOrphanedData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsChecking(false)
    }
  }

  const cleanupOrphanedProcessing = async () => {
    setIsCleaning(true)
    setError(null)
    
    try {
      const response = await fetch('/api/admin/cleanup-orphaned', {
        method: 'DELETE'
      })
      
      if (!response.ok) {
        throw new Error('Failed to cleanup orphaned processing')
      }
      
      const data = await response.json()
      setCleanupSummary(data.summary)
      
      // Refresh the check after cleanup
      await checkOrphanedProcessing()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsCleaning(false)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Orphaned Processing Cleanup</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Check for and clean up processing operations from deleted documents
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center">
            <AlertTriangle className="h-4 w-4 text-red-600 mr-2" />
            <span className="text-red-800 dark:text-red-200">{error}</span>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Check Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Check for Orphaned Processing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Scan for processing operations that are still running for documents that have been deleted.
              </p>
              
              <Button 
                onClick={checkOrphanedProcessing}
                disabled={isChecking}
                className="flex items-center gap-2"
              >
                {isChecking ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {isChecking ? 'Checking...' : 'Check for Orphaned Operations'}
              </Button>

              {orphanedData && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">Scan Results</h3>
                    <Badge variant={orphanedData.totalOrphaned > 0 ? "destructive" : "secondary"}>
                      {orphanedData.totalOrphaned} Total Orphaned
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="font-medium text-orange-600">Jobs</div>
                      <div>{orphanedData.details.orphanedJobs.length}</div>
                    </div>
                    <div>
                      <div className="font-medium text-blue-600">Embeddings</div>
                      <div>{orphanedData.details.orphanedEmbeddings.length}</div>
                    </div>
                    <div>
                      <div className="font-medium text-purple-600">Status Records</div>
                      <div>{orphanedData.details.orphanedProcessingStatus.length}</div>
                    </div>
                    <div>
                      <div className="font-medium text-green-600">Extracted Fields</div>
                      <div>{orphanedData.details.orphanedExtractedFields.length}</div>
                    </div>
                  </div>
                  
                  <div className="mt-3 text-xs text-gray-500">
                    Last checked: {new Date(orphanedData.timestamp).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cleanup Section */}
        {orphanedData && orphanedData.totalOrphaned > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                Clean Up Orphaned Processing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Remove orphaned processing operations to free up resources and prevent background processing.
                </p>
                
                <div className="p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-md">
                  <div className="flex items-center">
                    <AlertTriangle className="h-4 w-4 text-orange-600 mr-2" />
                    <span className="text-sm font-medium text-orange-800 dark:text-orange-200">
                      This will cancel {orphanedData.details.orphanedJobs.length} active jobs and clean up {orphanedData.totalOrphaned - orphanedData.details.orphanedJobs.length} orphaned records
                    </span>
                  </div>
                </div>
                
                <Button 
                  onClick={cleanupOrphanedProcessing}
                  disabled={isCleaning}
                  variant="destructive"
                  className="flex items-center gap-2"
                >
                  {isCleaning ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {isCleaning ? 'Cleaning up...' : 'Clean Up Orphaned Operations'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cleanup Results */}
        {cleanupSummary && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Cleanup Complete
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="font-medium text-orange-600">Jobs Cancelled</div>
                    <div>{cleanupSummary.jobsCancelled}</div>
                  </div>
                  <div>
                    <div className="font-medium text-blue-600">Embeddings Deleted</div>
                    <div>{cleanupSummary.embeddingsDeleted}</div>
                  </div>
                  <div>
                    <div className="font-medium text-purple-600">Status Records Deleted</div>
                    <div>{cleanupSummary.statusRecordsDeleted}</div>
                  </div>
                  <div>
                    <div className="font-medium text-green-600">Fields Deleted</div>
                    <div>{cleanupSummary.extractedFieldsDeleted}</div>
                  </div>
                </div>
                
                {cleanupSummary.errors.length > 0 && (
                  <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md">
                    <div className="font-medium text-red-800 dark:text-red-200 mb-2">Errors:</div>
                    <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
                      {cleanupSummary.errors.map((error, index) => (
                        <li key={index}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}