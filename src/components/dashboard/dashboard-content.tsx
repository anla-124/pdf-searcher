'use client'

import { useState } from 'react'
import { DocumentUpload } from './document-upload'
import EnhancedDocumentList from './enhanced-document-list'

export function DashboardContent() {
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleUploadComplete = () => {
    // Increment trigger to cause document list refresh
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div className="space-y-8" data-testid="dashboard">
      {/* Upload Section */}
      <DocumentUpload onUploadComplete={handleUploadComplete} />

      {/* Document List */}
      <EnhancedDocumentList refreshTrigger={refreshTrigger} />
    </div>
  )
}
