'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'

interface ActivityLogEntry {
  id: string
  user_uuid: string
  email?: string
  ip_address?: string
  action_type: string
  description: string
  resource_type: string
  resource_name?: string
  logged_at: string
  duration_ms?: number
  metadata?: any
}

interface ActivityStats {
  totalActions: number
  uniqueUsers: number
  uploads: number
  deletes: number
  searches: number
  downloads: number
  avgDurationMs: number
}

interface ActivityLogData {
  activities: ActivityLogEntry[]
  summary: {
    stats: ActivityStats
    topUsers: any[]
    dailyStats: any[]
  }
  pagination: {
    limit: number
    offset: number
    hasMore: boolean
  }
}

export default function ActivityLog() {
  const [data, setData] = useState<ActivityLogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState({
    action: '',
    userId: '',
    limit: 50
  })

  const fetchActivityLog = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      
      if (filter.action) params.append('action', filter.action)
      if (filter.userId) params.append('user_uuid', filter.userId)
      params.append('limit', filter.limit.toString())

      const response = await fetch(`/api/admin/activity-log?${params}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch activity log')
      }

      const result = await response.json()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchActivityLog()
  }, [fetchActivityLog])

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case 'upload': return 'bg-green-100 text-green-800'
      case 'delete': return 'bg-red-100 text-red-800'
      case 'search': return 'bg-blue-100 text-blue-800'
      case 'similarity': return 'bg-purple-100 text-purple-800'
      case 'batch_delete': return 'bg-red-200 text-red-900'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-red-800">Error</h3>
          <p className="text-sm text-red-700 mt-1">{error}</p>
          <button 
            onClick={fetchActivityLog}
            className="mt-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Activity Log</h2>
        <button 
          onClick={fetchActivityLog}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      {data?.summary?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Total Actions</div>
            <div className="text-2xl font-bold text-gray-900">{data.summary.stats.totalActions}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Unique Users</div>
            <div className="text-2xl font-bold text-gray-900">{data.summary.stats.uniqueUsers}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Uploads</div>
            <div className="text-2xl font-bold text-green-600">{data.summary.stats.uploads}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Searches</div>
            <div className="text-2xl font-bold text-blue-600">{data.summary.stats.searches}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
          <select 
            value={filter.action}
            onChange={(e) => setFilter(prev => ({ ...prev, action: e.target.value }))}
            className="border border-gray-300 rounded px-3 py-1 text-sm"
          >
            <option value="">All Actions</option>
            <option value="upload">Upload</option>
            <option value="delete">Delete</option>
            <option value="search">Search</option>
            <option value="similarity">Similarity</option>
            <option value="batch_delete">Batch Delete</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
          <input 
            type="text"
            value={filter.userId}
            onChange={(e) => setFilter(prev => ({ ...prev, userId: e.target.value }))}
            placeholder="Filter by user..."
            className="border border-gray-300 rounded px-3 py-1 text-sm w-48"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Limit</label>
          <select 
            value={filter.limit}
            onChange={(e) => setFilter(prev => ({ ...prev, limit: parseInt(e.target.value) }))}
            className="border border-gray-300 rounded px-3 py-1 text-sm"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>

      {/* Activity List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-medium text-gray-900">Recent Activity</h3>
        </div>
        
        <div className="divide-y divide-gray-200">
          {data?.activities?.map((activity) => (
            <div key={activity.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getActionBadgeColor(activity.action_type)}`}>
                    {activity.action_type}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {activity.description}
                    </div>
                    <div className="text-xs text-gray-500">
                      {activity.email || activity.user_uuid} • {activity.ip_address}
                    </div>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-xs text-gray-500">
                    {format(new Date(activity.logged_at), 'MMM d, HH:mm:ss')}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatDuration(activity.duration_ms)}
                  </div>
                </div>
              </div>
              
              {activity.resource_name && (
                <div className="mt-2 text-xs text-gray-600">
                  <span className="font-medium">{activity.resource_type}:</span> {activity.resource_name}
                </div>
              )}
              
              {activity.metadata && typeof activity.metadata === 'object' && (
                <div className="mt-2 text-xs text-gray-500">
                  {Object.entries(activity.metadata).map(([key, value]) => (
                    <span key={key} className="mr-3">
                      {key}: {String(value)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        
        {data?.activities?.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No activity found for the selected filters.
          </div>
        )}
      </div>

      {/* Pagination */}
      {data?.pagination?.hasMore && (
        <div className="text-center">
          <button 
            onClick={() => setFilter(prev => ({ ...prev, limit: prev.limit + 50 }))}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  )
}