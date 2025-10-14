'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ComponentType, SVGProps } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { clientLogger } from '@/lib/client-logger'
import { 
  Upload, 
  FileText, 
  Brain, 
  Database, 
  CheckCircle, 
  AlertCircle,
  Clock,
  Zap
} from 'lucide-react'

interface ProcessingPhase {
  id: string
  name: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  status: 'pending' | 'active' | 'completed' | 'error'
  progress: number
  duration?: number
  startTime?: number
}

interface EnhancedProgressTrackerProps {
  documentId: string
  onComplete?: () => void
}

export function EnhancedProgressTracker({ documentId, onComplete }: EnhancedProgressTrackerProps) {
  const [phases, setPhases] = useState<ProcessingPhase[]>([
    {
      id: 'upload',
      name: 'File Upload',
      description: 'Uploading document to secure storage',
      icon: Upload,
      status: 'pending',
      progress: 0
    },
    {
      id: 'extraction',
      name: 'Text Extraction',
      description: 'Processing document with AI to extract text and structure',
      icon: FileText,
      status: 'pending',
      progress: 0
    },
    {
      id: 'analysis',
      name: 'Content Analysis',
      description: 'Analyzing document structure and extracting key fields',
      icon: Brain,
      status: 'pending',
      progress: 0
    },
    {
      id: 'embeddings',
      name: 'Vector Generation',
      description: 'Creating semantic embeddings for similarity search',
      icon: Zap,
      status: 'pending',
      progress: 0
    },
    {
      id: 'indexing',
      name: 'Search Indexing',
      description: 'Indexing document in vector database for fast retrieval',
      icon: Database,
      status: 'pending',
      progress: 0
    }
  ])

  const [overallProgress, setOverallProgress] = useState(0)
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null)
  const [startTime] = useState(Date.now())

  const updateProgressFromStatus = useCallback((statusData: any) => {
    const { status, progress, phase } = statusData

    setPhases(prev => prev.map(p => {
      if (phase && p.id === phase) {
        return {
          ...p,
          status: status === 'error' ? 'error' : status === 'completed' ? 'completed' : 'active',
          progress: progress || 0,
          startTime: p.startTime || Date.now()
        }
      }
      
      // Mark previous phases as completed
      const phaseIndex = prev.findIndex(ph => ph.id === p.id)
      const currentPhaseIndex = prev.findIndex(ph => ph.id === phase)
      
      if (currentPhaseIndex > phaseIndex && p.status !== 'completed') {
        return { ...p, status: 'completed', progress: 100 }
      }
      
      return p
    }))

    // Calculate overall progress - use functional update to avoid stale closure
    setOverallProgress(_prev => {
      const currentPhaseProgress = progress || 0
      // Simplified calculation since we can't access phases in callback
      return Math.min(currentPhaseProgress, 95)
    })

    // Estimate time remaining
    setEstimatedTimeRemaining(prev => {
      if (progress && progress > 10) {
        const elapsed = Date.now() - startTime
        const estimated = (elapsed / progress) * (100 - progress)
        return Math.round(estimated / 1000)
      }
      return prev
    })

    // Check if processing is complete
    if (status === 'completed' && progress >= 95) {
      onComplete?.()
    }
  }, [startTime, onComplete])

  useEffect(() => {
    const pollProgress = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/processing-status`)
        if (response.ok) {
          const data = await response.json()
          updateProgressFromStatus(data)
        }
      } catch (error) {
        clientLogger.error('Failed to fetch processing status', error)
      }
    }

    const interval = setInterval(pollProgress, 1000) // Poll every second
    pollProgress() // Initial poll

    return () => clearInterval(interval)
  }, [documentId, updateProgressFromStatus])


  const getPhaseStatusIcon = (phase: ProcessingPhase) => {
    const IconComponent = phase.icon
    
    switch (phase.status) {
      case 'completed': 
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'active': 
        return <IconComponent className="h-4 w-4 text-blue-600 animate-pulse" />
      case 'error': 
        return <AlertCircle className="h-4 w-4 text-red-600" />
      default: 
        return <IconComponent className="h-4 w-4 text-gray-400" />
    }
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  const activePhase = phases.find(p => p.status === 'active')
  const completedPhases = phases.filter(p => p.status === 'completed').length
  const hasError = phases.some(p => p.status === 'error')

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Document Processing
          </span>
          <Badge variant={hasError ? 'destructive' : completedPhases === phases.length ? 'default' : 'secondary'}>
            {hasError ? 'Error' : completedPhases === phases.length ? 'Complete' : 'Processing'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Overall Progress</span>
            <span>{overallProgress}%</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
          {estimatedTimeRemaining && estimatedTimeRemaining > 0 && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" />
              <span>~{formatTime(estimatedTimeRemaining)} remaining</span>
            </div>
          )}
        </div>

        {/* Phase Details */}
        <div className="space-y-4">
          {phases.map((phase, index) => (
            <div key={phase.id} className="flex items-start gap-3">
              {/* Phase Icon */}
              <div className="flex-shrink-0 mt-1">
                {getPhaseStatusIcon(phase)}
              </div>
              
              {/* Phase Content */}
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{phase.name}</span>
                  {phase.status === 'active' && (
                    <span className="text-xs text-blue-600">{phase.progress}%</span>
                  )}
                </div>
                <p className="text-xs text-gray-600">{phase.description}</p>
                
                {/* Phase Progress Bar */}
                {phase.status === 'active' && (
                  <Progress value={phase.progress} className="h-1" />
                )}
                
                {/* Phase Duration */}
                {phase.status === 'completed' && phase.duration && (
                  <div className="text-xs text-gray-500">
                    Completed in {formatTime(Math.round(phase.duration / 1000))}
                  </div>
                )}
              </div>
              
              {/* Connection Line */}
              {index < phases.length - 1 && (
                <div className="absolute left-[22px] mt-6 w-px h-8 bg-gray-200" />
              )}
            </div>
          ))}
        </div>

        {/* Current Phase Details */}
        {activePhase && (
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <activePhase.icon className="h-4 w-4" />
              Currently: {activePhase.name}
            </div>
            <p className="text-xs text-blue-600 mt-1">{activePhase.description}</p>
          </div>
        )}

        {/* Performance Stats */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t text-center">
          <div>
            <div className="text-lg font-semibold text-green-600">{completedPhases}</div>
            <div className="text-xs text-gray-500">Completed</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-blue-600">
              {formatTime(Math.round((Date.now() - startTime) / 1000))}
            </div>
            <div className="text-xs text-gray-500">Elapsed</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-600">{phases.length}</div>
            <div className="text-xs text-gray-500">Total Phases</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
