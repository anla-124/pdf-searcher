'use client'

import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Target, Users, Search } from 'lucide-react'

interface SearchModeModalProps {
  isOpen: boolean
  onClose: () => void
  documentId: string
  documentTitle: string
  onSelectedSearchClick: () => void
}

export function SearchModeModal({ isOpen, onClose, documentId, documentTitle: _documentTitle, onSelectedSearchClick }: SearchModeModalProps) {
  const handleSelectedSearchClick = () => {
    onSelectedSearchClick()
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-center">
            <Search className="h-5 w-5 text-blue-500" />
            Choose Search Mode
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col gap-3 py-4">
          {/* General Search */}
          <Link href={`/documents/${documentId}/similar`} onClick={onClose}>
            <Button
              variant="outline"
              className="w-full h-12 flex items-center justify-center gap-2"
            >
              <Target className="h-4 w-4 text-blue-500" />
              General Search
            </Button>
          </Link>

          {/* Selected Search */}
          <Button
            variant="outline"
            className="w-full h-12 flex items-center justify-center gap-2"
            onClick={handleSelectedSearchClick}
          >
            <Users className="h-4 w-4 text-emerald-500" />
            Selected Search
          </Button>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose} size="sm">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
