'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Eye, Download } from 'lucide-react'
import type { Document as AppDocument } from '@/types'

interface SourceDocumentActionsProps {
  document: AppDocument
  accent?: 'blue' | 'emerald'
}

const openInNewTab = async (doc: AppDocument) => {
  try {
    const response = await fetch(`/api/documents/${doc.id}/download`)
    if (!response.ok) {
      throw new Error('Failed to retrieve document')
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')

    // Clean up after the new tab has a chance to load the blob URL.
    setTimeout(() => window.URL.revokeObjectURL(url), 500)
  } catch (error) {
    console.error('[SourceDocumentActions] Failed to open document:', error instanceof Error ? error.message : 'Unknown error', { documentId: doc.id })
    alert('Failed to open document. Please try again.')
  }
}

const downloadDocument = async (doc: AppDocument) => {
  try {
    const response = await fetch(`/api/documents/${doc.id}/download`)
    if (!response.ok) {
      throw new Error('Failed to download document')
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = doc.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('[SourceDocumentActions] Failed to download document:', error instanceof Error ? error.message : 'Unknown error', { documentId: doc.id, filename: doc.filename })
    alert('Failed to download document. Please try again.')
  }
}

const ACCENT_STYLES = {
  blue: {
    button: 'focus-visible:ring-blue-400',
    icon: 'text-blue-500'
  },
  emerald: {
    button: 'focus-visible:ring-emerald-400',
    icon: 'text-emerald-500'
  }
} as const

export function SourceDocumentActions({ document, accent = 'blue' }: SourceDocumentActionsProps) {
  const styles = ACCENT_STYLES[accent]

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => openInNewTab(document)}
        className={cn('flex items-center', styles.button)}
      >
        <Eye className={cn('h-4 w-4 mr-1', styles.icon)} />
        View
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => downloadDocument(document)}
        className={cn('flex items-center', styles.button)}
      >
        <Download className={cn('h-4 w-4 mr-1', styles.icon)} />
        Download
      </Button>
    </div>
  )
}
