'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface QueueStats {
  waiting: number
  delayed: number
  processing: number
  completed: number
  failed: number
  timestamp: string
}


export function QueueDashboard() {
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchQueueStats = async () => {
    try {
      const response = await fetch('/api/queue?action=stats')
      const result = await response.json()
      
      if (result.success) {
        setStats(result.data)
        setError(null)
      } else {
        setError(result.error || 'Failed to fetch queue stats')
      }
    } catch (err) {
      setError('Network error fetching queue stats')
      console.error('Queue stats error:', err)
    }
  }

  const triggerCleanup = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'cleanup',
          options: {
            maxAge: 86400000 // 24 hours
          }
        })
      })
      
      const result = await response.json()
      
      if (result.success) {
        await fetchQueueStats() // Refresh stats
        setError(null)
      } else {
        setError(result.error || 'Failed to trigger cleanup')
      }
    } catch (err) {
      setError('Network error triggering cleanup')
      console.error('Cleanup error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchQueueStats()
    setLoading(false)

    // Set up auto-refresh every 30 seconds
    const interval = setInterval(fetchQueueStats, 30000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString()
  }


  if (loading && !stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-4 bg-gray-200 rounded animate-pulse" />
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-gray-200 rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Queue Dashboard</h2>
          <p className="text-muted-foreground">
            Monitor background job processing and queue health
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={fetchQueueStats}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button 
            variant="outline" 
            onClick={triggerCleanup}
            disabled={loading}
          >
            Cleanup
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {stats && (
        <>
          {/* Queue Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Waiting</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{stats.waiting}</div>
                <p className="text-xs text-muted-foreground">Jobs in queue</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Delayed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{stats.delayed}</div>
                <p className="text-xs text-muted-foreground">Scheduled jobs</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Processing</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{stats.processing}</div>
                <p className="text-xs text-muted-foreground">Active jobs</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-600">{stats.completed}</div>
                <p className="text-xs text-muted-foreground">Finished jobs</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
                <p className="text-xs text-muted-foreground">Error jobs</p>
              </CardContent>
            </Card>
          </div>

          {/* Queue Health */}
          <Card>
            <CardHeader>
              <CardTitle>Queue Health</CardTitle>
              <CardDescription>
                Last updated: {formatTimestamp(stats.timestamp)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded-full ${
                    stats.waiting + stats.processing < 100 ? 'bg-green-500' : 
                    stats.waiting + stats.processing < 500 ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className="text-sm">
                    {stats.waiting + stats.processing < 100 ? 'Healthy' : 
                     stats.waiting + stats.processing < 500 ? 'Busy' : 'Overloaded'}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Total active: {stats.waiting + stats.processing}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>
                Common queue management operations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 flex-wrap">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    // This would trigger a manual document processing job
                    console.warn('Manual processing job trigger')
                  }}
                >
                  Test Document Job
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    // This would trigger a cleanup job
                    console.warn('Manual cleanup job trigger')
                  }}
                >
                  Manual Cleanup
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    // This would show queue configuration
                    console.warn('Show queue config')
                  }}
                >
                  Queue Config
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}