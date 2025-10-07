'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Database, Copy, CheckCircle, ExternalLink } from 'lucide-react'

export default function FixConstraintsPage() {
  const [copied, setCopied] = useState(false)

  const sqlScript = `-- =====================================================
-- Fix Database Constraints to Support 'cancelled' Status
-- =====================================================
-- This script updates the check constraints to allow 'cancelled' status
-- for documents, document_jobs, and processing_status tables

-- 1. Update documents table constraint to include 'cancelled'
ALTER TABLE documents 
DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents 
ADD CONSTRAINT documents_status_check 
CHECK (status IN ('uploading', 'queued', 'processing', 'completed', 'error', 'cancelled'));

-- 2. Update document_jobs table constraint to include 'cancelled'  
ALTER TABLE document_jobs 
DROP CONSTRAINT IF EXISTS document_jobs_status_check;

ALTER TABLE document_jobs 
ADD CONSTRAINT document_jobs_status_check 
CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'));

-- 3. Update processing_status table constraint to include 'cancelled'
ALTER TABLE processing_status 
DROP CONSTRAINT IF EXISTS processing_status_status_check;

ALTER TABLE processing_status 
ADD CONSTRAINT processing_status_status_check 
CHECK (status IN ('queued', 'processing', 'completed', 'error', 'cancelled'));`


  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(sqlScript)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy script:', error)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Database className="h-6 w-6" />
          Database Constraint Fix Required
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          The processing cancellation feature requires database constraint updates
        </p>
      </div>

      <div className="space-y-6">
        {/* Issue Description */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Current Issue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                  Database constraint violation when trying to save &apos;cancelled&apos; status
                </p>
                <code className="text-xs text-orange-700 dark:text-orange-300 block mt-2">
                  Error: new row for relation violates check constraint &quot;documents_status_check&quot;
                </code>
              </div>
              
              <p className="text-sm text-gray-600 dark:text-gray-400">
                The database check constraints for the <code>documents</code> and <code>document_jobs</code> tables 
                do not include &apos;cancelled&apos; as a valid status value. This prevents the cancellation feature from working properly.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Solution Steps */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Solution Steps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Copy the SQL migration script below</li>
                <li>Go to your <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">Supabase Dashboard <ExternalLink className="h-3 w-3" /></a></li>
                <li>Navigate to <strong>SQL Editor</strong></li>
                <li>Paste and run the migration script</li>
                <li>Verify the constraints were updated successfully</li>
                <li>Test the cancellation feature again</li>
              </ol>

              <div className="flex items-center gap-2 mt-4">
                <Badge variant="outline" className="text-green-600 border-green-600">
                  Safe Migration
                </Badge>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  This script only adds &apos;cancelled&apos; to existing constraints - no data loss
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SQL Script */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                SQL Migration Script
              </span>
              <Button
                onClick={copyScript}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                {copied ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy Script
                  </>
                )}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm whitespace-pre-wrap">{sqlScript}</pre>
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-md">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> After running this script, the cancellation feature will work properly. 
                The constraints will allow &apos;cancelled&apos; status for both documents and document jobs.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* What Gets Fixed */}
        <Card>
          <CardHeader>
            <CardTitle>What Gets Updated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-2">documents table</h4>
                <div className="text-xs space-y-1">
                  <div className="text-red-600 dark:text-red-400">
                    ❌ Old: CHECK (status IN (&apos;uploading&apos;, &apos;queued&apos;, &apos;processing&apos;, &apos;completed&apos;, &apos;error&apos;))
                  </div>
                  <div className="text-green-600 dark:text-green-400">
                    ✅ New: CHECK (status IN (&apos;uploading&apos;, &apos;queued&apos;, &apos;processing&apos;, &apos;completed&apos;, &apos;error&apos;, &apos;cancelled&apos;))
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-2">document_jobs table</h4>
                <div className="text-xs space-y-1">
                  <div className="text-red-600 dark:text-red-400">
                    ❌ Old: CHECK (status IN (&apos;queued&apos;, &apos;processing&apos;, &apos;completed&apos;, &apos;failed&apos;))
                  </div>
                  <div className="text-green-600 dark:text-green-400">
                    ✅ New: CHECK (status IN (&apos;queued&apos;, &apos;processing&apos;, &apos;completed&apos;, &apos;failed&apos;, &apos;cancelled&apos;))
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-2">processing_status table</h4>
                <div className="text-xs space-y-1">
                  <div className="text-red-600 dark:text-red-400">
                    ❌ Old: CHECK (status IN (&apos;queued&apos;, &apos;processing&apos;, &apos;completed&apos;, &apos;error&apos;))
                  </div>
                  <div className="text-green-600 dark:text-green-400">
                    ✅ New: CHECK (status IN (&apos;queued&apos;, &apos;processing&apos;, &apos;completed&apos;, &apos;error&apos;, &apos;cancelled&apos;))
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}